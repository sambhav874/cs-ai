"""Which workspaces a user is offered in the account switcher."""

import os
import sys
import unittest
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

from api.routes import auth as auth_module

EVAL_ID = "600c00000000000000000001"


def _user(username="newcomer", team_ids=None, owned=None):
    user = MagicMock()
    user.id = str(ObjectId())
    user.username = username
    user.teamIds = team_ids or []
    user.ownedAccountId = owned
    return user


class AccessibleAccountTests(unittest.TestCase):
    def setUp(self):
        self.teams = MagicMock()
        self.teams.find.return_value = []
        self.teams.find_one.return_value = None
        patcher = patch.object(auth_module, "teams_collection", self.teams)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_new_user_is_offered_only_their_personal_workspace(self):
        """The evaluation workspace used to be appended for everyone, so a
        fresh account saw a team it could not open — picking it returned
        "User is not a member of this team"."""
        accounts = auth_module.list_accessible_accounts(current_user=_user())

        self.assertEqual([a.id for a in accounts], ["personal"])

    def test_the_evaluation_workspace_is_offered_to_its_members(self):
        self.teams.find_one.return_value = {"_id": ObjectId(EVAL_ID)}

        accounts = auth_module.list_accessible_accounts(current_user=_user())

        self.assertIn(EVAL_ID, [a.id for a in accounts])

    def test_the_named_evaluation_accounts_keep_it_without_a_team_document(self):
        # Environments without that team document still need the eval users to
        # reach their workspace.
        accounts = auth_module.list_accessible_accounts(current_user=_user(username="demouser"))

        self.assertIn(EVAL_ID, [a.id for a in accounts])

    def test_it_is_never_offered_as_owner(self):
        self.teams.find_one.return_value = {"_id": ObjectId(EVAL_ID)}

        accounts = auth_module.list_accessible_accounts(current_user=_user())
        evaluation = next(a for a in accounts if a.id == EVAL_ID)

        self.assertEqual(evaluation.role, "member")

    def test_a_team_member_still_sees_their_own_team(self):
        team_oid = ObjectId()
        self.teams.find.return_value = [
            {
                "_id": team_oid,
                "name": "Northwind Legal",
                "members": [{"userId": ObjectId(), "team_role": "member"}],
            }
        ]

        accounts = auth_module.list_accessible_accounts(current_user=_user(team_ids=[team_oid]))

        self.assertEqual([a.name for a in accounts], ["Personal Workspace", "Northwind Legal"])


if __name__ == "__main__":
    unittest.main()
