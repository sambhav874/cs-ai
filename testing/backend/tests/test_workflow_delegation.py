"""Covering for a colleague who is away."""

import os
import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

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

from services.workflow_roles import active_delegation, apply_delegations

HOLDER = ObjectId()
COVER = ObjectId()
OTHER = ObjectId()


def _delegation(role="approver", *, until=None, revoked=False, created=None, delegate=COVER):
    return {
        "_id": ObjectId(),
        "role": role,
        "delegateUserId": delegate,
        "until": until,
        "revokedAt": datetime.utcnow() if revoked else None,
        "createdAt": created or datetime.utcnow(),
    }


class ActiveDelegationTests(unittest.TestCase):
    def test_an_open_ended_delegation_stands(self):
        self.assertIsNotNone(active_delegation([_delegation()], "approver"))

    def test_a_delegation_for_a_different_role_does_not_apply(self):
        self.assertIsNone(active_delegation([_delegation(role="editor")], "approver"))

    def test_a_lapsed_delegation_stops_applying_without_anyone_cleaning_it_up(self):
        lapsed = _delegation(until=datetime.utcnow() - timedelta(days=1))

        self.assertIsNone(active_delegation([lapsed], "approver"))

    def test_a_revoked_delegation_stops_applying(self):
        self.assertIsNone(active_delegation([_delegation(revoked=True)], "approver"))

    def test_re_delegating_replaces_rather_than_stacks(self):
        older = _delegation(created=datetime(2026, 1, 1), delegate=OTHER)
        newer = _delegation(created=datetime(2026, 6, 1), delegate=COVER)

        winner = active_delegation([older, newer], "approver")

        self.assertEqual(winner["delegateUserId"], COVER)


class ApplyDelegationTests(unittest.TestCase):
    def _users(self, delegations):
        users = MagicMock()
        users.find.return_value = [{"_id": HOLDER, "workflowDelegations": delegations}]
        return users

    def test_the_stand_in_becomes_the_effective_approver(self):
        roles = {"editorUserId": OTHER, "approverUserId": HOLDER, "approverUserIdSource": "contract"}

        resolved = apply_delegations(roles, self._users([_delegation()]))

        self.assertEqual(resolved["approverUserId"], COVER)
        self.assertEqual(resolved["approverUserIdSource"], "delegation")
        # Who it really belongs to is kept, so the UI can say "covering for".
        self.assertEqual(resolved["approverUserIdDelegatedFrom"], HOLDER)

    def test_an_untouched_role_is_left_alone(self):
        roles = {"editorUserId": OTHER, "approverUserId": HOLDER}

        resolved = apply_delegations(roles, self._users([_delegation()]))

        self.assertEqual(resolved["editorUserId"], OTHER)

    def test_with_no_delegations_the_roles_are_unchanged(self):
        roles = {"editorUserId": OTHER, "approverUserId": HOLDER}

        resolved = apply_delegations(roles, self._users([]))

        self.assertEqual(resolved["approverUserId"], HOLDER)

    def test_an_unassigned_role_needs_no_lookup(self):
        users = MagicMock()

        resolved = apply_delegations({"editorUserId": None, "approverUserId": None}, users)

        users.find.assert_not_called()
        self.assertIsNone(resolved["approverUserId"])


if __name__ == "__main__":
    unittest.main()
