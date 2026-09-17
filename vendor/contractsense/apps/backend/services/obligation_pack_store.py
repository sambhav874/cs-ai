"""Storage for customer-uploaded obligation packs.

Packs ship two ways: built-in families under ``packs/obligations/`` (reviewed in
the repo) and packs a workspace uploads for its own contract types. Both are
validated by the same code in ``obligation_packs``; only their provenance
differs, and that difference is stamped on every record so a recall movement can
be traced to whichever it was.

The invariant this module exists to hold: **a pack only ever reaches contracts of
the workspace that uploaded it.** Resolution scores a candidate list, and the
candidate list is assembled here from the caller's owner scope plus the
built-ins. Nothing widens that scope.
"""

from __future__ import annotations

import hashlib
import io
import logging
import zipfile
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import yaml
from bson import ObjectId

from services.obligation_packs import (
    MAX_COVERAGE_CHARS,
    MAX_MANIFEST_CHARS,
    MAX_PACK_CHARS,
    MAX_SECTION_CHARS,
    ObligationPack,
    PackContent,
    PackError,
    SECTION_ORDER,
    build_pack,
    builtin_packs,
    load_base_sections,
    validate_pack_content,
)

logger = logging.getLogger(__name__)

#: Uncompressed ceiling for an uploaded archive. Enforced against the sum of the
#: declared sizes *before* reading any entry, so a zip bomb never reaches memory.
MAX_ARCHIVE_UNCOMPRESSED_BYTES = MAX_PACK_CHARS + MAX_MANIFEST_CHARS + MAX_COVERAGE_CHARS + 8192
MAX_ARCHIVE_ENTRIES = 24
MAX_COMPRESSION_RATIO = 200

_ALLOWED_FILENAMES = frozenset(
    [f"{section}.md" for section in SECTION_ORDER] + ["pack.yaml", "coverage.yaml"]
)


_INDEX_READY = False


def packs_collection():
    global _INDEX_READY
    from core.database import core_db

    collection = core_db["obligation_packs"]
    if not _INDEX_READY:
        try:
            # One pack per family per owner. Without this two concurrent saves
            # both miss the find_one and insert, after which `find_one` returns
            # whichever the server happens to reach first — so the pack a
            # contract is extracted with becomes non-deterministic.
            collection.create_index(
                [("family_id", 1), ("ownerType", 1), ("ownerId", 1)],
                unique=True,
                name="idx_pack_family_owner_unique",
            )
        except Exception as exc:  # an existing duplicate would block creation
            logger.warning("Could not create the obligation pack uniqueness index: %s", exc)
        _INDEX_READY = True
    return collection


# ── archive parsing ────────────────────────────────────────────────────────


def parse_pack_archive(data: bytes) -> Tuple[PackContent, List[str]]:
    """Read an uploaded .zip into pack content. Returns (content, problems).

    Rejects before reading: too many entries, nested paths, absolute paths,
    unknown filenames, an implausible compression ratio, and a declared
    uncompressed size over the cap. Everything an attacker controls is checked
    against the header, not against what actually lands in memory.
    """
    problems: List[str] = []
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return PackContent(), ["Upload is not a readable .zip archive"]

    entries = [info for info in archive.infolist() if not info.is_dir()]
    if len(entries) > MAX_ARCHIVE_ENTRIES:
        return PackContent(), [f"Archive has {len(entries)} files; the limit is {MAX_ARCHIVE_ENTRIES}"]

    declared = sum(info.file_size for info in entries)
    if declared > MAX_ARCHIVE_UNCOMPRESSED_BYTES:
        return PackContent(), [
            f"Archive expands to {declared} bytes; the limit is {MAX_ARCHIVE_UNCOMPRESSED_BYTES}"
        ]
    compressed = sum(info.compress_size for info in entries) or 1
    if declared / compressed > MAX_COMPRESSION_RATIO:
        return PackContent(), ["Archive compression ratio is implausible; refusing to expand it"]

    manifest: Dict[str, Any] = {}
    coverage: Dict[str, Any] = {}
    sections: Dict[str, str] = {}

    for info in entries:
        # A pack is flat.  Anything with a directory component is either a
        # traversal attempt or a zipped-up parent folder; naming the second case
        # is the difference between a usable error and a mystery.
        name = info.filename.rsplit("/", 1)[-1]
        if info.filename != name:
            problems.append(
                f"'{info.filename}' is nested; zip the five pack files themselves, not the folder "
                "containing them"
            )
            continue
        if name.startswith(".") or name not in _ALLOWED_FILENAMES:
            problems.append(f"'{name}' is not a pack file; allowed: {', '.join(sorted(_ALLOWED_FILENAMES))}")
            continue

        try:
            raw = archive.read(info).decode("utf-8")
        except UnicodeDecodeError:
            problems.append(f"'{name}' is not valid UTF-8 text")
            continue

        if name == "pack.yaml":
            manifest, error = _safe_yaml(raw, "pack.yaml", MAX_MANIFEST_CHARS)
            if error:
                problems.append(error)
        elif name == "coverage.yaml":
            coverage, error = _safe_yaml(raw, "coverage.yaml", MAX_COVERAGE_CHARS)
            if error:
                problems.append(error)
        else:
            sections[name[: -len(".md")]] = raw.strip()

    if not manifest and not any("pack.yaml" in problem for problem in problems):
        problems.append("Archive has no pack.yaml")

    return PackContent(manifest=manifest, sections=sections, coverage=coverage), problems


