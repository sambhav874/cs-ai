"""Drive the approval workflow against a real database, start to finish.

The unit tests mock the collections, which proves the branching but not the
wiring: whether the Mongo round trips land, whether the audit entries are
written, whether a notification is actually queued. No contract in the
production data has ever reached Pending Approval, so none of that has run.

TESTING=true routes every collection to ``contractsense-test-db`` on the same
cluster, so this writes only to the sandbox database. It cleans up after
itself.

    poetry run python scripts/verify_workflow_end_to_end.py
"""

import asyncio
import os
import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# TESTING=true makes core.database use the sandbox database — but it also makes
# core.config look for .env.test, which does not exist. So load the real .env
# into the environment first, then set the flag.
_ENV_FILE = BACKEND_ROOT / ".env"
if _ENV_FILE.exists():
    for line in _ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())
os.environ["TESTING"] = "true"

from bson import ObjectId  # noqa: E402

from core.database import collection, projects_collection, teams_collection, users_collection, audit_logs_collection  # noqa: E402
from models.domain import AssignWorkflowRolesRequest, RejectContractRequest, ReEditRequest, UserInDB  # noqa: E402
from api.routes import workflows  # noqa: E402
from api.routes import review_queue  # noqa: E402

PASSED, FAILED = [], []


def check(label: str, condition: bool, detail: str = "") -> None:
    (PASSED if condition else FAILED).append(label)
    mark = "  ok  " if condition else " FAIL "
    print(f"[{mark}] {label}{f' — {detail}' if detail else ''}", flush=True)


def _user(doc) -> UserInDB:
    return UserInDB(
        _id=str(doc["_id"]),
        username=doc["username"],
        email=doc["email"],
        hashed_password="x",
        tokens=0,
        teamIds=doc.get("teamIds", []),
        ownedAccountId=doc.get("ownedAccountId"),
    )


