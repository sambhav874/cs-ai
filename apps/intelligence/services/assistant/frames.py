"""ContractSense runtime events → the frames the platform's chat renders.

The chat (SideAgentRail, AgentHomePage) was built on draftLegal's stream, so
its contract is kept exactly:

  token                            {delta}
  tool_call_start                  {id, name, args}
  tool_progress                    {id, name, elapsedSec}
  tool_call_result                 {id, name, result, truncated, ok}
  tool_call_awaiting_confirmation  {id, name, args, preview, reversible, source}
  error                            {error}
  done                             {provider, model, tier, source, usage}

and ContractSense's run adds what that stream never had:

  status     {message}            named progress ("Reading rate schedules…")
  thinking   {message}            provider reasoning, when there is any
  citations  {citations: [...]}   verified quotes, after the answer
  final      {answer}             the answer after citation validation

Pure apart from `emit`; tested without a model.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional, Set

Emit = Callable[[Dict[str, Any]], None]

_OPEN_TAG = "<citations"
_CLOSE_TAG = "</citations>"


def _held_suffix(lowered: str, tag: str) -> int:
    """Length of a trailing fragment that could be the start of `tag`."""
    for keep in range(min(len(tag) - 1, len(lowered)), 0, -1):
        if tag.startswith(lowered[-keep:]):
            return keep
    return 0


class CitationBlockFilter:
    """Hold back the model's <CITATIONS> JSON from the streamed text.

    The block is for the citation pipeline, not the reader; it used to reach
    the screen and be stripped client-side. A tag split across chunks is held
    until it can be told apart from ordinary text. Text after a closing tag
    streams again — a multi-part answer's follow-up turn writes its own block.
    """

    def __init__(self) -> None:
        self._pending = ""
        self._inside = False

    def feed(self, text: str) -> str:
        buffer = self._pending + text
        self._pending = ""
        out: List[str] = []
        while buffer:
            lowered = buffer.lower()
            tag = _CLOSE_TAG if self._inside else _OPEN_TAG
            at = lowered.find(tag)
            if at >= 0:
                if not self._inside:
                    out.append(buffer[:at])
                    self._inside = True
                    buffer = buffer[at + len(tag):]
                else:
                    self._inside = False
                    buffer = buffer[at + len(tag):]
                continue
            keep = _held_suffix(lowered, tag)
            if keep:
                self._pending = buffer[-keep:]
                buffer = buffer[:-keep]
            if not self._inside:
                out.append(buffer)
            break
        return "".join(out)

    def flush(self) -> str:
        out, self._pending = ("" if self._inside else self._pending), ""
        return out


class FrameTranslator:
    """Turn runtime `on_event(type, payload)` calls into chat frames."""

    def __init__(self, emit: Emit, *, lifecycle_names: Set[str], on_tool_call: Optional[Callable[[str], None]] = None):
        self.emit = emit
        self.lifecycle_names = lifecycle_names
        self.on_tool_call = on_tool_call
        self.citations = CitationBlockFilter()
        self.streamed = ""
        self.tool_calls = 0

    def token(self, text: str) -> None:
        visible = self.citations.feed(text)
        if visible:
            self.streamed += visible
            self.emit({"type": "token", "delta": visible})

    def flush(self) -> None:
        rest = self.citations.flush()
        if rest:
            self.streamed += rest
            self.emit({"type": "token", "delta": rest})

    def __call__(self, event: str, payload: Dict[str, Any]) -> None:
        if event == "delta":
            self.token(str(payload.get("text") or ""))
        elif event in {"status", "thinking"}:
            message = str(payload.get("message") or "").strip()
            if message:
                self.emit({"type": event, "message": message[:2000]})
        elif event == "tool_call":
            call_id = str(payload.get("id") or f"call_{self.tool_calls}")
            self.tool_calls += 1
            if self.on_tool_call:
                self.on_tool_call(call_id)
            self.emit({"type": "tool_call_start", "id": call_id, "name": payload.get("name"),
                       "args": payload.get("args") or {}})
        elif event == "tool_result":
            name = str(payload.get("name") or "")
            status = str(payload.get("status") or "done")
            # A lifecycle tool reports its own result (with its JSON, or as an
            # Apply card); a rejected call never reached it, so it is ours.
            if name in self.lifecycle_names and status != "rejected":
                return
            if status == "approval_required":
                return  # becomes an Apply card when the run pauses
            result = payload.get("result")
            if not isinstance(result, str) or not result:
                result = str(payload.get("summary") or "")
            self.emit({"type": "tool_call_result", "id": str(payload.get("id") or ""), "name": name,
                       "result": result, "truncated": False, "ok": status not in {"error", "rejected"}})


_MARKER = re.compile(r"\[(\d+)\]")


def citation_frame(annotations: list, *, platform_ids: Dict[str, str]) -> Optional[Dict[str, Any]]:
    """The run's validated citations, in the platform's one schema.

    {ref, contractId, quote, page, sectionRef, verified}. `platform_ids` maps
    ContractSense document ids to platform contract ids, so the chat can open
    the contract the quote came from.
    """
    out = []
    for i, ann in enumerate(annotations or []):
        if not isinstance(ann, dict):
            continue
        quote = str(ann.get("quote") or "").strip()
        if not quote:
            continue
        doc = str(ann.get("document_id") or ann.get("contract_id") or "")
        ref = ann.get("ref") or ann.get("number") or ann.get("index") or i + 1
        out.append({
            "ref": ref,
            # "fact": a project fact from the Space's memory; "passage": contract text.
            "kind": "fact" if ann.get("kind") == "fact" else "passage",
            "factId": ann.get("fact_id"),
            "contractId": platform_ids.get(doc),
            "quote": quote,
            "page": ann.get("page") or ann.get("page_number"),
            "sectionRef": ann.get("section") or ann.get("section_path"),
            "filename": ann.get("filename"),
            # Survived the citation pipeline's support check (answer_guard).
            "verified": ann.get("verified") is True,
        })
    return {"type": "citations", "citations": out} if out else None
