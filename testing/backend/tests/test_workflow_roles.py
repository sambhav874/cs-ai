"""Role and approval rules on a contract.

These cover the guarantees a buyer's security reviewer asks about directly:
that one person cannot both edit and approve, that submitting is not
approving, and that an approved contract is distinguishable from one the
ingestion worker just finished.
"""

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from bson import ObjectId

APP_BACKEND_ROOT = Path(__file__).resolve().parents[3] / "apps" / "backend"
sys.path.insert(0, str(APP_BACKEND_ROOT))

os.environ["TESTING"] = "true"
os.environ.setdefault("HUGGINGFACE_TOKEN", "test")
os.environ.setdefault("GROQ_API_KEY", "test")
os.environ.setdefault("FINAL_OUTPUT_DIR", "/tmp/extractor-test-output")
os.environ.setdefault("SUPPORT_EMAIL_ADDRESS", "test@example.com")
os.environ.setdefault("AZURE_COMMUNICATION_CONNECTION_STRING", "endpoint=https://example.com/;accesskey=test")
os.environ.setdefault("AZURE_SENDER_ADDRESS", "test@example.com")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017/test")

from fastapi import HTTPException

from api.routes import workflows as workflows_module
from core.privileges import CONTRACT_APPROVE, CONTRACT_EDIT, ROLES_ASSIGN_CONTRACT
from models.domain import AssignWorkflowRolesRequest, ReEditRequest


TEAM_OID = ObjectId()
EDITOR_OID = ObjectId()
APPROVER_OID = ObjectId()
OWNER_OID = ObjectId()


def _user(user_id: ObjectId, *, owns_account: bool = False):
    user = MagicMock()
    user.id = str(user_id)
    user.username = "tester"
    user.ownedAccountId = str(TEAM_OID) if owns_account else None
    user.teamIds = [str(TEAM_OID)]
    return user


def _team_contract(**overrides):
    contract = {
        "_id": ObjectId(),
        "ownerType": "team",
        "ownerId": TEAM_OID,
        "contract_name": "Services Agreement",
        "status": "Pending Approval",
        "workflowRoles": {"editorUserId": EDITOR_OID, "approverUserId": APPROVER_OID},
    }
    contract.update(overrides)
    return contract


class SeparationOfDutiesTests(unittest.IsolatedAsyncioTestCase):
    """One user cannot hold both roles on the same contract."""

    def setUp(self):
        self.contract = _team_contract(status="Editing")
        self.contract_id = str(self.contract["_id"])

        self.collection = MagicMock()
        self.collection.find_one.return_value = self.contract
        self.collection.update_one.return_value = MagicMock(matched_count=1, modified_count=1)

        self.teams_collection = MagicMock()
        self.teams_collection.find_one.return_value = {
            "_id": TEAM_OID,
            "members": [
                {"userId": EDITOR_OID},
                {"userId": APPROVER_OID},
                {"userId": OWNER_OID},
            ],
        }

        empty_users = MagicMock()
        empty_users.find.return_value = []
        empty_projects = MagicMock()
        empty_projects.find_one.return_value = None
        # Everyone in this fixture can do everything; eligibility has tests of
        # its own below.
        all_privileges = {CONTRACT_EDIT, CONTRACT_APPROVE, ROLES_ASSIGN_CONTRACT}
        self.patches = [
            patch.object(workflows_module, "collection", self.collection),
            patch.object(workflows_module, "teams_collection", self.teams_collection),
            patch.object(workflows_module, "users_collection", empty_users),
            patch.object(workflows_module, "projects_collection", empty_projects),
            patch.object(workflows_module, "create_audit_log", AsyncMock()),
            patch.object(workflows_module, "privileges_for", MagicMock(return_value=all_privileges)),
            patch.object(
                workflows_module, "privileges_for_user_id", MagicMock(return_value=all_privileges)
            ),
        ]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self.patches])

    async def test_rejects_assigning_one_user_to_both_roles(self):
        request = AssignWorkflowRolesRequest(
            editorUserId=str(EDITOR_OID), approverUserId=str(EDITOR_OID)
        )

        with self.assertRaises(HTTPException) as raised:
            await workflows_module.assign_workflow_roles(
                contract_id=self.contract_id,
                request=request,
                current_user=_user(OWNER_OID, owns_account=True),
            )

        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("cannot be both Editor and Approver", raised.exception.detail)
        self.collection.update_one.assert_not_called()

    async def test_rejects_a_partial_update_that_collides_with_the_stored_role(self):
        # Only the approver is being set, and it collides with the editor already
        # on the contract — the check has to look at the resulting pair, not at
        # whichever role the request happens to carry.
        request = AssignWorkflowRolesRequest(approverUserId=str(EDITOR_OID))

        with self.assertRaises(HTTPException) as raised:
            await workflows_module.assign_workflow_roles(
                contract_id=self.contract_id,
                request=request,
                current_user=_user(OWNER_OID, owns_account=True),
            )

        self.assertEqual(raised.exception.status_code, 400)
        self.collection.update_one.assert_not_called()

    async def test_allows_distinct_editor_and_approver(self):
        request = AssignWorkflowRolesRequest(
            editorUserId=str(EDITOR_OID), approverUserId=str(APPROVER_OID)
        )

        result = await workflows_module.assign_workflow_roles(
            contract_id=self.contract_id,
            request=request,
            current_user=_user(OWNER_OID, owns_account=True),
        )

        self.assertTrue(self.collection.update_one.called)
        self.assertIn("message", result)

    async def test_clearing_the_editor_frees_that_user_to_approve(self):
        request = AssignWorkflowRolesRequest(editorUserId="", approverUserId=str(EDITOR_OID))

        await workflows_module.assign_workflow_roles(
            contract_id=self.contract_id,
            request=request,
            current_user=_user(OWNER_OID, owns_account=True),
        )

        set_payload = self.collection.update_one.call_args[0][1]["$set"]
        self.assertIsNone(set_payload["workflowRoles.editorUserId"])
        self.assertEqual(set_payload["workflowRoles.approverUserId"], EDITOR_OID)


