"""Typed SSE event streaming for the agent runtime.

Mirrors Mike's approach of well-defined event types that the frontend can
consume directly. Instead of a fragmented mix of callbacks, raw streaming
text, and side-channel updates, every interesting moment in the agent loop
is emitted as a typed event.

Event types (matching Mike's pattern):
  - text/delta   — incremental model output
  - text/done    — final answer (non-tool)
  - tool/call    — model requested a tool invocation
  - tool/result  — tool execution completed
  - tool/error   — tool execution failed
  - status       — status updates (thinking, searching, drafting, etc.)
  - error        — unrecoverable errors
  - done         — stream complete
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Dict, Generator, List, Optional, Union


# ---------------------------------------------------------------------------
# Event data classes
# ---------------------------------------------------------------------------

@dataclass
class StreamEvent:
    """Base event with type and timestamp."""
    type: str
    data: Dict[str, Any] = field(default_factory=dict)
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_sse(self) -> str:
        """Serialize to Server-Sent Events format."""
        payload = {"type": self.type, "data": self.data, "timestamp": self.timestamp}
        return f"data: {json.dumps(payload)}\n\n"

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "data": self.data, "timestamp": self.timestamp}


@dataclass
class TextDeltaEvent(StreamEvent):
    """Incremental text output from the model."""
    type: str = "text/delta"

    def __init__(self, content: str, finish_reason: Optional[str] = None):
        super().__init__(type="text/delta", data={
            "content": content,
            "finish_reason": finish_reason,
        })


@dataclass
class TextDoneEvent(StreamEvent):
    """Final text answer from the model (non-tool response)."""
    type: str = "text/done"

    def __init__(self, content: str):
        super().__init__(type="text/done", data={
            "content": content,
        })


@dataclass
class ToolCallEvent(StreamEvent):
    """Model requested a tool invocation."""
    type: str = "tool/call"

    def __init__(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        tool_call_id: str,
    ):
        super().__init__(type="tool/call", data={
            "tool_name": tool_name,
            "arguments": arguments,
            "tool_call_id": tool_call_id,
        })


@dataclass
class ToolResultEvent(StreamEvent):
    """Tool execution completed with result."""
    type: str = "tool/result"

    def __init__(
        self,
        tool_name: str,
        result: Any,
        tool_call_id: str,
        duration_ms: Optional[float] = None,
    ):
        serialized = _serialize_result(result)
        super().__init__(type="tool/result", data={
            "tool_name": tool_name,
            "result": serialized,
            "tool_call_id": tool_call_id,
            "duration_ms": duration_ms,
        })


@dataclass
class ToolErrorEvent(StreamEvent):
    """Tool execution failed."""
    type: str = "tool/error"

    def __init__(
        self,
        tool_name: str,
        error: str,
        tool_call_id: str,
    ):
        super().__init__(type="tool/error", data={
            "tool_name": tool_name,
            "error": error,
            "tool_call_id": tool_call_id,
        })


@dataclass
class StatusEvent(StreamEvent):
    """Status update (thinking, searching, drafting, etc.)."""
    type: str = "status"

    def __init__(
        self,
        status: str,
        message: Optional[str] = None,
        progress: Optional[float] = None,
    ):
        data: Dict[str, Any] = {"status": status}
        if message:
            data["message"] = message
        if progress is not None:
            data["progress"] = progress
        super().__init__(type="status", data=data)


@dataclass
class ErrorEvent(StreamEvent):
    """Unrecoverable error during streaming."""
    type: str = "error"

    def __init__(self, error: str, code: Optional[str] = None):
        data: Dict[str, Any] = {"error": error}
        if code:
            data["code"] = code
        super().__init__(type="error", data=data)


@dataclass
class DoneEvent(StreamEvent):
    """Stream complete — no more events will be emitted."""
    type: str = "done"

    def __init__(self, finish_reason: str = "completed"):
        super().__init__(type="done", data={
            "finish_reason": finish_reason,
        })


# ---------------------------------------------------------------------------
# Event stream generator
# ---------------------------------------------------------------------------

def generate_event_stream(
    event_generator: Generator[StreamEvent, None, None],
) -> Generator[str, None, None]:
    """Wrap a generator of StreamEvents into SSE-formatted strings.

    Usage:
        for sse in generate_event_stream(agent.run_stream(...)):
            yield sse
    """
    try:
        for event in event_generator:
            yield event.to_sse()
    except Exception as e:
        yield ErrorEvent(error=str(e)).to_sse()
    finally:
        yield DoneEvent().to_sse()


def agent_event_stream(
    agent_runner_callable,
    *args: Any,
    **kwargs: Any,
) -> Generator[StreamEvent, None, None]:
    """Generator that runs an agent and yields StreamEvents.

    This is a template — the actual agent runner integrates with the
    model's streaming API (e.g., OpenAI stream()) and yields events.

    The caller wraps this in generate_event_stream() to get SSE strings.

    Typical flow:
      yield StatusEvent("thinking")
      # stream model response
      for chunk in model.stream(...):
          yield TextDeltaEvent(chunk.content)
          if chunk.tool_calls:
              for tc in chunk.tool_calls:
                  yield ToolCallEvent(tc.name, tc.args, tc.id)
                  try:
                      result = execute_tool(tc.name, tc.args)
                      yield ToolResultEvent(tc.name, result, tc.id)
                  except Exception as e:
                      yield ToolErrorEvent(tc.name, str(e), tc.id)
      yield TextDoneEvent(final_text)
    """
    # This is a stub that the ReAct runtime will call.
    # The actual implementation in react_runtime.py replaces this.
    yield from agent_runner_callable(*args, **kwargs)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize_result(result: Any) -> Any:
    """Serialize a tool result for SSE transmission.

    Handles common types that might not be directly JSON-serializable.
    """
    if result is None:
        return None
    if isinstance(result, (str, int, float, bool)):
        return result
    if isinstance(result, bytes):
        return f"<{len(result)} bytes>"
    if isinstance(result, dict):
        return {k: _serialize_result(v) for k, v in result.items()}
    if isinstance(result, (list, tuple)):
        return [_serialize_result(v) for v in result]
    # dataclass instances
    if hasattr(result, "__dataclass_fields__"):
        return asdict(result)  # type: ignore[arg-type]
    # Try string conversion last
    try:
        return str(result)
    except Exception:
        return "<unserializable>"


# Convenience
__all__ = [
    "StreamEvent",
    "TextDeltaEvent",
    "TextDoneEvent",
    "ToolCallEvent",
    "ToolResultEvent",
    "ToolErrorEvent",
    "StatusEvent",
    "ErrorEvent",
    "DoneEvent",
    "generate_event_stream",
    "agent_event_stream",
]
