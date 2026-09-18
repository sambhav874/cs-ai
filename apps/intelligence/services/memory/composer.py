"""One entry point that assembles everything the agent is told up front.

Before this module there were two memory managers and no composer. Conversation
memory was `(contract_id, user_id)`-scoped and project memory was
project-scoped, and the only thing that joined them was a route concatenating
one string onto another — so a contract-surface chat inside a project never saw
the project's facts unless the model happened to guess it should call
`get_project_timeline`. Memory the model has to ask for is not memory; it is a
tool with a discovery problem (F-17).

The composer resolves both managers for every run regardless of surface, labels
each block with its tier and where it came from, drops what is already said
elsewhere, and — when it does not all fit — spends the budget in a declared
priority order instead of truncating whichever manager happened to run last.

What stays out, deliberately: per-document overviews. `ProjectMemoryManager`
sends the document *index* here and lets the model pull a full concept by id
through `read_project_concept`. That split predates this module and the
reasoning is documented at `project_memory.build_memory_context` — the index is
what makes the detail discoverable, so the index belongs in the always-on block
and the detail does not.
"""

from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

# The word tokenizer is shared with citation support — both need "same words,
# ignoring noise", and two copies that disagree is the failure F-05 was about.
# See `_dedupe_tokens` for the one thing memory needs that it does not provide.
from services.contract_agent.citations import content_tokens

logger = logging.getLogger(__name__)


# Roughly 1.5k tokens. Larger than the old `MAX_MEMORY_CHARS = 3500`, because
# that cap covered conversation memory alone while project context arrived
# separately and uncapped; this number is the whole always-on block, so the
# ceiling is now real rather than nominal.
TOTAL_BUDGET_CHARS = 6000

# The ceiling the budget may stretch to when a project genuinely has more to
# say. 6000 was sized for a curated fact set and a short document list; a
# project now carries an index that grows with every document and a fact set
# that grows with every schedule revision, so a fixed number starves a large
# project to keep a small one cheap. Demand-based rather than document-count
# based: what matters is how much context actually exists, not how many files
# it came from. Roughly 3k tokens at the ceiling — still small beside a single
# contract, and only spent when there is something to spend it on.
MAX_BUDGET_CHARS = 12000

# Reservations, not hard walls. A tier that does not use its share releases it
# to the others in priority order (see `_allocate`), so a run with no project
# gives its project share to conversation history rather than wasting it.
TIER_BUDGET_SHARE: Dict[str, float] = {
    "episodic": 0.35,
    "semantic": 0.50,
    "procedural": 0.15,
}

# Below this a block is not worth its own heading — a two-line fragment of a
# fact list reads as though the project has two facts, which is worse than the
# model knowing it was not shown them.
MIN_USEFUL_BLOCK_CHARS = 160

# Jaccard over content tokens. Tuned to catch a fact restated in a summary
# ("payment is net 30" vs "the payment terms are net 30") without collapsing
# two genuinely different facts that share a subject.
DEDUPE_SIMILARITY = 0.7

# The heading `ProjectMemoryManager.render_index` emits when it has documents
# to list. Its "no documents" and "no project in scope" returns start
# otherwise, so this is how an empty index is told apart from a real one.
PROJECT_INDEX_PREFIX = "Documents in this project"


@dataclass(frozen=True)
class MemoryScope:
    """Who is asking, about what, and inside which scopes."""

    user_id: str
    question: str = ""
    session_id: Optional[str] = None
    contract_id: Optional[str] = None
    project_id: Optional[str] = None
    surface: str = "contract"


