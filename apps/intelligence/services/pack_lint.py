"""The pack lint (merge step 8; the build plan's Pack format tab).

A pack is one directory per contract family holding both halves of its domain
knowledge: the drafting half (clauses.yaml, templates/, playbook.yaml — read by
the lifecycle API) and the extraction half (taxonomy.md … coverage.yaml — read
by services/obligation_packs.py). This checks what neither loader can on its
own: that the halves agree, and that nothing ships unreviewed as approved or
without a gate.

A pack that fails lint does not reach either quality gate: a pack with a
dangling obligation class scores fine and does nothing.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import yaml

from services.obligation_packs import BASE_PACK_ID, PACK_ROOT, PackError, load_pack

SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
REVIEW_STATUSES = {"sample", "reviewed", "approved"}
POSITIONS = {"preferred", "acceptable", "fallback", "walkaway"}
RISK_RATINGS = {"favorable", "unfavorable", "neutral", "standard", None}

#: An extractor told to assume fills in what the contract does not say. A
#: default currency is how the SEK bug happened.
DEFAULT_LANGUAGE = re.compile(r"\b(assume[ds]?|default to|defaults to|if unspecified|if not specified|if absent,? use)\b", re.I)
EXTRACTION_FILES = ("taxonomy.md", "sweep.md", "conventions.md", "examples.md")


def _yaml(path: Path) -> Any:
    return yaml.safe_load(path.read_text(encoding="utf-8")) if path.is_file() else None


def lint_pack(directory: Path, *, categories: Set[str], repo_root: Path) -> List[str]:
    """Problems with one pack directory, each prefixed with its id."""
    pid = directory.name
    problems: List[str] = []
    say = lambda msg: problems.append(f"{pid}: {msg}")  # noqa: E731

    manifest = _yaml(directory / "pack.yaml")
    if not isinstance(manifest, dict):
        return [f"{pid}: pack.yaml is missing or not a mapping"]
    if str(manifest.get("id")) != pid:
        say(f"pack.yaml id '{manifest.get('id')}' must match the directory name")
    halves = set(manifest.get("halves") or [])
    if not halves or not halves <= {"drafting", "extraction"}:
        say("pack.yaml must list its halves: drafting and/or extraction")

    has_drafting = (directory / "clauses.yaml").is_file() or (directory / "playbook.yaml").is_file()
    has_extraction = (directory / "taxonomy.md").is_file()
    if has_drafting != ("drafting" in halves):
        say("halves says drafting=%s but the files say %s" % ("drafting" in halves, has_drafting))
    if has_extraction != ("extraction" in halves):
        say("halves says extraction=%s but the files say %s" % ("extraction" in halves, has_extraction))
    if "drafting" in halves and not SEMVER.match(str(manifest.get("version"))):
        say(f"version '{manifest.get('version')}' must be semantic (1.2.0): orgs subscribe to versions")

    # ── extraction half ──────────────────────────────────────────────────
    class_ids: Set[str] = set()
    if has_extraction:
        try:
            pack = load_pack(pid, root=directory.parent)
            class_ids = set(pack.class_ids)
        except PackError as exc:
            say(f"extraction half does not load: {exc}")
        coverage = _yaml(directory / "coverage.yaml") or {}
        floors = {k: v for k, v in coverage.items() if k.endswith("_floor")} if isinstance(coverage, dict) else {}
        # A pack may say outright that it has not been measured yet (no
        # contract of its family in the corpus). That is stated, with a
        # reason, rather than hidden behind invented floors; it is reported as
        # a warning, never as a gated pack.
        unvalidated = isinstance(coverage, dict) and coverage.get("unvalidated") is True
        if unvalidated and not coverage.get("unvalidated_reason"):
            say("coverage.yaml marks the pack unvalidated without an unvalidated_reason")
        if not floors and not unvalidated:
            say("coverage.yaml has no floors: a pack with no floor cannot fail, so it is not gated")
        for key, value in floors.items():
            if not isinstance(value, (int, float)) or value <= 0:
                say(f"coverage.yaml {key} must be a positive number")
        fixture = manifest.get("fixture")
        if not fixture and not unvalidated:
            say("no fixture: both quality gates need a labelled contract to score against")
        elif fixture and not (repo_root / str(fixture)).is_file():
            say(f"fixture '{fixture}' does not exist")
        for name in EXTRACTION_FILES:
            text = (directory / name).read_text(encoding="utf-8") if (directory / name).is_file() else ""
            hit = DEFAULT_LANGUAGE.search(text)
            if hit:
                say(f"{name} uses default-value language ('{hit.group(0)}'): the extractor reports absence, it does not fill it in")

    # ── drafting half ────────────────────────────────────────────────────
    clause_keys: Set[str] = set()
    for entry in _yaml(directory / "clauses.yaml") or []:
        key = entry.get("key")
        where = f"clauses.yaml {key or entry.get('title')}"
        if not key or key in clause_keys:
            say(f"{where}: missing or duplicate key")
        clause_keys.add(key)
        if entry.get("category") not in categories:
            say(f"{where}: unknown category '{entry.get('category')}'")
        if entry.get("risk_rating") not in RISK_RATINGS:
            say(f"{where}: unknown risk_rating '{entry.get('risk_rating')}'")
        review = entry.get("review") or {}
        status = review.get("status")
        if status not in REVIEW_STATUSES:
            say(f"{where}: review.status must be sample, reviewed or approved")
        elif status != "sample":
            missing = [f for f in ("reviewer", "reviewed_on", "jurisdiction") if not review.get(f)]
            if missing:
                say(f"{where}: review.status '{status}' needs {', '.join(missing)} — nothing is approved without a named reviewer")

    position_keys: Set[str] = set()
    for entry in _yaml(directory / "playbook.yaml") or []:
        key = entry.get("key")
        where = f"playbook.yaml {key}"
        if not key or key in position_keys:
            say(f"{where}: missing or duplicate key")
        position_keys.add(key)
        if entry.get("category") not in categories:
            say(f"{where}: unknown category '{entry.get('category')}'")
        if entry.get("position") not in POSITIONS:
            say(f"{where}: position must be one of {', '.join(sorted(POSITIONS))}")
        cls = entry.get("obligation_class")
        if cls is not None and cls not in class_ids:
            say(f"{where}: obligation_class '{cls}' is not a class of this pack's taxonomy — the link between the halves must resolve")
        ck = entry.get("clause_key")
        if ck is not None and ck not in clause_keys:
            say(f"{where}: clause_key '{ck}' is not in clauses.yaml")

    templates = directory / "templates"
    if templates.is_dir():
        for path in sorted(templates.glob("*.yaml")):
            t = _yaml(path) or {}
            if not t.get("name") or not t.get("sections"):
                say(f"templates/{path.name}: needs a name and sections")
    return problems


def unvalidated_packs(root: Optional[Path] = None) -> List[str]:
    """Packs that declare they have no fixture yet — warnings, listed by the lint script."""
    root = root or PACK_ROOT
    return sorted(p.name for p in root.iterdir()
                  if p.is_dir() and (_yaml(p / "coverage.yaml") or {}).get("unvalidated") is True)


def lint_packs(root: Optional[Path] = None, *, repo_root: Optional[Path] = None) -> List[str]:
    """Every problem in every pack under `root` (the repository's packs/)."""
    root = root or PACK_ROOT
    repo_root = repo_root or root.parent
    categories = {c["slug"] for c in (_yaml(root / "universal" / "categories.yaml") or [])}
    if not categories:
        return ["universal: categories.yaml is missing"]
    problems: List[str] = []
    for directory in sorted(p for p in root.iterdir() if p.is_dir() and p.name != BASE_PACK_ID and not p.name.startswith(".")):
        if (directory / "pack.yaml").is_file():
            problems.extend(lint_pack(directory, categories=categories, repo_root=repo_root))
    return problems
