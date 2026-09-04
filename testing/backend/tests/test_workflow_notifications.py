"""Whoever now has to act gets told."""

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

from api.routes import workflows as workflows_module

APPROVER_OID = ObjectId()


class NotificationDispatchTests(unittest.TestCase):
    def setUp(self):
        self.users = MagicMock()
        self.users.find_one.return_value = {"_id": APPROVER_OID, "email": "approver@example.com"}
        self.task = MagicMock()
        self.tasks_module = MagicMock(send_workflow_notification_task=self.task)

        self.patches = [
            patch.object(workflows_module, "users_collection", self.users),
            patch.dict(sys.modules, {"worker.tasks": self.tasks_module}),
        ]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self.patches])

    def test_queues_an_email_for_the_person_who_must_act(self):
        workflows_module._notify_role_holder(
            APPROVER_OID,
            subject="A contract is waiting for your approval",
            headline="Waiting for your approval",
            body="Priya submitted this contract.",
            contract={"contract_name": "Services Agreement"},
            contract_id="507f1f77bcf86cd799439012",
        )

        kwargs = self.task.delay.call_args.kwargs
        self.assertEqual(kwargs["recipient_email"], "approver@example.com")
        self.assertEqual(kwargs["contract_name"], "Services Agreement")
        self.assertIn("/contracts/507f1f77bcf86cd799439012", kwargs["action_url"])

    def test_a_user_with_no_email_on_file_is_skipped_quietly(self):
        self.users.find_one.return_value = {"_id": APPROVER_OID}

        workflows_module._notify_role_holder(
            APPROVER_OID, subject="s", headline="h", body="b", contract_id="abc"
        )

        self.task.delay.assert_not_called()

    def test_an_unassigned_role_notifies_nobody(self):
        workflows_module._notify_role_holder(None, subject="s", headline="h", body="b")

        self.users.find_one.assert_not_called()
        self.task.delay.assert_not_called()

    def test_a_broker_failure_does_not_escape(self):
        # An approval must not roll back because an email could not be queued.
        self.task.delay.side_effect = RuntimeError("broker unavailable")

        workflows_module._notify_role_holder(
            APPROVER_OID, subject="s", headline="h", body="b", contract_id="abc"
        )


class SubmitNotifiesApproverTests(unittest.IsolatedAsyncioTestCase):
    async def test_submitting_tells_the_approver(self):
        team_oid = ObjectId()
        editor_oid = ObjectId()
        contract = {
            "_id": ObjectId(),
            "ownerType": "team",
            "ownerId": team_oid,
            "contract_name": "Lease",
            "status": "Editing",
            "workflowRoles": {"editorUserId": editor_oid, "approverUserId": APPROVER_OID},
        }
        collection = MagicMock()
        collection.find_one.return_value = contract
        collection.update_one.return_value = MagicMock(matched_count=1, modified_count=1)

        user = MagicMock()
        user.id = str(editor_oid)
        user.username = "priya"
        user.ownedAccountId = None
        user.teamIds = [str(team_oid)]

        notify = MagicMock()
        with patch.object(workflows_module, "collection", collection), \
             patch.object(workflows_module, "create_audit_log", AsyncMock()), \
             patch.object(workflows_module, "get_contract", AsyncMock(return_value={})), \
             patch.object(workflows_module, "_notify_role_holder", notify):
            await workflows_module.submit_contract_for_approval(
                contract_id=str(contract["_id"]), current_user=user
            )

        self.assertEqual(notify.call_args[0][0], APPROVER_OID)


if __name__ == "__main__":
    unittest.main()