@dataclass
class MemoryBlock:
    """One labelled chunk of the composed context.

    Kept as a structure rather than a pre-rendered string because the panel's
    "what I remember" disclosure (4.5) has to show the model's memory *by tier
    and provenance*, and reconstructing that by re-parsing prose would be a
    second source of truth for what was sent.
    """

    name: str
    tier: str
    heading: str
    body: str
    priority: int
    provenance: str
    truncated: bool = False
    # Shown in place of `provenance` once the block has been cut down. A block
    # whose provenance asserts completeness has to be able to withdraw that
    # claim, or the model is told a partial list is the whole list and will
    # state that a document is absent from a project it is actually in.
    truncated_provenance: Optional[str] = None
    kept_units: int = 0
    total_units: int = 0

    @property
    def size(self) -> int:
        return len(self.render())

    def describe_provenance(self) -> str:
        if not self.truncated:
            return self.provenance
        base = self.truncated_provenance or self.provenance
        if self.total_units and self.kept_units:
            return f"{base} · showing {self.kept_units} of {self.total_units}"
        return f"{base} · shortened to fit"

    def render(self) -> str:
        return f"{self.heading} ({self.describe_provenance()})\n{self.body}".strip()


@dataclass
class ComposedMemory:
    """The composed block, plus what it cost and what did not fit."""

    text: str
    blocks: List[MemoryBlock] = field(default_factory=list)
    dropped: List[str] = field(default_factory=list)
    truncated: List[str] = field(default_factory=list)
    total_chars: int = 0
    budget_chars: int = TOTAL_BUDGET_CHARS

    def as_trace(self) -> Dict[str, Any]:
        return {
            "blocks": [
                {
                    "name": b.name,
                    "tier": b.tier,
                    "chars": b.size,
                    "truncated": b.truncated,
                    "kept_units": b.kept_units,
                    "total_units": b.total_units,
                }
                for b in self.blocks
            ],
            "dropped": list(self.dropped),
            "truncated": list(self.truncated),
            "total_chars": self.total_chars,
            "budget_chars": self.budget_chars,
        }


# Priority is the order the budget is spent, lowest number first.
#
# The plan's order was: recent turns > project facts > session summary >
# semantic recall > preferences. Two additions to it here.
#
# The project index sits at 20, above facts. It is the only block that tells
# the model which sibling documents exist at all; without it a question about a
# sibling document cannot even be recognised as answerable, and every lower
# block is describing a project the model cannot see. It is also cheap — one
# line per document.
#
# Live KPI context sits just under facts because it is the only block that goes
# stale in minutes rather than months.
_PRIORITY = {
    "recent_turns": 10,
    "project_index": 20,
    "project_facts": 30,
    "kpi_context": 40,
    "session_summary": 50,
    "project_notes": 60,
    "past_runs": 65,
    "semantic_recall": 70,
    "preferences": 80,
}

_PREAMBLE = (
    "Memory below is context for continuity only. It is not contract evidence: "
    "never cite it, and prefer fresh retrieval when it disagrees with a document. "
    "Each block states its tier and where it came from."
)


def _split_units(body: str) -> Tuple[List[str], str]:
    """Split a body into the units it is safe to truncate between.

    Facts render as blank-line-delimited blocks and everything else as lines.
    Cutting inside either produces a half-quoted fact or a half-attributed
    turn, which reads as authoritative and is not.
    """
    if "\n\n" in body:
        return [unit for unit in body.split("\n\n") if unit.strip()], "\n\n"
    return [unit for unit in body.split("\n") if unit.strip()], "\n"


def _mark_truncation(block: "MemoryBlock", full_body: str, truncated: bool) -> None:
    """Record that a block was cut down, and by how much.

    The counts are what let the rendered block say "showing 40 of 212" instead
    of only that it was shortened — the difference between a model that knows
    to go and look and one that answers from a partial list.
    """
    block.truncated = truncated
    if truncated:
        block.kept_units = _unit_count(block.body)
        block.total_units = _unit_count(full_body)
    else:
        block.kept_units = 0
        block.total_units = 0


def _unit_count(body: str) -> int:
    """How many truncatable units a body holds — documents in the index,
    facts in the fact list. Reported to the model so a shortened block says
    how much of itself is missing rather than only that it is shortened."""
    units, _ = _split_units(body)
    return len(units)


