"""Effective Editor and Approver for a contract.

Roles were assignable on one contract at a time, which does not survive
contact with a real matter: a 200-document project needed 200 assignments.
A project now carries defaults, and a contract inherits them until someone
overrides that contract specifically.

Contract-level wins whenever it is set, so an exception on a single document
never has to be argued with the project.
"""

from typing import Any, Dict, Optional

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
) -> Dict[str, Any]:
    return resolve_workflow_roles(
        contract, load_project_for_contract(contract, projects_collection)
    )


def conflicting_role_assignment(
    editor: Optional[ObjectId], approver: Optional[ObjectId]
) -> bool:
    """One person cannot both edit and approve the same work."""
    return editor is not None and approver is not None and editor == approver