async def main() -> int:
    stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    team_oid, project_oid, contract_oid = ObjectId(), ObjectId(), ObjectId()
    owner_oid, editor_oid, approver_oid = ObjectId(), ObjectId(), ObjectId()
    created_user_oids = [owner_oid, editor_oid, approver_oid]

    print(f"Sandbox database: {collection.database.name}\n")

    try:
        users_collection.insert_many([
            {"_id": owner_oid, "username": f"owner-{stamp}", "email": f"owner-{stamp}@example.com",
             "hashed_password": "x", "tokens": 0, "teamIds": [str(team_oid)], "ownedAccountId": str(team_oid)},
            {"_id": editor_oid, "username": f"editor-{stamp}", "email": f"editor-{stamp}@example.com",
             "hashed_password": "x", "tokens": 0, "teamIds": [str(team_oid)]},
            {"_id": approver_oid, "username": f"approver-{stamp}", "email": f"approver-{stamp}@example.com",
             "hashed_password": "x", "tokens": 0, "teamIds": [str(team_oid)]},
        ])
        teams_collection.insert_one({
            "_id": team_oid, "name": f"e2e-team-{stamp}", "creatorId": owner_oid,
            "members": [{"userId": owner_oid, "team_role": "admin"},
                        {"userId": editor_oid, "team_role": "member"},
                        {"userId": approver_oid, "team_role": "member"}],
        })
        projects_collection.insert_one({
            "_id": project_oid, "name": f"e2e-project-{stamp}", "ownerType": "team", "ownerId": team_oid,
        })
        collection.insert_one({
            "_id": contract_oid, "contract_name": f"e2e-contract-{stamp}", "ownerType": "team",
            "ownerId": team_oid, "projectId": project_oid, "uploaded_by": owner_oid,
            "status": "Ingested", "workflowRoles": {"editorUserId": None, "approverUserId": None},
        })

        owner, editor, approver = (_user(users_collection.find_one({"_id": o}))
                                   for o in (owner_oid, editor_oid, approver_oid))
        contract_id = str(contract_oid)

        notifications = []
        task = MagicMock()
        task.delay.side_effect = lambda **kwargs: notifications.append(kwargs)

        with patch.dict(sys.modules, {"worker.tasks": MagicMock(send_workflow_notification_task=task)}):
            # --- Roles cannot be given to one person twice over ---
            try:
                await workflows.assign_workflow_roles(
                    contract_id=contract_id,
                    request=AssignWorkflowRolesRequest(editorUserId=str(editor_oid), approverUserId=str(editor_oid)),
                    current_user=owner,
                )
                check("separation of duties refuses one user in both roles", False, "it was allowed")
            except Exception as exc:
                check("separation of duties refuses one user in both roles", "both Editor and Approver" in str(exc), str(exc)[:80])

            await workflows.assign_workflow_roles(
                contract_id=contract_id,
                request=AssignWorkflowRolesRequest(editorUserId=str(editor_oid), approverUserId=str(approver_oid)),
                current_user=owner,
            )
            stored = collection.find_one({"_id": contract_oid}, {"workflowRoles": 1})
            check("roles persist to the contract",
                  stored["workflowRoles"]["approverUserId"] == approver_oid)

            # --- Project defaults reach a contract that sets none ---
            projects_collection.update_one(
                {"_id": project_oid},
                {"$set": {"workflowRoles": {"editorUserId": editor_oid, "approverUserId": approver_oid}}},
            )
            bare_oid = ObjectId()
            collection.insert_one({
                "_id": bare_oid, "contract_name": f"e2e-inherited-{stamp}", "ownerType": "team",
                "ownerId": team_oid, "projectId": project_oid, "status": "Ingested",
                "workflowRoles": {"editorUserId": None, "approverUserId": None},
            })
            inherited = workflows._roles_for(collection.find_one({"_id": bare_oid}))
            check("a contract with no roles inherits the project's",
                  inherited["approverUserId"] == approver_oid and inherited["approverUserIdSource"] == "project")

            # --- Submit ---
            await workflows.submit_contract_for_approval(contract_id=contract_id, current_user=editor)
            after_submit = collection.find_one({"_id": contract_oid})
            check("submit moves the contract to Pending Approval", after_submit["status"] == "Pending Approval")
            check("submit records who submitted", after_submit.get("submittedBy") == editor_oid)
            check("the approver is notified on submit",
                  any(n["recipient_email"] == approver.email for n in notifications),
                  f"{len(notifications)} notification(s) queued")

            # --- The submitter cannot approve their own work ---
            try:
                await workflows.approve_contract(contract_id=contract_id, current_user=editor)
                check("the submitter is refused their own approval", False, "it was allowed")
            except Exception as exc:
                check("the submitter is refused their own approval", "403" in str(exc) or "submitted" in str(exc), str(exc)[:80])

            # --- Reject, then resubmit and approve ---
            await workflows.reject_contract(
                contract_id=contract_id, request=RejectContractRequest(reason="Indemnity cap is wrong."),
                current_user=approver,
            )
            check("reject moves the contract to Rejected",
                  collection.find_one({"_id": contract_oid})["status"] == "Rejected")
            check("the editor is told why it came back",
                  any("Indemnity cap" in (n.get("body") or "") for n in notifications))

            await workflows.submit_contract_for_approval(contract_id=contract_id, current_user=editor)
            await workflows.approve_contract(contract_id=contract_id, current_user=approver)
            after_approve = collection.find_one({"_id": contract_oid})
            check("approval writes its own terminal status", after_approve["status"] == "Approved",
                  f"status={after_approve['status']}")

            # --- The re-edit chain, which was unreachable before ---
            await workflows.request_reedit_contract(
                contract_id=contract_id,
                request=ReEditRequest(reason="The rate table cites the wrong schedule."),
                current_user=editor,
            )
            check("an approved contract can be reopened",
                  collection.find_one({"_id": contract_oid})["status"] == "Pending Re-edit Approval")

            await workflows.approve_reedit_request(contract_id=contract_id, current_user=approver)
            check("approving the re-edit returns it to the editor",
                  collection.find_one({"_id": contract_oid})["status"] == "Editing")

            # --- The queue shows each person their own work ---
            approver_queue = review_queue.get_my_review_queue(
                include_kpis=False, include_flagged=False, current_user=approver)
            editor_queue = review_queue.get_my_review_queue(
                include_kpis=False, include_flagged=False, current_user=editor)
            check("the editor's queue holds the reopened contract",
                  any(i["artifact_id"] == contract_id for i in editor_queue["awaiting_my_edit"]),
                  f"{editor_queue['counts']['edits']} item(s)")
            check("the approver's queue is empty once nothing awaits them",
                  all(i["artifact_id"] != contract_id for i in approver_queue["awaiting_my_approval"]))

        # --- Audit trail ---
        actions = [
            log.get("action")
            for log in audit_logs_collection.find({"contractId": contract_oid}, {"action": 1})
        ]
        for expected in ["WORKFLOW_ROLES_UPDATED", "SUBMITTED_FOR_APPROVAL", "CONTRACT_REJECTED",
                         "CONTRACT_APPROVED", "REEDIT_REQUESTED", "REEDIT_APPROVED"]:
            check(f"audit trail records {expected}", expected in actions)

        print(f"\nNotifications queued: {len(notifications)}")
        for note in notifications:
            print(f"  → {note['recipient_email']}: {note['subject']}")

    finally:
        collection.delete_many({"contract_name": {"$regex": f"e2e-.*-{stamp}"}})
        projects_collection.delete_one({"_id": project_oid})
        teams_collection.delete_one({"_id": team_oid})
        users_collection.delete_many({"_id": {"$in": created_user_oids}})
        audit_logs_collection.delete_many({"contractId": contract_oid})
        print("\nSandbox rows removed.")

    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    for failure in FAILED:
        print(f"  FAILED: {failure}")
    return 1 if FAILED else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
