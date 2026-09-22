"""jsonish — lenient JSON parsing for LLM output.

Gemini (and occasionally other models) wrap JSON answers in markdown
code fences even when told not to. Every lightweight route that does
`json.loads(llm_text)` breaks on that. One shared helper instead of
per-route fence handling.
"""
from __future__ import annotations

import json
import re
from typing import Any

_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL)


def loads_lenient(raw: str) -> Any:
    """json.loads that tolerates markdown code fences and leading prose.

    Strategy: try as-is → try fence-stripped → try the first {...} block.
    Raises ValueError when nothing parses (callers keep their fallbacks).
    """
    text = (raw or "").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m = _FENCE.match(text)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    # Last resort — first top-level JSON object in the text.
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass
    # JSONDecodeError (a ValueError subclass) — several callers catch
    # json.JSONDecodeError specifically, so raise that, not bare ValueError.
    raise json.JSONDecodeError(f"no parseable JSON in LLM output: {text[:120]!r}", text or "", 0)
