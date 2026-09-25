"""Tool schemas without the boilerplate, for binding to a chat model.

Every model call carries every bound tool's JSON schema. Pydantic's schema
for an optional field is `{"anyOf": [{"type": "string"}, {"type": "null"}],
"default": null, "title": "Status", "description": "..."}`; the model needs
`{"type": "string", "description": "..."}` and the field's absence from
`required` (~750 of the ~9.3k tokens the assistant's 31 lifecycle tools
resent on each call).

A lifecycle tool's description is also cut to its first two sentences: the
rest restated routing advice the assistant's rules (services/assistant/
prompt.py) already give, and cost ~1.8k tokens a call. ContractSense's own
evidence tools keep theirs whole.

Only the advertised schema changes. Tools still execute through their own
pydantic args_schema, so validation, defaults and coercion are as before, and
a model that sends an explicit null for an optional field is still accepted.
"""
from __future__ import annotations

import re
from typing import Any, Dict

from langchain_core.tools import BaseTool
from langchain_core.utils.function_calling import convert_to_openai_tool


def _compact(node: Any) -> Any:
    if isinstance(node, list):
        return [_compact(item) for item in node]
    if not isinstance(node, dict):
        return node
    node = {k: v for k, v in node.items() if k != "title"}
    if node.get("default", "missing") is None:
        node.pop("default")
    options = node.get("anyOf")
    if isinstance(options, list):
        kept = [o for o in options if not (isinstance(o, dict) and o.get("type") == "null")]
        if len(kept) == 1 and len(kept) < len(options):
            node.pop("anyOf")
            node = {**kept[0], **node}
    return {k: _compact(v) for k, v in node.items()}


DESCRIPTION_SENTENCES = 2
DESCRIPTION_CHARS = 320


def short_description(text: str) -> str:
    """The first sentences of a tool description, within DESCRIPTION_CHARS."""
    text = " ".join((text or "").split())
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z])", text)
    out = " ".join(sentences[:DESCRIPTION_SENTENCES])
    return out if len(out) <= DESCRIPTION_CHARS else out[:DESCRIPTION_CHARS].rsplit(" ", 1)[0] + "…"


def compact_tool_schema(tool: BaseTool) -> Dict[str, Any]:
    """The OpenAI-format function schema for `tool`, minus what the model does not use."""
    from services.contract_agent.graph.tools.registry import LIFECYCLE_TOOLS

    schema = convert_to_openai_tool(tool)
    function = schema["function"]
    if tool.name in LIFECYCLE_TOOLS and function.get("description"):
        function["description"] = short_description(function["description"])
    if "parameters" in function:
        function["parameters"] = _compact(function["parameters"])
    return schema
