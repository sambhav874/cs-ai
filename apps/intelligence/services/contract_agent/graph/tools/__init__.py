"""Tool registry for the deep contract agent."""

from .registry import APPROVAL_REQUIRED_TOOLS, FORBIDDEN_TOOL_NAMES, READ_ONLY_TOOLS, ToolSpec, tool_specs

__all__ = [
    "APPROVAL_REQUIRED_TOOLS",
    "FORBIDDEN_TOOL_NAMES",
    "READ_ONLY_TOOLS",
    "ToolSpec",
    "tool_specs",
]