def _safe_yaml(raw: str, name: str, limit: int) -> Tuple[Dict[str, Any], Optional[str]]:
    if len(raw) > limit:
        return {}, f"{name} is {len(raw)} characters; the limit is {limit}"
    try:
        data = yaml.safe_load(raw) or {}
    except yaml.YAMLError as exc:
        return {}, f"{name} is not valid YAML: {exc}"
    if not isinstance(data, dict):
        return {}, f"{name} is not a mapping"
    return data, None


def content_fingerprint(content: PackContent) -> str:
    """Stable hash of what the model will actually be shown."""
    digest = hashlib.sha256()
    for section in SECTION_ORDER:
        digest.update(section.encode())
        digest.update((content.sections.get(section) or "").encode())
    digest.update(yaml.safe_dump(content.manifest, sort_keys=True).encode())
    return digest.hexdigest()[:16]


# ── persistence ────────────────────────────────────────────────────────────


def save_pack(
    *,
    family_id: str,
    content: PackContent,
    owner_type: str,
    owner_id: ObjectId,
    user_id: str,
) -> Dict[str, Any]:
    """Validate and store one uploaded pack. Raises PackError with every problem.

    Uploading the same family id again supersedes the previous pack and bumps
    its version, so the version on a record always identifies exactly the text
    that produced it.
    """
    problems = validate_pack_content(family_id, content)
    if problems:
        raise PackError("Pack rejected:\n  " + "\n  ".join(problems), problems)

    # Built-in family ids are reserved: shadowing one would make a record's
    # `pack_id` ambiguous between reviewed and uploaded text.
    if family_id in {pack.id for pack in builtin_packs()}:
        raise PackError(
            f"'{family_id}' is a built-in family. Choose a different id; built-in packs cannot be "
            "shadowed."
        )

    collection = packs_collection()
    existing = collection.find_one(
        {"family_id": family_id, "ownerType": owner_type, "ownerId": owner_id}
    )
    version = int((existing or {}).get("version") or 0) + 1
    now = datetime.utcnow()

    document = {
        "family_id": family_id,
        "version": version,
        "display_name": str(content.manifest.get("display_name") or family_id),
        "manifest": content.manifest,
        "sections": content.sections,
        "coverage": content.coverage,
        "fingerprint": content_fingerprint(content),
        "ownerType": owner_type,
        "ownerId": owner_id,
        "uploaded_by": user_id,
        "updated_at": now,
        "enabled": (existing or {}).get("enabled", True),
    }
    if existing:
        collection.update_one({"_id": existing["_id"]}, {"$set": document})
        document["_id"] = existing["_id"]
        document["created_at"] = existing.get("created_at") or now
    else:
        document["created_at"] = now
        document["_id"] = collection.insert_one(document).inserted_id

    logger.info(
        "Stored obligation pack '%s' v%s for %s %s (fingerprint %s)",
        family_id,
        version,
        owner_type,
        owner_id,
        document["fingerprint"],
    )
    return document


def owner_scope(current_user: Any) -> List[Dict[str, Any]]:
    """The owner filters a user may **read** packs through — their own and their teams'.

    Read scope only. Writes go through :func:`write_scope`: membership of a team
    is not authority to delete or disable that team's packs, and a pack applies
    to every contract in the account, so one member turning one off changes
    extraction for everyone.
    """
    scope: List[Dict[str, Any]] = [{"ownerType": "user", "ownerId": ObjectId(current_user.id)}]
    team_ids = [
        ObjectId(team_id)
        for team_id in ([current_user.ownedAccountId] + (current_user.teamIds or []))
        if team_id and ObjectId.is_valid(str(team_id))
    ]
    if team_ids:
        scope.append({"ownerType": "team", "ownerId": {"$in": team_ids}})
    return scope


