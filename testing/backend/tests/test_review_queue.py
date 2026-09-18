"""The "what is waiting on me" inbox."""

import os
import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

from bson import ObjectId

APP_BACKEND_ROOT = Path(__file__).resolve().parents[3] / "apps" / "intelligence"
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

from api.routes import review_queue as queue_module

USER_OID = ObjectId()
PROJECT_OID = ObjectId()


def _user():
    user = MagicMock()
    user.id = str(USER_OID)
    return user


class ReviewQueueTests(unittest.TestCase):
    def setUp(self):
        self.collection = MagicMock()
        self.projects = MagicMock()
        self.projects.find.return_value = []
        self.users = MagicMock()
        self.users.find.return_value = []
        self.patches = [
            patch.object(queue_module, "collection", self.collection),
            patch.object(queue_module, "projects_collection", self.projects),
            patch.object(queue_module, "users_collection", self.users),
            patch.object(queue_module, "kpi_db", None),
        ]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self.patches])

    def test_separates_what_i_approve_from_what_i_edit(self):
        older = datetime(2026, 1, 1)
        newer = datetime(2026, 6, 1)

        def find(query, projection=None):
            statuses = query["$or"][0]["status"]["$in"]
            if "Pending Approval" in statuses:
                return [{"_id": ObjectId(), "contract_name": "Lease", "status": "Pending Approval", "updatedAt": newer}]
            return [{"_id": ObjectId(), "contract_name": "MSA", "status": "Rejected", "updatedAt": older}]

        self.collection.find.side_effect = find

        result = queue_module.get_my_review_queue(include_kpis=False, include_flagged=False, current_user=_user())

        self.assertEqual(result["counts"], {"approvals": 1, "edits": 1, "total": 2})
        self.assertEqual(result["awaiting_my_approval"][0]["assigned_role"], "approver")
        self.assertEqual(result["awaiting_my_approval"][0]["title"], "Lease")
        self.assertEqual(result["awaiting_my_edit"][0]["assigned_role"], "editor")

    def test_the_longest_wait_comes_first(self):
        oldest = datetime(2025, 1, 1)
        middle = datetime(2025, 6, 1)
        newest = datetime(2026, 1, 1)

        def find(query, projection=None):
            statuses = query["$or"][0]["status"]["$in"]
            if "Pending Approval" not in statuses:
                return []
            return [
                {"_id": ObjectId(), "contract_name": "newest", "status": "Pending Approval", "updatedAt": newest},
                {"_id": ObjectId(), "contract_name": "oldest", "status": "Pending Approval", "updatedAt": oldest},
                {"_id": ObjectId(), "contract_name": "middle", "status": "Pending Approval", "updatedAt": middle},
            ]

        self.collection.find.side_effect = find

        result = queue_module.get_my_review_queue(include_kpis=False, include_flagged=False, current_user=_user())

        self.assertEqual(
            [item["title"] for item in result["awaiting_my_approval"]],
            ["oldest", "middle", "newest"],
        )

    def test_a_project_level_role_pulls_in_contracts_that_set_no_role(self):
        self.projects.find.return_value = [{"_id": PROJECT_OID}]
        self.collection.find.return_value = []

        queue_module.get_my_review_queue(include_kpis=False, include_flagged=False, current_user=_user())

        query = self.collection.find.call_args_list[0][0][0]
        inherited_clause = query["$or"][1]
        self.assertEqual(inherited_clause["projectId"], {"$in": [PROJECT_OID]})
        # Only where the contract itself stays silent — an explicit assignment
        # on the contract overrides the project and belongs to someone else.
        self.assertIsNone(inherited_clause["workflowRoles.approverUserId"])

    def test_no_project_roles_means_no_inherited_clause(self):
        self.collection.find.return_value = []

        queue_module.get_my_review_queue(include_kpis=False, include_flagged=False, current_user=_user())

        query = self.collection.find.call_args_list[0][0][0]
        self.assertEqual(len(query["$or"]), 1)

    def test_an_empty_queue_reports_zero_rather_than_failing(self):
        self.collection.find.return_value = []

        result = queue_module.get_my_review_queue(include_kpis=False, include_flagged=False, current_user=_user())

        self.assertEqual(result["counts"]["total"], 0)
        self.assertEqual(result["awaiting_my_approval"], [])

    def test_a_rejection_reason_rides_along_so_the_editor_knows_why(self):
        def find(query, projection=None):
            statuses = query["$or"][0]["status"]["$in"]
            if "Pending Approval" in statuses:
                return []
            return [{
                "_id": ObjectId(),
                "contract_name": "MSA",
                "status": "Rejected",
                "updatedAt": datetime.utcnow(),
                "rejectedReason": "The indemnity cap does not match the playbook.",
            }]

        self.collection.find.side_effect = find

        result = queue_module.get_my_review_queue(include_kpis=False, include_flagged=False, current_user=_user())

        self.assertEqual(
            result["awaiting_my_edit"][0]["note"],
            "The indemnity cap does not match the playbook.",
        )


