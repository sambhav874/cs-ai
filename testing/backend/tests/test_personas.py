"""Privileges, personas, and what a member effectively holds."""

import os
import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

from bson import ObjectId
from unittest.mock import patch

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

from core.privileges import (
    ACCOUNT_PERSONAS,
    CONTRACT_APPROVE,
    CONTRACT_EDIT,
    DEFAULT_PERSONAS,
    KPI_CERTIFY,
)
from services.personas import (
    can_hold_workflow_role,
    effective_privileges,
    seed_account_personas,
)

MEMBER = ObjectId()
OTHER = ObjectId()
ACCOUNT = ObjectId()
PERSONA_ID = ObjectId()


def _persona(name, privileges, persona_id=PERSONA_ID):
    return {"_id": persona_id, "accountId": ACCOUNT, "name": name, "privileges": list(privileges)}


def _team(member_overrides=None):
    member = {"userId": MEMBER, "team_role": "member", "personaId": PERSONA_ID}
    member.update(member_overrides or {})
    return {"_id": ACCOUNT, "members": [member, {"userId": OTHER, "team_role": "admin"}]}


class EffectivePrivilegeTests(unittest.TestCase):
    def test_a_member_holds_their_persona(self):
        held = effective_privileges(
            team=_team(),
            user_id=MEMBER,
            personas=[_persona("Approver", [CONTRACT_EDIT, CONTRACT_APPROVE])],
        )

        self.assertEqual(held, {CONTRACT_EDIT, CONTRACT_APPROVE})

    def test_a_grant_adds_to_the_persona(self):
        team = _team({"grants": [{"privilege": KPI_CERTIFY, "until": None}]})

        held = effective_privileges(
            team=team, user_id=MEMBER, personas=[_persona("Viewer", [CONTRACT_EDIT])]
        )

        self.assertIn(KPI_CERTIFY, held)

    def test_a_lapsed_grant_stops_counting_without_anyone_revoking_it(self):
        team = _team({
            "grants": [{"privilege": CONTRACT_APPROVE, "until": datetime.utcnow() - timedelta(days=1)}]
        })

        held = effective_privileges(
            team=team, user_id=MEMBER, personas=[_persona("Viewer", [CONTRACT_EDIT])]
        )

        self.assertNotIn(CONTRACT_APPROVE, held)

    def test_a_grant_with_a_future_expiry_still_counts(self):
        team = _team({
            "grants": [{"privilege": CONTRACT_APPROVE, "until": datetime.utcnow() + timedelta(days=1)}]
        })

        held = effective_privileges(
            team=team, user_id=MEMBER, personas=[_persona("Viewer", [CONTRACT_EDIT])]
        )

        self.assertIn(CONTRACT_APPROVE, held)

    def test_a_revoked_grant_stops_counting(self):
        team = _team({
            "grants": [{"privilege": CONTRACT_APPROVE, "until": None, "revokedAt": datetime.utcnow()}]
        })

        held = effective_privileges(
            team=team, user_id=MEMBER, personas=[_persona("Viewer", [CONTRACT_EDIT])]
        )

        self.assertNotIn(CONTRACT_APPROVE, held)

    def test_a_revoke_removes_something_the_persona_grants(self):
        team = _team({"revokes": [CONTRACT_APPROVE]})

        held = effective_privileges(
            team=team,
            user_id=MEMBER,
            personas=[_persona("Approver", [CONTRACT_EDIT, CONTRACT_APPROVE])],
        )

        self.assertEqual(held, {CONTRACT_EDIT})

    def test_someone_outside_the_account_holds_nothing(self):
        held = effective_privileges(
            team=_team(), user_id=ObjectId(), personas=[_persona("Owner", [ACCOUNT_PERSONAS])]
        )

        self.assertEqual(held, set())

    def test_an_unknown_privilege_is_dropped_rather_than_trusted(self):
        held = effective_privileges(
            team=_team(), user_id=MEMBER, personas=[_persona("Odd", ["contract.launch_missiles"])]
        )

        self.assertEqual(held, set())

    def test_a_member_with_no_persona_falls_back_to_their_team_role(self):
        # An account that has not been seeded still resolves, rather than
        # locking everyone out until a migration runs.
        team = {"_id": ACCOUNT, "members": [{"userId": MEMBER, "team_role": "admin"}]}

        held = effective_privileges(
            team=team,
            user_id=MEMBER,
            personas=[_persona("Owner", [ACCOUNT_PERSONAS, CONTRACT_APPROVE])],
        )

        self.assertIn(ACCOUNT_PERSONAS, held)

    def test_a_persona_id_stored_as_a_string_still_resolves(self):
        # Documents come back from the response cache with ids as strings.
        team = _team({"personaId": str(PERSONA_ID)})

        held = effective_privileges(
            team=team, user_id=str(MEMBER), personas=[_persona("Approver", [CONTRACT_APPROVE])]
        )

        self.assertIn(CONTRACT_APPROVE, held)


