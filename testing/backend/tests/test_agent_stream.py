"""Tests for the shared streaming/dispatch loop (Phase 3.4, F-11).

`stream_agent_run` replaced two hand-duplicated copies of this thread+queue+
poll loop, one of which had already drifted from the other. These tests
exercise the loop directly against fakes — no FastAPI app, no real thread
timing beyond what the loop itself needs.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List

import pytest

from services.agent_stream import stream_agent_run


class FakeRequest:
    """A `Disconnectable` that reports disconnected after N polls."""

    def __init__(self, disconnect_after: int | None = None):
        self.disconnect_after = disconnect_after
        self.poll_count = 0

    async def is_disconnected(self) -> bool:
        self.poll_count += 1
        if self.disconnect_after is None:
            return False
        return self.poll_count >= self.disconnect_after


def _format_event(event_type: str, payload: Dict[str, Any]) -> str:
    return f"event: {event_type}\ndata: {payload}\n\n"


@pytest.mark.asyncio
async def test_a_normal_run_yields_its_events_and_stores_the_response():
    def run_agent(on_event, cancel_check):
        on_event("status", {"message": "thinking"})
        on_event("delta", {"text": "hi"})
        return {"answer": "done"}

    result: Dict[str, Any] = {}
    frames: List[str] = [
        frame
        async for frame in stream_agent_run(
            http_request=FakeRequest(),
            run_agent=run_agent,
            format_event=_format_event,
            result=result,
        )
    ]

    assert any("status" in frame for frame in frames)
    assert any("delta" in frame for frame in frames)
    assert result["response"] == {"answer": "done"}
    assert "client_gone" not in result


@pytest.mark.asyncio
async def test_an_error_raised_by_run_agent_propagates_to_the_caller():
    def run_agent(on_event, cancel_check):
        raise ValueError("boom")

    result: Dict[str, Any] = {}
    with pytest.raises(ValueError, match="boom"):
        async for _ in stream_agent_run(
            http_request=FakeRequest(),
            run_agent=run_agent,
            format_event=_format_event,
            result=result,
        ):
            pass


@pytest.mark.asyncio
async def test_client_disconnect_stops_the_loop_and_sets_cancel_check():
    import threading

    finished = threading.Event()
    cancel_seen = {"tripped": False}

    def run_agent(on_event, cancel_check):
        # Poll cancel_check until the outer loop has had a chance to detect
        # the disconnect and set it — proves the flag actually reaches the
        # background run, not just that the generator stops yielding.
        try:
            for _ in range(500):
                if cancel_check():
                    cancel_seen["tripped"] = True
                    return {"answer": "cancelled"}
                time.sleep(0.01)
            return {"answer": "never cancelled"}
        finally:
            finished.set()

    result: Dict[str, Any] = {}
    frames = [
        frame
        async for frame in stream_agent_run(
            http_request=FakeRequest(disconnect_after=1),
            run_agent=run_agent,
            format_event=_format_event,
            result=result,
        )
    ]

    assert result.get("client_gone") is True
    assert "response" not in result
    # No frames make it out once the client is gone — nothing left to read them.
    assert frames == [] or all("error" not in f for f in frames)

    # The generator returns as soon as it detects the disconnect, before the
    # background thread has necessarily observed cancel_check — give it up
    # to five seconds to actually finish before checking that it did.
    assert finished.wait(timeout=5), "background run_agent thread never finished"
    assert cancel_seen["tripped"] is True


@pytest.mark.asyncio
async def test_hard_timeout_cancels_and_emits_an_error_frame():
    def run_agent(on_event, cancel_check):
        for _ in range(500):
            if cancel_check():
                return {"answer": "cancelled"}
            time.sleep(0.01)
        return {"answer": "never cancelled"}

    result: Dict[str, Any] = {}
    frames = [
        frame
        async for frame in stream_agent_run(
            http_request=FakeRequest(),
            run_agent=run_agent,
            format_event=_format_event,
            result=result,
            hard_timeout_seconds=0.05,
        )
    ]

    assert any("error" in frame for frame in frames)
    assert "client_gone" not in result


@pytest.mark.asyncio
async def test_events_after_the_final_response_are_not_yielded():
    def run_agent(on_event, cancel_check):
        on_event("status", {"message": "step 1"})
        return {"answer": "done"}

    result: Dict[str, Any] = {}
    frames = [
        frame
        async for frame in stream_agent_run(
            http_request=FakeRequest(),
            run_agent=run_agent,
            format_event=_format_event,
            result=result,
        )
    ]

    assert not any("final_response" in frame for frame in frames)
    assert result["response"] == {"answer": "done"}