def list_pack_documents(scope: List[Dict[str, Any]], *, enabled_only: bool = False) -> List[Dict[str, Any]]:
    query: Dict[str, Any] = {"$or": scope} if scope else {"_id": None}
    if enabled_only:
        query["enabled"] = True
    return list(packs_collection().find(query).sort("family_id", 1))


def document_to_pack(document: Dict[str, Any]) -> ObligationPack:
    """Rebuild a stored pack, re-validating it on the way out.

    Re-validation is not redundant: a validation rule added after a pack was
    stored must apply to it, and a document edited outside this module must not
    reach a prompt unchecked.
    """
    manifest = dict(document.get("manifest") or {})
    manifest.setdefault("id", document.get("family_id"))
    manifest["version"] = int(document.get("version") or 1)
    return build_pack(
        str(document.get("family_id")),
        PackContent(
            manifest=manifest,
            sections=dict(document.get("sections") or {}),
            coverage=dict(document.get("coverage") or {}),
        ),
        base_sections=load_base_sections(),
        origin="uploaded",
    )


def disabled_builtins(scope: List[Dict[str, Any]]) -> set:
    """Built-in family ids this owner has switched off.

    A built-in pack needs an off switch for the same reason an uploaded one
    does: a pack that cannot be disabled cannot be compared against its own
    absence, so nobody can show what it is worth or rule it out when extraction
    looks wrong. Stored as a marker document rather than a copy of the pack, so
    turning one back on restores the reviewed version, not a stale fork.
    """
    query: Dict[str, Any] = {"$or": scope, "disabled_builtin": True} if scope else {"_id": None}
    return {str(doc.get("family_id")) for doc in packs_collection().find(query, {"family_id": 1})}


def packs_for_owner(scope: List[Dict[str, Any]]) -> List[ObligationPack]:
    """Every pack this scope may use: its uploads plus the built-ins it has left on.

    An unloadable stored pack is skipped with a warning rather than failing the
    extraction — one bad upload must not stop a workspace extracting contracts.
    """
    packs: List[ObligationPack] = []
    for document in list_pack_documents(scope, enabled_only=True):
        if document.get("disabled_builtin"):
            continue
        try:
            packs.append(document_to_pack(document))
        except PackError as exc:
            logger.warning(
                "Skipping stored pack '%s' for %s: %s",
                document.get("family_id"),
                document.get("ownerId"),
                exc,
            )
    turned_off = disabled_builtins(scope)
    packs.extend(pack for pack in builtin_packs() if pack.id not in turned_off)
    return packs


def set_builtin_enabled(
    *, family_id: str, enabled: bool, scopes: List[Dict[str, Any]], user_id: str
) -> None:
    """Switch a built-in pack on or off across every scope this person owns.

    A marker written against one scope only does not work: contracts in a
    personal workspace are owned by the user, contracts in a team workspace by
    the account, and extraction resolves packs from *the contract's* owner.
    Storing the preference against the account alone left personal contracts
    still using a pack the UI reported as off — the switch appeared to work and
    changed nothing.
    """
    from datetime import datetime

    collection = packs_collection()
    for scope in scopes:
        owner_id = scope.get("ownerId")
        if isinstance(owner_id, dict):   # {"$in": [...]} from a read scope
            continue
        key = {"family_id": family_id, "ownerType": scope.get("ownerType"), "ownerId": owner_id}
        if enabled:
            collection.delete_one({**key, "disabled_builtin": True})
            continue
        collection.update_one(
            key,
            {"$set": {**key, "disabled_builtin": True, "enabled": False,
                      "uploaded_by": user_id, "updated_at": datetime.utcnow()}},
            upsert=True,
        )


def write_scope(current_user: Any) -> List[Dict[str, Any]]:
    """The owner filters a user may modify packs through.

    Narrower than :func:`owner_scope` on purpose: a user may read the packs of
    every team they belong to, but may only change their own and those of the
    account they own.
    """
    scope: List[Dict[str, Any]] = [{"ownerType": "user", "ownerId": ObjectId(current_user.id)}]
    account_id = getattr(current_user, "ownedAccountId", None)
    if account_id and ObjectId.is_valid(str(account_id)):
        scope.append({"ownerType": "team", "ownerId": ObjectId(str(account_id))})
    return scope
