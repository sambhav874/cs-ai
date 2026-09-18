"""Memory assembly for the contract agent.

`AgentMemoryManager` and `ProjectMemoryManager` each own a store. This package
owns the one question neither of them can answer alone: given a run, what does
the model actually get told, and in what order when it does not all fit.
"""

from .composer import (
    ComposedMemory,
    MemoryBlock,
    MemoryComposer,
    MemoryScope,
    TIER_BUDGET_SHARE,
    TOTAL_BUDGET_CHARS,
    recent_turns_block,
)
from .preferences import UserPreferencesManager, preferences_block
from . import lifecycle

__all__ = [
    "lifecycle",
    "ComposedMemory",
    "MemoryBlock",
    "MemoryComposer",
    "MemoryScope",
    "recent_turns_block",
    "TIER_BUDGET_SHARE",
    "TOTAL_BUDGET_CHARS",
    "UserPreferencesManager",
    "preferences_block",
]
