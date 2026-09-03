"""Project-level roles: who may set them, and who may hold them."""

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

from api.routes import projects as projects_module
from core.privileges import CONTRACT_APPROVE, CONTRACT_EDIT, ROLES_ASSIGN_PROJECT
from models.domain import AssignWorkflowRolesRequest

TEAM = ObjectId()
PROJECT = ObjectId()
OWNER = ObjectId()
ADMIN = ObjectId()
EDITOR = ObjectId()
APPROVER = ObjectId()
OUTSIDER = ObjectId()


def _user(user_id, *, owns_account=False):
    user = MagicMock()
    user.id = str(user_id)
    user.username = "tester"
    user.ownedAccountId = str(TEAM) if owns_account else None
    user.teamIds = [str(TEAM)]
    return user


class ProjectRoleAssignmentTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.project = {
            "_id": PROJECT,
            "name": "Supplier renewals",
            "ownerType": "team",
            "ownerId": TEAM,
            "workflowRoles": {"adminUserId": ADMIN},
        }
        self.projects = MagicMock()
        self.projects.find_one.return_value = self.project
        self.teams = MagicMock()
        self.teams.find_one.return_value = {
            "_id": TEAM,
            "members": [
                {"userId": OWNER}, {"userId": ADMIN}, {"userId": EDITOR}, {"userId": APPROVER},
            ],
        }

        # Candidate privileges, keyed by who is being assigned.
        self.member_privileges = {
            EDITOR: {CONTRACT_EDIT},
            APPROVER: {CONTRACT_EDIT, CONTRACT_APPROVE},
            ADMIN: {ROLES_ASSIGN_PROJECT},
            OUTSIDER: set(),
        }

        self.patches = [
            patch.object(projects_module, "projects_collection", self.projects),
            patch.object(projects_module, "teams_collection", self.teams),
            patch.object(projects_module, "create_audit_log", AsyncMock()),
            patch.object(
                projects_module,
                "_member_privileges",
                MagicMock(side_effect=lambda oid, _account: self.member_privileges.get(oid, set())),
            ),
            patch.object(
                projects_module,
                "verify_project_access",
                MagicMock(return_value=self.project),
            ),
            patch(
                "api.dependencies.privileges_for",
                MagicMock(return_value=set()),
            ),
        ]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self.patches])

    async def _assign(self, current_user, **fields):
        return await projects_module.assign_project_workflow_roles(
            project_id=str(PROJECT),
            request=AssignWorkflowRolesRequest(**fields),
            current_user=current_user,
        )

    async def test_the_project_admin_can_staff_their_own_project(self):
        # The point of the slot: staffing a matter should not need the account
        # owner every time.
        await self._assign(_user(ADMIN), editorUserId=str(EDITOR))

        self.assertTrue(self.projects.update_one.called)

    async def test_the_account_owner_can_still_staff_it(self):
        await self._assign(_user(OWNER, owns_account=True), editorUserId=str(EDITOR))

        self.assertTrue(self.projects.update_one.called)

    async def test_someone_with_neither_is_refused(self):
        with self.assertRaises(HTTPException) as raised:
            await self._assign(_user(EDITOR), editorUserId=str(EDITOR))

        self.assertEqual(raised.exception.status_code, 403)
        self.projects.update_one.assert_not_called()

    async def test_an_approver_who_cannot_approve_is_refused(self):
        with self.assertRaises(HTTPException) as raised:
            await self._assign(_user(ADMIN), approverUserId=str(EDITOR))

        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("approver", raised.exception.detail)
        self.projects.update_one.assert_not_called()

    async def test_an_editor_who_cannot_edit_is_refused(self):
        with self.assertRaises(HTTPException) as raised:
            await self._assign(_user(ADMIN), editorUserId=str(OUTSIDER))

        self.assertEqual(raised.exception.status_code, 400)
        self.projects.update_one.assert_not_called()

    async def test_the_admin_slot_is_stored(self):
        await self._assign(_user(OWNER, owns_account=True), adminUserId=str(ADMIN))

        stored = self.projects.update_one.call_args[0][1]["$set"]
        self.assertEqual(stored["workflowRoles.adminUserId"], ADMIN)

    async def test_one_person_cannot_be_both_editor_and_approver(self):
        with self.assertRaises(HTTPException) as raised:
            await self._assign(
                _user(ADMIN), editorUserId=str(APPROVER), approverUserId=str(APPROVER)
            )

        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("cannot be both", raised.exception.detail)


if __name__ == "__main__":
    unittest.main()