class EligibilityTests(unittest.TestCase):
    def test_approver_needs_the_approve_privilege(self):
        self.assertFalse(can_hold_workflow_role({CONTRACT_EDIT}, "approver"))
        self.assertTrue(can_hold_workflow_role({CONTRACT_APPROVE}, "approver"))

    def test_editor_needs_the_edit_privilege(self):
        self.assertFalse(can_hold_workflow_role({CONTRACT_APPROVE}, "editor"))
        self.assertTrue(can_hold_workflow_role({CONTRACT_EDIT}, "editor"))

    def test_an_unknown_role_is_not_gated(self):
        self.assertTrue(can_hold_workflow_role(set(), "observer"))


class SeedingTests(unittest.TestCase):
    def setUp(self):
        self.personas = MagicMock()
        self.personas.find.return_value = []
        self.inserted = []

        def insert_one(document):
            # Keep the caller's dict, not a copy: the code writes _id back onto
            # it and the assertions below read that id.
            self.inserted.append(document)
            return MagicMock(inserted_id=ObjectId())

        self.personas.insert_one.side_effect = insert_one
        self.teams = MagicMock()

    def test_seeding_creates_the_shipped_personas(self):
        team = {"_id": ACCOUNT, "members": []}

        seed_account_personas(
            team=team, personas_collection=self.personas, teams_collection=self.teams
        )

        self.assertEqual(
            {document["name"] for document in self.inserted},
            set(DEFAULT_PERSONAS),
        )

    def test_seeding_maps_an_admin_to_owner_and_a_member_to_contract_manager(self):
        team = {
            "_id": ACCOUNT,
            "members": [
                {"userId": OTHER, "team_role": "admin"},
                {"userId": MEMBER, "team_role": "member"},
            ],
        }

        seed_account_personas(
            team=team, personas_collection=self.personas, teams_collection=self.teams
        )

        assigned = self.teams.update_one.call_args[0][1]["$set"]
        by_name = {document["name"]: document["_id"] for document in self.inserted}
        self.assertEqual(assigned["members.0.personaId"], by_name["Owner"])
        self.assertEqual(assigned["members.1.personaId"], by_name["Contract manager"])

    def test_seeding_leaves_a_member_who_already_has_a_persona_alone(self):
        team = {"_id": ACCOUNT, "members": [{"userId": MEMBER, "personaId": PERSONA_ID}]}

        seed_account_personas(
            team=team, personas_collection=self.personas, teams_collection=self.teams
        )

        self.teams.update_one.assert_not_called()

    def test_seeding_twice_creates_nothing_the_second_time(self):
        existing = [
            {"_id": ObjectId(), "accountId": ACCOUNT, "name": name, "privileges": privileges}
            for name, privileges in DEFAULT_PERSONAS.items()
        ]
        self.personas.find.return_value = existing

        seed_account_personas(
            team={"_id": ACCOUNT, "members": []},
            personas_collection=self.personas,
            teams_collection=self.teams,
        )

        self.personas.insert_one.assert_not_called()


