"""Effective Editor and Approver for a contract.

Roles were assignable on one contract at a time, which does not survive
contact with a real matter: a 200-document project needed 200 assignments.
A project now carries defaults, and a contract inherits them until someone
overrides that contract specifically.

Contract-level wins whenever it is set, so an exception on a single document
never has to be argued with the project.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from bson import ObjectId

EDITOR_KEY = "editorUserId"
APPROVER_KEY = "approverUserId"


def _clean(value: Any) -> Optional[ObjectId]:
    return value if isinstance(value, ObjectId) else None


def resolve_workflow_roles(
    contract: Optional[Dict[str, Any]],
    project: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Return the roles that actually apply, and where each one came from.

    ``source`` is per role: a project may supply the approver while the
    contract overrides only the editor.
    """
    contract_roles = (contract or {}).get("workflowRoles") or {}
    project_roles = (project or {}).get("workflowRoles") or {}

    resolved: Dict[str, Any] = {}
    for key in (EDITOR_KEY, APPROVER_KEY):
        own = _clean(contract_roles.get(key))
        inherited = _clean(project_roles.get(key))
        if own is not None:
            resolved[key] = own
            resolved[f"{key}Source"] = "contract"
        elif inherited is not None:
            resolved[key] = inherited
            resolved[f"{key}Source"] = "project"
        else:
            resolved[key] = None
            resolved[f"{key}Source"] = None
    return resolved


def load_project_for_contract(
    contract: Optional[Dict[str, Any]],
    projects_collection: Any,
) -> Optional[Dict[str, Any]]:
    """Fetch just the role defaults of the contract's project, if it has one."""
    project_oid = (contract or {}).get("projectId")
    if not isinstance(project_oid, ObjectId) or projects_collection is None:
        return None
    return projects_collection.find_one({"_id": project_oid}, {"workflowRoles": 1})


def effective_roles_for_contract(
    contract: Optional[Dict[str, Any]],
    projects_collection: Any,
    users_collection: Any = None,
) -> Dict[str, Any]:
    """Who actually acts on this contract right now.

    Contract override, else the project default, and then whoever is covering
    for them.
    """
    roles = resolve_workflow_roles(
        contract, load_project_for_contract(contract, projects_collection)
    )
    if users_collection is None:
        return roles
    return apply_delegations(roles, users_collection)


def conflicting_role_assignment(
    editor: Optional[ObjectId], approver: Optional[ObjectId]
) -> bool:
    """One person cannot both edit and approve the same work."""
    return editor is not None and approver is not None and editor == approver


def active_delegation(
    delegations: Optional[List[Dict[str, Any]]],
    role_key: str,
    now: Optional[datetime] = None,
) -> Optional[Dict[str, Any]]:
    """The delegation currently standing in for `role_key`, if any.

    A lapsed delegation is simply ignored rather than cleaned up: nobody should
    have to run a job for an approver's role to come back to them.
    """
    if not delegations:
        return None
    moment = now or datetime.utcnow()
    standing = [
        d for d in delegations
        if d.get("role") == role_key
        and isinstance(d.get("delegateUserId"), ObjectId)
        and (d.get("until") is None or d.get("until") > moment)
        and not d.get("revokedAt")
    ]
    if not standing:
        return None
    # Newest wins, so re-delegating replaces rather than stacks.
    return max(standing, key=lambda d: d.get("createdAt") or datetime.min)


def apply_delegations(
    roles: Dict[str, Any], users_collection: Any, now: Optional[datetime] = None
) -> Dict[str, Any]:
    """Swap in whoever is covering, recording who the role really belongs to.

    Delegations live on the delegating user, so the role follows the person who
    went on leave rather than being copied onto every contract they touch.
    """
    resolved = dict(roles)
    if users_collection is None:
        return resolved

    holders = {
        role_name: resolved.get(key)
        for role_name, key in (("editor", EDITOR_KEY), ("approver", APPROVER_KEY))
        if isinstance(resolved.get(key), ObjectId)
    }
    if not holders:
        return resolved

    delegations_by_user = {
        user["_id"]: user.get("workflowDelegations") or []
        for user in users_collection.find(
            {"_id": {"$in": list(set(holders.values()))}}, {"workflowDelegations": 1}
        )
    }

    for role_name, key in (("editor", EDITOR_KEY), ("approver", APPROVER_KEY)):
        holder = resolved.get(key)
        if not isinstance(holder, ObjectId):
            continue
        delegation = active_delegation(delegations_by_user.get(holder), role_name, now)
        if delegation is None:
            continue
        resolved[f"{key}DelegatedFrom"] = holder
        resolved[key] = delegation["delegateUserId"]
        resolved[f"{key}Source"] = "delegation"
    return resolved
