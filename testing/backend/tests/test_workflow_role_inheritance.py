"""Project-level role defaults, and what a contract inherits from them."""

import os
import sys
import unittest
from pathlib import Path

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

from services.workflow_roles import (
    conflicting_role_assignment,
    effective_roles_for_contract,
    resolve_workflow_roles,
)


PROJECT_EDITOR = ObjectId()
PROJECT_APPROVER = ObjectId()
CONTRACT_EDITOR = ObjectId()


class FakeProjects:
    def __init__(self, project=None):
        self.project = project
        self.queries = []

    def find_one(self, query, projection=None):
        self.queries.append(query)
        return self.project


class RoleResolutionTests(unittest.TestCase):
    def test_a_contract_with_no_roles_inherits_the_project_defaults(self):
        project = {"workflowRoles": {"editorUserId": PROJECT_EDITOR, "approverUserId": PROJECT_APPROVER}}

        roles = resolve_workflow_roles({"workflowRoles": {}}, project)

        self.assertEqual(roles["editorUserId"], PROJECT_EDITOR)
        self.assertEqual(roles["approverUserId"], PROJECT_APPROVER)
        self.assertEqual(roles["editorUserIdSource"], "project")
        self.assertEqual(roles["approverUserIdSource"], "project")

    def test_a_contract_level_assignment_overrides_the_project(self):
        project = {"workflowRoles": {"editorUserId": PROJECT_EDITOR, "approverUserId": PROJECT_APPROVER}}
        contract = {"workflowRoles": {"editorUserId": CONTRACT_EDITOR}}

        roles = resolve_workflow_roles(contract, project)

        self.assertEqual(roles["editorUserId"], CONTRACT_EDITOR)
        self.assertEqual(roles["editorUserIdSource"], "contract")
        # The role the contract stays silent about still comes from the project.
        self.assertEqual(roles["approverUserId"], PROJECT_APPROVER)
        self.assertEqual(roles["approverUserIdSource"], "project")

    def test_no_project_and_no_contract_roles_resolves_to_nobody(self):
        roles = resolve_workflow_roles({}, None)

        self.assertIsNone(roles["editorUserId"])
        self.assertIsNone(roles["approverUserId"])
        self.assertIsNone(roles["editorUserIdSource"])

    def test_a_contract_outside_any_project_never_queries_for_one(self):
        projects = FakeProjects()

        roles = effective_roles_for_contract({"workflowRoles": {}}, projects)

        self.assertEqual(projects.queries, [])
        self.assertIsNone(roles["editorUserId"])

    def test_effective_roles_look_the_project_up_by_id(self):
        project_oid = ObjectId()
        projects = FakeProjects({"workflowRoles": {"approverUserId": PROJECT_APPROVER}})

        roles = effective_roles_for_contract(
            {"projectId": project_oid, "workflowRoles": {}}, projects
        )

        self.assertEqual(projects.queries, [{"_id": project_oid}])
        self.assertEqual(roles["approverUserId"], PROJECT_APPROVER)

    def test_a_garbled_role_value_is_treated_as_unset_rather_than_trusted(self):
        roles = resolve_workflow_roles({"workflowRoles": {"editorUserId": "not-an-object-id"}}, None)

        self.assertIsNone(roles["editorUserId"])


class ConflictTests(unittest.TestCase):
    def test_the_same_user_in_both_roles_conflicts(self):
        self.assertTrue(conflicting_role_assignment(PROJECT_EDITOR, PROJECT_EDITOR))

    def test_distinct_users_do_not_conflict(self):
        self.assertFalse(conflicting_role_assignment(PROJECT_EDITOR, PROJECT_APPROVER))

    def test_an_unfilled_role_cannot_conflict(self):
        self.assertFalse(conflicting_role_assignment(PROJECT_EDITOR, None))
        self.assertFalse(conflicting_role_assignment(None, None))


if __name__ == "__main__":
    unittest.main()
