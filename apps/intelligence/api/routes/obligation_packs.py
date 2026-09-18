"""Upload and manage contract-family obligation packs.

A pack is reference text that is concatenated into the extraction prompt for
every clause batch of every contract it matches. That makes an uploaded pack
untrusted input on a prompt-injection surface, so every route here validates
before it stores, and ``services/obligation_packs`` validates again before it
renders — a pack stored before a rule existed must not slip past that rule.

The dry-run route exists for the same reason the linter does: an uploader should
find out what is wrong with a pack before it is anywhere near a contract.
"""

import logging
from typing import Any, Dict, List, Optional

from bson import ObjectId
import yaml
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from core.security import get_current_active_user
from models.domain import UserInDB
from services.obligation_pack_store import (
    content_fingerprint,
    packs_for_owner,
    document_to_pack,
    list_pack_documents,
    owner_scope,
    packs_collection,
    parse_pack_archive,
    save_pack,
    set_builtin_enabled,
    write_scope,
)
from services.obligation_packs import (
    DEFAULT_CONFIDENCE_FLOOR,
    PackContent,
    PackError,
    build_pack,
    builtin_packs,
    estimate_tokens,
    load_base_sections,
    render_pack_block,
    resolve_family,
    score_pack,
    validate_pack_content,
)

logger = logging.getLogger(__name__)

obligation_packs_router = APIRouter(prefix="/obligation-packs")

#: Compressed upload cap. The uncompressed cap lives in the store, checked
#: against the archive header before anything is expanded.
MAX_UPLOAD_BYTES = 1_000_000

#: Contract text read for a resolution preview. Routing reads the whole document
#: in production; this only has to be enough to score the same way.
MAX_CONTRACT_PREVIEW_BYTES = 400_000


def _resolve_owner(current_user: UserInDB) -> tuple[str, ObjectId]:
    """Packs belong to the account: the team account when there is one, else the user.

    Not a user-facing choice. A pack describes a document family, so scoping it
    below the account only creates copies that drift apart, and scoping it above
    would leak one customer's domain knowledge into another's prompts.
    """
    account_id = current_user.ownedAccountId
    if account_id and ObjectId.is_valid(str(account_id)):
        return "team", ObjectId(str(account_id))
    return "user", ObjectId(current_user.id)


def _summary(document: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "family_id": document.get("family_id"),
        "display_name": document.get("display_name"),
        "version": document.get("version"),
        "fingerprint": document.get("fingerprint"),
        "enabled": document.get("enabled", True),
        "owner_type": document.get("ownerType"),
        "sections": sorted((document.get("sections") or {}).keys()),
        "uploaded_by": document.get("uploaded_by"),
        "created_at": document.get("created_at"),
        "updated_at": document.get("updated_at"),
    }


async def _read_archive(file: UploadFile) -> bytes:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Upload is {len(data)} bytes; the limit is {MAX_UPLOAD_BYTES}.",
        )
    return data