def _fit(body: str, limit: int) -> Tuple[str, bool]:
    """Trim to `limit` on a unit boundary. Returns (body, was_truncated)."""
    if len(body) <= limit:
        return body, False
    units, sep = _split_units(body)
    kept: List[str] = []
    used = 0
    for unit in units:
        cost = len(unit) + (len(sep) if kept else 0)
        if used + cost > limit:
            break
        kept.append(unit)
        used += cost
    if not kept:
        return "", True
    return sep.join(kept), True


def _dedupe_tokens(text: str) -> Set[str]:
    """Content words *plus* numerals.

    `content_tokens` requires a leading letter, so it sees "notice is 30 days"
    and "notice is 60 days" as the same token set. That is harmless when
    scoring whether a long quote is supported by a longer passage, which is
    what it was written for. Here it is not: two notice periods would score as
    identical and the second would be deleted as a duplicate, leaving the model
    one confidently-stated number and no sign the other existed. In a contract
    the number is usually the whole fact, so dedup counts it.

    Token edges are stripped for the same reason. The shared tokenizer allows
    "." and "-" inside a token so that "12.5%" and "co-operate" survive intact,
    which means a sentence-final "days." and a mid-sentence "days" are two
    different tokens. Across two renderers — one ending its lines with a period
    and one not — that alone drags a restatement below the similarity
    threshold, and the duplicate ships.
    """
    tokens = {token.strip(".-") for token in content_tokens(text)}
    tokens.update(re.findall(r"\d+(?:\.\d+)?", text or ""))
    tokens.discard("")
    return tokens


def _dedupe(body: str, seen: List[Set[str]]) -> str:
    """Drop units already carried by a higher-priority block.

    A fact stated in a project fact block and restated in the session summary
    is the same fact costing twice, and the duplicate makes it look
    corroborated when it has one source.

    Compares only against blocks already accepted, never within the block being
    processed. Each renderer owns its own list and has already decided what
    belongs in it; a fact list whose entries share a subject ("termination
    notice is 60 days", "termination requires written notice") is not repeating
    itself, and collapsing it here would delete records this module never read.
    """
    units, sep = _split_units(body)
    kept: List[str] = []
    produced: List[Set[str]] = []
    for unit in units:
        tokens = _dedupe_tokens(unit)
        if tokens and any(_similar(tokens, prior) for prior in seen):
            continue
        kept.append(unit)
        if tokens:
            produced.append(tokens)
    seen.extend(produced)
    return sep.join(kept)


def _similar(tokens: Set[str], other: Set[str]) -> bool:
    if not tokens or not other:
        return False
    union = tokens | other
    if not union:
        return False
    return len(tokens & other) / len(union) >= DEDUPE_SIMILARITY


def _recall_provenance(records: Sequence[Dict[str, Any]]) -> str:
    """Label recall by what the records actually carry.

    Records written before 2.3 came from the keyword-bucket path: no source, no
    citation, overwritten on every matching turn. Records written after it were
    gated on validated citations. Both can appear in one block, and labelling
    the mixture as though it were uniformly either is how an unreviewed
    fragment gets read as an established fact.
    """
    # Both the un-migrated rows and the ones the migration touched: it gives
    # them an embedding so they are reachable, never provenance they never had.
    legacy = sum(1 for record in records if record.get("origin") in (None, "", "legacy"))
    if legacy == len(records):
        return "prior sessions · unverified, written before memory was gated"
    if legacy:
        return (
            f"prior sessions · cited when recorded, except {legacy} older "
            "unverified record(s)"
        )
    return "prior sessions · recorded only from cited answers, with source quotes"