class EligibilityTests(unittest.IsolatedAsyncioTestCase):
    """A workflow role goes to someone whose persona lets them exercise it."""

    def setUp(self):
        self.contract = _team_contract(status="Editing", workflowRoles={})
        self.collection = MagicMock()
        self.collection.find_one.return_value = self.contract
        self.collection.update_one.return_value = MagicMock(matched_count=1, modified_count=1)

        teams = MagicMock()
        teams.find_one.return_value = {
            "_id": TEAM_OID,
            "members": [{"userId": EDITOR_OID}, {"userId": APPROVER_OID}, {"userId": OWNER_OID}],
        }
        empty_users = MagicMock()
        empty_users.find.return_value = []
        empty_projects = MagicMock()
        empty_projects.find_one.return_value = None

        # The candidate can edit but not approve.
        self.candidate_privileges = {CONTRACT_EDIT}
        self.patches = [
            patch.object(workflows_module, "collection", self.collection),
            patch.object(workflows_module, "teams_collection", teams),
            patch.object(workflows_module, "users_collection", empty_users),
            patch.object(workflows_module, "projects_collection", empty_projects),
            patch.object(workflows_module, "create_audit_log", AsyncMock()),
            patch.object(
                workflows_module, "privileges_for", MagicMock(return_value={ROLES_ASSIGN_CONTRACT})
            ),
            patch.object(
                workflows_module,
                "privileges_for_user_id",
                MagicMock(side_effect=lambda *_args, **_kwargs: self.candidate_privileges),
            ),
        ]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self.patches])

    async def test_refuses_an_approver_who_cannot_approve(self):
        with self.assertRaises(HTTPException) as raised:
            await workflows_module.assign_workflow_roles(
                contract_id=str(self.contract["_id"]),
                request=AssignWorkflowRolesRequest(approverUserId=str(APPROVER_OID)),
                current_user=_user(OWNER_OID, owns_account=True),
            )

        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("approver", raised.exception.detail)
        self.collection.update_one.assert_not_called()

    async def test_allows_an_approver_whose_persona_permits_it(self):
        self.candidate_privileges = {CONTRACT_EDIT, CONTRACT_APPROVE}

        await workflows_module.assign_workflow_roles(
            contract_id=str(self.contract["_id"]),
            request=AssignWorkflowRolesRequest(approverUserId=str(APPROVER_OID)),
            current_user=_user(OWNER_OID, owns_account=True),
        )

        self.assertTrue(self.collection.update_one.called)


class ApprovalTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.collection = MagicMock()
        self.collection.update_one.return_value = MagicMock(matched_count=1, modified_count=1)
        self.audit = AsyncMock()

        empty_users = MagicMock()
        empty_users.find.return_value = []
        empty_projects = MagicMock()
        empty_projects.find_one.return_value = None
        self.patches = [
            patch.object(workflows_module, "collection", self.collection),
            patch.object(workflows_module, "teams_collection", MagicMock()),
            patch.object(workflows_module, "users_collection", empty_users),
            patch.object(workflows_module, "projects_collection", empty_projects),
            patch.object(workflows_module, "create_audit_log", self.audit),
            patch.object(workflows_module, "get_contract", MagicMock(return_value={"ok": True})),
        ]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self.patches])

    async def test_approval_writes_its_own_terminal_status(self):
        contract = _team_contract(submittedBy=EDITOR_OID)
        self.collection.find_one.return_value = contract

        await workflows_module.approve_contract(
            contract_id=str(contract["_id"]), current_user=_user(APPROVER_OID)
        )

        set_payload = self.collection.update_one.call_args[0][1]["$set"]
        # "Ingested" is what the OCR worker writes; an approved contract has to
        # be tellable apart from one that was merely parsed.
        self.assertEqual(set_payload["status"], "Approved")

    async def test_the_submitter_cannot_approve_their_own_submission(self):
        contract = _team_contract(submittedBy=APPROVER_OID)
        self.collection.find_one.return_value = contract

        with self.assertRaises(HTTPException) as raised:
            await workflows_module.approve_contract(
                contract_id=str(contract["_id"]), current_user=_user(APPROVER_OID)
            )

        self.assertEqual(raised.exception.status_code, 403)
        self.collection.update_one.assert_not_called()

    async def test_owner_self_approval_is_allowed_but_named_in_the_audit_trail(self):
        contract = _team_contract(submittedBy=OWNER_OID)
        self.collection.find_one.return_value = contract

        await workflows_module.approve_contract(
            contract_id=str(contract["_id"]),
            current_user=_user(OWNER_OID, owns_account=True),
        )

        self.assertTrue(self.collection.update_one.called)
        audit_kwargs = self.audit.call_args.kwargs
        self.assertEqual(audit_kwargs["action"], "SELF_APPROVAL_OVERRIDE")
        self.assertIs(audit_kwargs["details"]["selfApproval"], True)

    async def test_an_ordinary_approval_is_not_flagged_as_an_override(self):
        contract = _team_contract(submittedBy=EDITOR_OID)
        self.collection.find_one.return_value = contract

        await workflows_module.approve_contract(
            contract_id=str(contract["_id"]), current_user=_user(APPROVER_OID)
        )

        audit_kwargs = self.audit.call_args.kwargs
        self.assertEqual(audit_kwargs["action"], "CONTRACT_APPROVED")
        self.assertIs(audit_kwargs["details"]["selfApproval"], False)


class ReEditEntryTests(unittest.IsolatedAsyncioTestCase):
    """The re-edit chain was unreachable while approval wrote "Ingested"."""

    def setUp(self):
        self.collection = MagicMock()
        self.collection.update_one.return_value = MagicMock(matched_count=1, modified_count=1)
        empty_users = MagicMock()
        empty_users.find.return_value = []
        empty_projects = MagicMock()
        empty_projects.find_one.return_value = None
        self.patches = [
            patch.object(workflows_module, "collection", self.collection),
            patch.object(workflows_module, "users_collection", empty_users),
            patch.object(workflows_module, "projects_collection", empty_projects),
            patch.object(workflows_module, "create_audit_log", AsyncMock()),
            patch.object(workflows_module, "get_contract", MagicMock(return_value={"ok": True})),
        ]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self.patches])

    async def _request_reedit(self, status_value):
        contract = _team_contract(status=status_value)
        self.collection.find_one.return_value = contract
        return await workflows_module.request_reedit_contract(
            contract_id=str(contract["_id"]),
            request=ReEditRequest(reason="The rate table cites the wrong schedule."),
            current_user=_user(EDITOR_OID),
        )

    async def test_an_approved_contract_can_be_reopened(self):
        await self._request_reedit("Approved")

        set_payload = self.collection.update_one.call_args[0][1]["$set"]
        self.assertEqual(set_payload["status"], "Pending Re-edit Approval")

    async def test_a_legacy_completed_contract_can_still_be_reopened(self):
        await self._request_reedit("Completed")

        set_payload = self.collection.update_one.call_args[0][1]["$set"]
        self.assertEqual(set_payload["status"], "Pending Re-edit Approval")

    async def test_a_contract_still_in_review_cannot_be_reopened(self):
        with self.assertRaises(HTTPException) as raised:
            await self._request_reedit("Pending Approval")

        self.assertEqual(raised.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