@obligation_packs_router.get("")
def list_obligation_packs(
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """Packs this user may use: their workspace's uploads, plus the built-ins."""
    from services.obligation_pack_store import disabled_builtins

    scope = owner_scope(current_user)
    turned_off = disabled_builtins(scope)
    uploaded = [
        _summary(document)
        for document in list_pack_documents(scope)
        if not document.get("disabled_builtin")
    ]
    builtin = [
        {
            "family_id": pack.id,
            "display_name": pack.display_name,
            "version": pack.version,
            "enabled": pack.id not in turned_off,
            "owner_type": "builtin",
            "sections": sorted(pack.sections.keys()),
            "context_tokens": estimate_tokens(render_pack_block(pack)),
            "max_context_tokens": pack.max_context_tokens,
        }
        for pack in builtin_packs()
    ]
    return {"uploaded": uploaded, "builtin": builtin}


@obligation_packs_router.post("/validate")
async def validate_obligation_pack(
    file: Optional[UploadFile] = File(None),
    family_id: str = Form(...),
    manifest: Optional[str] = Form(None),
    taxonomy: Optional[str] = Form(None),
    conventions: Optional[str] = Form(None),
    sweep: Optional[str] = Form(None),
    examples: Optional[str] = Form(None),
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """Dry run: report every problem with a pack without storing it."""
    content, problems = await _content_from_request(
        file, taxonomy, conventions, sweep, examples, manifest
    )
    problems = problems + validate_pack_content(family_id, content)

    preview = ""
    context_tokens = None
    if not problems:
        try:
            pack = build_pack(
                family_id,
                content,
                base_sections=load_base_sections(),
                origin="uploaded",
            )
            preview = render_pack_block(pack)
            context_tokens = estimate_tokens(preview)
        except PackError as exc:
            problems.append(str(exc))

    return {
        "family_id": family_id,
        "valid": not problems,
        "problems": problems,
        "fingerprint": content_fingerprint(content) if not problems else None,
        "context_tokens": context_tokens,
        # The exact block the model would be shown.  A pack author reviewing
        # their own text in the shape the model receives it is the cheapest
        # check available against a pack that reads as an instruction.
        "rendered_preview": preview,
    }


async def _content_from_request(
    file: Optional[UploadFile],
    taxonomy: Optional[str],
    conventions: Optional[str],
    sweep: Optional[str],
    examples: Optional[str],
    manifest: Optional[str],
) -> tuple[PackContent, List[str]]:
    """A pack arrives as a .zip or as pasted text. Both end up here.

    Pasting exists because most packs are written by hand and zipping five small
    markdown files to try a wording change is friction with no purpose. Both
    paths produce the same PackContent and run the same validation — there is no
    second, laxer route in.
    """
    if file is not None:
        return parse_pack_archive(await _read_archive(file))

    sections = {
        "taxonomy": (taxonomy or "").strip(),
        "conventions": (conventions or "").strip(),
        "sweep": (sweep or "").strip(),
        "examples": (examples or "").strip(),
    }
    sections = {name: body for name, body in sections.items() if body}

    parsed_manifest: Dict[str, Any] = {}
    problems: List[str] = []
    if manifest and manifest.strip():
        try:
            loaded = yaml.safe_load(manifest)
            if isinstance(loaded, dict):
                parsed_manifest = loaded
            else:
                problems.append("pack.yaml is not a mapping")
        except yaml.YAMLError as exc:
            problems.append(f"pack.yaml is not valid YAML: {exc}")

    return PackContent(manifest=parsed_manifest, sections=sections), problems


@obligation_packs_router.post("", status_code=status.HTTP_201_CREATED)
async def upload_obligation_pack(
    file: Optional[UploadFile] = File(None),
    family_id: str = Form(...),
    manifest: Optional[str] = Form(None),
    taxonomy: Optional[str] = Form(None),
    conventions: Optional[str] = Form(None),
    sweep: Optional[str] = Form(None),
    examples: Optional[str] = Form(None),
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """Save a pack for this account. Re-saving a family id bumps its version.

    Scoped to the account, not the project: a pack describes a *document family*,
    and the same family turns up in every project the account runs. Per-project
    packs would mean re-uploading the same text for each one and would let two
    projects drift to different versions of the same family.
    """
    resolved_owner_type, owner_id = _resolve_owner(current_user)
    content, problems = await _content_from_request(
        file, taxonomy, conventions, sweep, examples, manifest
    )
    if problems:
        raise HTTPException(status_code=400, detail={"problems": problems})

    try:
        document = save_pack(
            family_id=family_id,
            content=content,
            owner_type=resolved_owner_type,
            owner_id=owner_id,
            user_id=str(current_user.id),
        )
    except PackError as exc:
        # exc.problems, not the message split on newlines: a problem quotes the
        # offending excerpt and excerpts contain newlines.
        raise HTTPException(status_code=400, detail={"problems": exc.problems})

    pack = document_to_pack(document)
    return {
        **_summary(document),
        "context_tokens": estimate_tokens(render_pack_block(pack)),
        "max_context_tokens": pack.max_context_tokens,
    }


@obligation_packs_router.post("/resolve")
async def resolve_obligation_pack(
    file: Optional[UploadFile] = File(None),
    text: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """Which pack would this contract get, and what would the model be shown?

    Runs the real resolver over this workspace's packs plus the built-ins, with
    no model call and nothing stored. Returns every pack's score and the signals
    that hit, because a pack that misses its own family is usually a marker
    problem and that is only diagnosable if the near-misses are visible too.
    """
    if file is not None:
        raw = await file.read()
        if len(raw) > MAX_CONTRACT_PREVIEW_BYTES:
            raw = raw[:MAX_CONTRACT_PREVIEW_BYTES]
        try:
            body = raw.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=400,
                detail="Could not read that file as text. Paste the contract text instead, or "
                "upload the extracted .txt/.md rather than a PDF.",
            )
        contract_title = title or file.filename or ""
    else:
        body = (text or "")[:MAX_CONTRACT_PREVIEW_BYTES]
        contract_title = title or ""

    if not body.strip():
        raise HTTPException(status_code=400, detail="Provide contract text or a text file.")

    packs = packs_for_owner(owner_scope(current_user))
    resolution = resolve_family(title=contract_title, body=body, packs=packs)

    scored = []
    for pack in packs:
        confidence, signals = score_pack(pack, title=contract_title, body=body)
        scored.append(
            {
                "family_id": pack.id,
                "display_name": pack.display_name,
                "origin": pack.origin,
                "confidence": round(confidence, 3),
                "signals": signals,
            }
        )
    scored.sort(key=lambda entry: -entry["confidence"])

    return {
        "title": contract_title,
        "characters": len(body),
        "applied": resolution.applied,
        "resolved_family": resolution.pack.id if resolution.pack else None,
        "confidence": round(resolution.confidence, 3),
        "reason": resolution.reason,
        "confidence_floor": DEFAULT_CONFIDENCE_FLOOR,
        "candidates": scored,
        "rendered_preview": render_pack_block(resolution.pack) if resolution.applied else "",
    }


@obligation_packs_router.patch("/{family_id}")
def set_obligation_pack_enabled(
    family_id: str,
    enabled: bool,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """Turn a pack off without deleting it — the ablation control, and the fix
    when a pack is suspected of hurting extraction."""
    collection = packs_collection()
    document = collection.find_one(
        {"family_id": family_id, "disabled_builtin": {"$ne": True}, "$or": write_scope(current_user)}
    )
    if document:
        collection.update_one({"_id": document["_id"]}, {"$set": {"enabled": bool(enabled)}})
        document["enabled"] = bool(enabled)
        return _summary(document)

    # Built-ins have no stored document until they are switched off. They need
    # the same switch: a pack nobody can turn off cannot be compared against its
    # own absence, so its value can never be shown or ruled out.
    if family_id in {pack.id for pack in builtin_packs()}:
        set_builtin_enabled(
            family_id=family_id,
            enabled=bool(enabled),
            scopes=write_scope(current_user),
            user_id=str(current_user.id),
        )
        return {"family_id": family_id, "owner_type": "builtin", "enabled": bool(enabled)}

    raise HTTPException(status_code=404, detail="Pack not found.")


@obligation_packs_router.delete("/{family_id}")
def delete_obligation_pack(
    family_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    collection = packs_collection()
    document = collection.find_one({"family_id": family_id, "$or": write_scope(current_user)})
    if not document:
        raise HTTPException(status_code=404, detail="Pack not found.")
    collection.delete_one({"_id": document["_id"]})
    # Records already extracted keep their pack_id/pack_version stamp: deleting
    # the pack must not make past extractions unattributable.
    return {"family_id": family_id, "deleted": True}
