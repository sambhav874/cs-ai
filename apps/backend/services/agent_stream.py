"""Shared streaming/dispatch loop for the agent SSE endpoints (Phase 3.4, F-11).

`stream_project_agent` and `stream_contract_agent` each drove an identical
sequence — start the agent run on a background thread, drain its event queue,
watch for client disconnect and a wall-clock timeout, keep the connection
alive on long tool calls — as two hand-maintained copies. They had already
drifted once (F-11): a citation-emission guard present in one was missing
from the other. This is that sequence written once.

What stays in the route: everything that differs by surface — scope
resolution, which memory-context kwargs to pass, and what a completed run
persists. Collapsing that too would need every surface-specific branch
threaded through one function's signature, which trades a few duplicated
lines for a worse kind of duplication (parameters nobody but one caller
uses). The polling mechanics had zero surface-specific logic, which is what
made them safe to extract outright.
"""

from __future__ import annotations

import asyncio
import queue
import threading
import time
from typing import Any, AsyncGenerator, Callable, Dict

# Hard wall-clock cap on a streamed agent run. The per-run tool-call and cost
# budgets (graph/tools/errors.py) bound how much *work* one run can do;
# nothing previously bounded how *long* an abandoned tab could keep it going.
AGENT_STREAM_HARD_TIMEOUT_SECONDS = 180

RunAgent = Callable[[Callable[[str, Dict[str, Any]], None], Callable[[], bool]], Any]
FormatEvent = Callable[[str, Dict[str, Any]], str]


class Disconnectable:
    """The one method this module needs from a FastAPI `Request`.

    Typed narrowly on purpose so a test double doesn't need to fake the rest
    of `Request`.
    """

    async def is_disconnected(self) -> bool:  # pragma: no cover - protocol
        ...


async def stream_agent_run(
    *,
    http_request: Disconnectable,
    run_agent: RunAgent,
    format_event: FormatEvent,
    result: Dict[str, Any],
    hard_timeout_seconds: float = AGENT_STREAM_HARD_TIMEOUT_SECONDS,
) -> AsyncGenerator[str, None]:
    """Run `run_agent` on a background thread and yield SSE frames for its events.

    `run_agent(on_event, cancel_check)` must return the run's final response,
    or raise. The response is not yielded as a frame — the caller needs the
    actual object to decide what a completed run persists, not its SSE
    encoding — so it is written into `result["response"]` instead. Callers
    read `result` once the generator is exhausted: `result["client_gone"]`
    means the connection dropped before completion and there is nothing left
    to persist; otherwise `result["response"]` holds the run's `AgentResponse`.

    `cancel_check`, passed through to `run_agent`, is polled by the ReAct
    loop once per iteration (react_runtime.py) — it cannot abort a model call
    already in flight, but it stops the run from starting another iteration
    once the client is gone or the run has overrun its wall clock (F-10).
    """
    event_queue: "queue.Queue[tuple]" = queue.Queue()
    cancel_event = threading.Event()

    def on_event(event_type: str, payload: Dict[str, Any]) -> None:
        event_queue.put((event_type, payload))

    def _run() -> None:
        try:
            response = run_agent(on_event, cancel_event.is_set)
            event_queue.put(("final_response", response))
        except Exception as exc:  # noqa: BLE001 - re-raised on the polling side
            event_queue.put(("error", exc))

    thread = threading.Thread(target=_run)
    thread.start()

    started = time.monotonic()
    last_emit = started
    while True:
        try:
            event_type, payload = event_queue.get_nowait()
            if event_type == "final_response":
                result["response"] = payload
                return
            if event_type == "error":
                raise payload
            # Token chunks from _stream_text_response forward the same as
            # every other event — nothing here treats "delta" specially, that
            # distinction lived only in a stale comment on the old duplicate.
            yield format_event(event_type, payload)
            last_emit = time.monotonic()
            continue
        except queue.Empty:
            pass

        if not thread.is_alive():
            return

        if await http_request.is_disconnected():
            cancel_event.set()
            result["client_gone"] = True
            return

        if time.monotonic() - started >= hard_timeout_seconds:
            cancel_event.set()
            yield format_event(
                "error", {"message": "Run exceeded its time budget and was cancelled."}
            )
            return

        # Long tool calls can outlast an idle-connection timeout; a comment
        # frame keeps proxies from dropping the stream.
        if time.monotonic() - last_emit >= 15:
            last_emit = time.monotonic()
            yield ": keepalive\n\n"
        await asyncio.sleep(0.1)