class ReviewQueueKpiTests(unittest.TestCase):
    def setUp(self):
        self.collection = MagicMock()
        self.collection.find.return_value = []
        self.projects = MagicMock()
        self.projects.find.return_value = []
        self.kpi_db = MagicMock()
        self.users = MagicMock()
        self.users.find.return_value = []
        self.patches = [
            patch.object(queue_module, "collection", self.collection),
            patch.object(queue_module, "projects_collection", self.projects),
            patch.object(queue_module, "users_collection", self.users),
            patch.object(queue_module, "kpi_db", self.kpi_db),
        ]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self.patches])

    def test_uncertified_kpis_on_my_contracts_are_waiting_on_me(self):
        contract_oid = ObjectId()
        self.collection.find.return_value = [{"_id": contract_oid}]
        self.kpi_db.contract_kpis.find.return_value = [
            {
                "contract_id": str(contract_oid),
                "kpi_id": "kpi-1",
                "name": "On-time delivery",
                "governance_status": "draft",
                "updated_at": datetime.utcnow(),
            }
        ]

        result = queue_module.get_my_review_queue(
            include_kpis=True, include_flagged=False, current_user=_user()
        )

        kpi_items = [i for i in result["awaiting_my_approval"] if i["artifact_type"] == "kpi"]
        self.assertEqual(len(kpi_items), 1)
        self.assertEqual(kpi_items[0]["state"], "draft")

    def test_certified_kpis_are_not_still_asking_for_attention(self):
        self.collection.find.return_value = [{"_id": ObjectId()}]
        self.kpi_db.contract_kpis.find.return_value = []

        queue_module.get_my_review_queue(
            include_kpis=True, include_flagged=False, current_user=_user()
        )

        kpi_query = self.kpi_db.contract_kpis.find.call_args[0][0]
        self.assertEqual(kpi_query["governance_status"], {"$in": ["draft", "reviewed"]})

    def test_extractions_the_model_flagged_land_in_the_edit_queue(self):
        contract_oid = ObjectId()
        self.collection.find.return_value = [{"_id": contract_oid}]
        self.kpi_db.contract_kpis.find.return_value = [
            {
                "contract_id": str(contract_oid),
                "kpi_id": "kpi-9",
                "name": "Rebate threshold",
                "needs_review": True,
                "notes": "Threshold depends on an exhibit that is not in the sources.",
                "updated_at": datetime.utcnow(),
            }
        ]

        result = queue_module.get_my_review_queue(
            include_kpis=False, include_flagged=True, current_user=_user()
        )

        flagged = [i for i in result["awaiting_my_edit"] if i["artifact_type"] == "flagged_extraction"]
        self.assertEqual(len(flagged), 1)
        self.assertEqual(flagged[0]["state"], "needs_review")
        self.assertIn("exhibit", flagged[0]["note"])

    def test_opting_out_skips_the_kpi_database_entirely(self):
        queue_module.get_my_review_queue(
            include_kpis=False, include_flagged=False, current_user=_user()
        )

        self.kpi_db.contract_kpis.find.assert_not_called()


if __name__ == "__main__":
    unittest.main()