def recent_turns_block(lines: Sequence[str]) -> MemoryBlock:
    """The conversation-history block, built in one place.

    The eval harness composes this block too — a multi-turn case has to reach
    the agent as the same text a real follow-up does, or the multi-turn metric
    is measuring a format production does not emit. Sharing the constructor is
    what keeps the two from drifting; the previous version was two hand-written
    copies of the same header with a comment asking future readers to keep them
    in step.
    """
    return MemoryBlock(
        name="recent_turns",
        tier="episodic",
        heading="Recent turns in this conversation",
        body="\n".join(lines),
        priority=_PRIORITY["recent_turns"],
        provenance="this session · verbatim",
    )


class MemoryComposer:
    """Assembles `state.memory_context` from every memory store, once per run.

    Both managers are optional so a caller with only one configured — or a test
    with neither — composes what it has instead of failing. Every store read is
    guarded: memory is an enhancement, and a chat that returns nothing because
    a memory collection was unreachable is a worse failure than one answering
    without its history.
    """

    def __init__(
        self,
        *,
        agent_memory: Any = None,
        project_memory: Any = None,
        budget_chars: int = TOTAL_BUDGET_CHARS,
    ) -> None:
        self.agent_memory = agent_memory
        self.project_memory = project_memory
        self.budget_chars = budget_chars

    # ---------------------------------------------------------------- compose

    def compose(
        self,
        scope: MemoryScope,
        *,
        kpi_context: str = "",
        extra_blocks: Sequence[MemoryBlock] = (),
    ) -> ComposedMemory:
        """Build the block. Never raises — a memory failure degrades the answer,
        it does not fail the run.

        `kpi_context` arrives pre-built rather than being loaded here on
        purpose: assembling it needs the caller's already-resolved and
        access-checked document set, and re-resolving that inside the composer
        would put a second scope check in the codebase (F-09's exact shape).
        The composer owns where it ranks and what it costs, not how it is read.
        """
        # Conversation memory and project memory share no data and are ordered
        # afterwards by priority, so which finishes first does not matter.
        # Sequentially they cost the sum of two independent sets of queries.
        sources = self._gather({
            "session blocks": lambda: self._session_blocks(scope),
            "project blocks": lambda: self._project_blocks(scope),
        })
        blocks: List[MemoryBlock] = [
            *(sources.get("session blocks") or []),
            *(sources.get("project blocks") or []),
        ]
        if kpi_context.strip():
            blocks.append(
                MemoryBlock(
                    name="kpi_context",
                    tier="semantic",
                    heading="Tracked KPIs and current operational status",
                    body=kpi_context.strip(),
                    priority=_PRIORITY["kpi_context"],
                    provenance="live KPI records · current as of this run",
                )
            )
        blocks.extend(extra_blocks)

        blocks.sort(key=lambda b: b.priority)
        blocks = self._dedupe_blocks(blocks)
        budget_chars = self._budget_for(blocks)
        kept, dropped = self._allocate(blocks, budget=budget_chars)

        rendered = [_PREAMBLE, *[block.render() for block in kept]]
        text = "\n\n".join(part for part in rendered if part.strip())
        return ComposedMemory(
            text=text,
            blocks=kept,
            dropped=dropped,
            truncated=[block.name for block in kept if block.truncated],
            total_chars=len(text),
            # The budget this run actually had, not the configured floor —
            # otherwise the trace reports a ceiling the allocator never used.
            budget_chars=budget_chars,
        )

    # ----------------------------------------------------------------- blocks

    def _session_blocks(self, scope: MemoryScope) -> List[MemoryBlock]:
        """Conversation history, split into its real tiers.

        `AgentMemoryManager.build_memory_context` returns one pre-joined string
        holding three different things at three different freshnesses. They are
        read separately here so the budget can keep the last four turns and
        drop a stale semantic recall, rather than truncating all three at once
        from whichever end the concatenation put last.
        """
        manager = self.agent_memory
        if manager is None or not scope.session_id or not scope.contract_id:
            return []

        blocks: List[MemoryBlock] = []
        session = self._safe(
            lambda: manager.sessions.find_one(
                {
                    "session_id": scope.session_id,
                    "contract_id": scope.contract_id,
                    "user_id": scope.user_id,
                    "archived_at": {"$exists": False},
                }
            ),
            "session lookup",
        )
        if not session:
            return []

        # Recent turns, past episodes and semantic recall come from three
        # different collections and none depends on the others.
        fetched = self._gather({
            "recent turns": lambda: self._recent_turns(scope),
            "run episodes": lambda: manager.recent_episodes(
                contract_id=scope.contract_id,
                user_id=scope.user_id,
                exclude_session_id=scope.session_id,
            ),
            "semantic recall": lambda: manager._semantic_memories(
                contract_id=scope.contract_id,
                user_id=scope.user_id,
                question=scope.question,
            ),
        })

        recent = fetched.get("recent turns") or []
        if recent:
            blocks.append(recent_turns_block(recent))

        summary = str(session.get("summary") or "").strip()
        if summary:
            blocks.append(
                MemoryBlock(
                    name="session_summary",
                    tier="episodic",
                    heading="Earlier in this conversation",
                    body=summary,
                    priority=_PRIORITY["session_summary"],
                    provenance="this session · summarised, may omit detail",
                )
            )

        episodes = fetched.get("run episodes") or []
        if episodes:
            blocks.append(
                MemoryBlock(
                    name="past_runs",
                    tier="episodic",
                    heading="What has already been checked on this contract",
                    body="\n".join(
                        f"- {episode.get('summary')}"
                        for episode in episodes
                        if str(episode.get("summary") or "").strip()
                    ),
                    priority=_PRIORITY["past_runs"],
                    provenance="earlier sessions · what the agent did, not what it concluded",
                )
            )

        recalled = fetched.get("semantic recall") or []
        if recalled:
            lines = [
                "- {key}: {content}{flag}".format(
                    key=item.get("memory_key"),
                    content=str(item.get("content") or "").strip(),
                    flag=" **[needs review — a source document was amended]**"
                    if item.get("needs_review")
                    else "",
                )
                for item in recalled
                if str(item.get("content") or "").strip()
            ]
            if lines:
                blocks.append(
                    MemoryBlock(
                        name="semantic_recall",
                        tier="semantic",
                        heading="Recalled from earlier sessions on this contract",
                        body="\n".join(lines),
                        priority=_PRIORITY["semantic_recall"],
                        provenance=_recall_provenance(recalled),
                    )
                )
        return blocks

    def _recent_turns(self, scope: MemoryScope) -> List[str]:
        from services.agent_memory import RECENT_MESSAGE_LIMIT, _clean_text

        docs = list(
            self.agent_memory.messages.find(
                {
                    "session_id": scope.session_id,
                    "contract_id": scope.contract_id,
                    "user_id": scope.user_id,
                },
                {"role": 1, "content": 1, "created_at": 1},
            )
            .sort("created_at", -1)
            .limit(RECENT_MESSAGE_LIMIT)
        )
        docs.reverse()
        return [
            f"- {'User' if doc.get('role') == 'user' else 'Assistant'}: "
            f"{_clean_text(doc.get('content'), 360)}"
            for doc in docs
        ]

    def _project_blocks(self, scope: MemoryScope) -> List[MemoryBlock]:
        """Project index, facts and notes — sent on every surface.

        This is the block that F-17 was about. It is composed for a contract
        chat too, not only a project chat, because the contract being discussed
        sits inside the project and its amendments are sibling documents.
        """
        manager = self.project_memory
        if manager is None or not scope.project_id:
            return []

        blocks: List[MemoryBlock] = []
        # Index, facts and notes live in three collections and none feeds the
        # others. Rendering the facts needs the fact list, so that pair stays
        # together inside one call rather than becoming two round trips.
        fetched = self._gather({
            "project index": lambda: manager.render_index(scope.project_id),
            "project facts": lambda: self._facts_with_rendering(manager, scope.project_id),
            "project notes": lambda: manager.get_notes(scope.project_id),
        })

        index = fetched.get("project index")
        # Matched on the renderer's own prefix rather than sniffing for its
        # "no documents" / "no project in scope" sentinels. Substring-matching
        # those would also reject a real index whose first document happens to
        # be called something like "No documents policy.pdf", dropping the one
        # block that tells the model the project has contents at all.
        if index and index.startswith(PROJECT_INDEX_PREFIX):
            blocks.append(
                MemoryBlock(
                    name="project_index",
                    tier="semantic",
                    heading="Documents in this project",
                    body=index,
                    priority=_PRIORITY["project_index"],
                    provenance="project index · complete, read a concept by id for detail",
                    # The index is complete when it is sent whole, and it is
                    # the only block that claims to be. A project with enough
                    # documents to overflow the budget is exactly when that
                    # claim turns into a false one — the model concludes a
                    # document is not in the project because it cannot see it.
                    truncated_provenance=(
                        "project index · PARTIAL, not every document in the project · "
                        "call list_documents for the full list before concluding "
                        "a document is absent"
                    ),
                )
            )

        facts, rendered = fetched.get("project facts") or ([], None)
        if facts:
            if rendered:
                needs_review = sum(1 for fact in facts if fact.get("needs_review"))
                provenance = "project facts · recorded on request, each with its source"
                if needs_review:
                    provenance += f" · {needs_review} flagged for review after an amendment"
                blocks.append(
                    MemoryBlock(
                        name="project_facts",
                        tier="semantic",
                        heading="Facts recorded for this project",
                        body=rendered,
                        priority=_PRIORITY["project_facts"],
                        provenance=provenance,
                    )
                )

        notes = fetched.get("project notes") or {}
        note_text = str(notes.get("content") or "").strip()
        if note_text:
            blocks.append(
                MemoryBlock(
                    name="project_notes",
                    tier="semantic",
                    heading="Notes written by the team",
                    body=note_text,
                    priority=_PRIORITY["project_notes"],
                    provenance="written by a person · authoritative on intent, not on contract text",
                )
            )
        return blocks

    # ------------------------------------------------------------- budgeting

    def _dedupe_blocks(self, blocks: List[MemoryBlock]) -> List[MemoryBlock]:
        seen: List[Set[str]] = []
        kept: List[MemoryBlock] = []
        for block in blocks:
            body = _dedupe(block.body, seen)
            if not body.strip():
                continue
            block.body = body
            kept.append(block)
        return kept

    def _budget_for(self, blocks: List[MemoryBlock]) -> int:
        """How much this particular run is allowed to spend.

        The budget stretches toward what the project actually has, up to a
        ceiling, instead of holding every project to the size of a small one.
        A caller that set an explicit budget keeps it exactly — the tests and
        the callers that pin a size are asking for a fixed number, not a floor.
        """
        if self.budget_chars != TOTAL_BUDGET_CHARS:
            return self.budget_chars
        demand = sum(len(block.body) for block in blocks)
        return max(TOTAL_BUDGET_CHARS, min(MAX_BUDGET_CHARS, demand))

    def _allocate(
        self,
        blocks: List[MemoryBlock],
        *,
        budget: Optional[int] = None,
    ) -> Tuple[List[MemoryBlock], List[str]]:
        """Spend the budget in priority order, tier reservations first.

        Three passes. The first gives each block what its tier reserved, so a
        cheap high-priority block cannot be starved by an expensive one above
        it in a different tier. The second hands out whatever the tiers did not
        claim to blocks that got nothing usable. The third gives what is *still*
        unclaimed to blocks that were kept but truncated.

        That third pass is not an optimisation. Without it a block trimmed in
        pass one was final, so a run could truncate the facts while thousands of
        episodic and procedural chars sat unspent because those tiers had no
        content — the common case for a project with no chat history.
        """
        budget_chars = self.budget_chars if budget is None else budget
        remaining_tier = {
            tier: int(budget_chars * share) for tier, share in TIER_BUDGET_SHARE.items()
        }
        total_left = budget_chars
        kept: List[MemoryBlock] = []
        dropped: List[str] = []
        pending: List[Tuple[MemoryBlock, int]] = []

        # Kept but trimmed in pass one, with the untrimmed body, for pass three.
        trimmed: List[Tuple[MemoryBlock, str]] = []

        for block in blocks:
            tier_left = remaining_tier.get(block.tier, 0)
            allowance = min(tier_left, total_left)
            full_body = block.body
            body, truncated = _fit(block.body, allowance)
            if len(body) < MIN_USEFUL_BLOCK_CHARS and len(block.body) > len(body):
                # Nothing usable fit in the reservation. Hold it for pass two
                # rather than dropping it — the shared pool may cover it.
                pending.append((block, allowance))
                continue
            spent = len(body)
            block.body = body
            _mark_truncation(block, full_body, truncated)
            kept.append(block)
            remaining_tier[block.tier] = tier_left - spent
            total_left -= spent
            if truncated:
                trimmed.append((block, full_body))

        for block, already in pending:
            shared = total_left + max(0, remaining_tier.get(block.tier, 0) - already)
            full_body = block.body
            body, truncated = _fit(block.body, shared)
            if len(body) < MIN_USEFUL_BLOCK_CHARS:
                dropped.append(block.name)
                continue
            block.body = body
            _mark_truncation(block, full_body, truncated)
            kept.append(block)
            total_left -= len(body)
            if truncated:
                trimmed.append((block, full_body))

        # Pass three: hand whatever is left to the blocks that were cut short,
        # highest priority first, so the budget is actually spent before
        # anything is reported as truncated.
        for block, full_body in sorted(trimmed, key=lambda pair: pair[0].priority):
            if total_left <= 0:
                break
            grown, truncated = _fit(full_body, len(block.body) + total_left)
            if len(grown) <= len(block.body):
                continue
            total_left -= len(grown) - len(block.body)
            block.body = grown
            _mark_truncation(block, full_body, truncated)

        kept.sort(key=lambda b: b.priority)
        return kept, dropped

    # ---------------------------------------------------------------- helpers

    @staticmethod
    def _facts_with_rendering(manager: Any, project_id: str):
        """The fact list and its rendering from one read.

        `render_facts` would otherwise fetch the list a second time, and the
        composer needs both the objects (to count what needs review) and the
        rendered text.
        """
        facts = manager.list_facts(project_id)
        if not facts:
            return [], None
        return facts, manager.render_facts(project_id, facts)

    def _gather(self, calls: Dict[str, Any]) -> Dict[str, Any]:
        """Run independent reads at the same time instead of one after another.

        Every source here is a separate Mongo collection and none of them feed
        each other, but they were read in sequence — and against Atlas a round
        trip costs about 200ms whatever it returns, so composing memory took as
        long as the sum of six unrelated queries. Run together it costs as long
        as the slowest one.

        Each call keeps `_safe` semantics: a source that fails returns None and
        the rest of the memory is still composed, which is the property that
        makes a memory outage degrade an answer rather than fail a run.
        """
        if not calls:
            return {}
        if len(calls) == 1:
            key, call = next(iter(calls.items()))
            return {key: self._safe(call, key)}

        results: Dict[str, Any] = {}
        with ThreadPoolExecutor(max_workers=len(calls)) as pool:
            futures = {
                pool.submit(self._safe, call, what): what
                for what, call in calls.items()
            }
            for future in futures:
                results[futures[future]] = future.result()
        return results

    @staticmethod
    def _safe(call, what: str):
        try:
            return call()
        except Exception:
            logger.debug("Memory composition skipped %s", what, exc_info=True)
            return None