class ShippedBundleTests(unittest.TestCase):
    """The bundles are editable data, but the shipped ones encode the split the
    whole model exists for."""

    def test_finance_certifies_but_cannot_approve_contracts(self):
        finance = DEFAULT_PERSONAS["Finance"]

        self.assertIn(KPI_CERTIFY, finance)
        self.assertNotIn(CONTRACT_APPROVE, finance)

    def test_the_approver_bundle_cannot_certify(self):
        approver = DEFAULT_PERSONAS["Approver"]

        self.assertIn(CONTRACT_APPROVE, approver)
        self.assertNotIn(KPI_CERTIFY, approver)

    def test_only_owner_can_edit_personas(self):
        for name, privileges in DEFAULT_PERSONAS.items():
            if name == "Owner":
                self.assertIn(ACCOUNT_PERSONAS, privileges)
            else:
                self.assertNotIn(ACCOUNT_PERSONAS, privileges, name)


if __name__ == "__main__":
    unittest.main()


class CertificationGateTests(unittest.IsolatedAsyncioTestCase):
    """Certifying is positional: it needs kpi.certify, not a workflow role.

    It used to be gated on the contract's approver, which put a legal sign-off
    in charge of a financial claim.
    """

    def setUp(self):
        from api.routes import kpis as kpis_module

        self.kpis_module = kpis_module
        self.contract = {
            "_id": ObjectId(),
            "ownerType": "team",
            "ownerId": ACCOUNT,
            "contract_name": "Services Agreement",
        }
        self.collection = MagicMock()
        self.collection.find_one.return_value = self.contract
        self.manager = MagicMock()
        self.manager.certify_kpi.return_value = {"governance_status": "certified", "governance_version": 2}
        self.privileges = {KPI_CERTIFY}

        self.patches = [
            patch.object(kpis_module, "collection", self.collection),
            patch.object(kpis_module, "check_contract_access", MagicMock()),
            patch.object(kpis_module, "_kpi_manager", MagicMock(return_value=self.manager)),
            patch.object(kpis_module, "create_audit_log", AsyncMock()),
            patch.object(kpis_module, "cache", MagicMock()),
            patch.object(
                kpis_module,
                "privileges_for_contract",
                MagicMock(side_effect=lambda *_a, **_k: self.privileges),
            ),
        ]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self.patches])

    async def _certify(self, status="certified"):
        from models.domain import UserInDB  # noqa: F401  (imported for parity with the route)

        user = MagicMock()
        user.id = str(MEMBER)
        user.username = "tester"
        user.ownedAccountId = None
        return await self.kpis_module.certify_contract_kpi(
            contract_id=str(self.contract["_id"]),
            kpi_id="kpi-1",
            request=self.kpis_module.KPICertificationRequest(status=status),
            current_user=user,
        )

    async def test_someone_holding_the_privilege_can_certify(self):
        result = await self._certify()

        self.assertEqual(result["governance_status"], "certified")

    async def test_someone_without_it_is_refused(self):
        self.privileges = {"contract.approve"}

        with self.assertRaises(HTTPException) as raised:
            await self._certify()

        self.assertEqual(raised.exception.status_code, 403)
        self.manager.certify_kpi.assert_not_called()

    async def test_deprecating_needs_the_same_privilege(self):
        self.privileges = set()

        with self.assertRaises(HTTPException) as raised:
            await self._certify(status="deprecated")

        self.assertEqual(raised.exception.status_code, 403)

    async def test_proposing_a_draft_stays_open_to_anyone_with_access(self):
        # Proposing is not certifying; only the states a finance reader relies
        # on are gated.
        self.privileges = set()

        result = await self._certify(status="reviewed")

        self.assertTrue(self.manager.certify_kpi.called)
        self.assertIsNotNone(result)
