"""One identity across both tiers (merge step 3): core/platform_identity.

A token the lifecycle API issued is verified here and mapped onto a shadow
ContractSense user and team. These tests pin what must never loosen: which
tokens are accepted, and that the mapping cannot cross an organisation.
"""
import time

import jwt
import mongomock
import pytest
from bson import ObjectId

import core.platform_identity as pi

SECRET = "t" * 64
USER, ORG, OTHER_ORG = "cmuser0000000000000000001", "cmorg00000000000000000001", "cmorg00000000000000000002"


@pytest.fixture(autouse=True)
def _secret(monkeypatch):
    monkeypatch.setattr(pi.settings, "platform_jwt_secret", SECRET, raising=False)
    pi.clear_cache()
    yield
    pi.clear_cache()


def token(**over):
    now = int(time.time())
    claims = {"sub": USER, "orgId": ORG, "roles": ["MEMBER"], "type": "access", "iat": now, "exp": now + 300}
    claims.update(over)
    return jwt.encode({k: v for k, v in claims.items() if v is not None}, over.pop("_secret", SECRET), algorithm="HS256")


def stores(status="ACTIVE", org=ORG, deleted=None):
    client = mongomock.MongoClient()
    platform = client.platform
    platform.users.insert_one({"_id": USER, "email": "maya@example.com", "orgId": org, "status": status, "deletedAt": deleted})
    platform.organizations.insert_one({"_id": ORG, "name": "Demo Corp"})
    return client.cs.users, client.cs.teams, platform


# ── Token ─────────────────────────────────────────────────────────────────────

def test_accepts_a_valid_access_token():
    claims = pi.decode_platform_access_token(token())
    assert claims["sub"] == USER and claims["orgId"] == ORG


@pytest.mark.parametrize("bad", [
    token(type="refresh"),                      # refresh tokens share the secret
    token(exp=int(time.time()) - 10),           # expired
    token(orgId=None),                          # no org
    token(exp=None),                            # no expiry at all
    jwt.encode({"sub": USER, "orgId": ORG, "type": "access", "exp": int(time.time()) + 60}, "wrong" * 13, algorithm="HS256"),
    jwt.encode({"sub": USER, "orgId": ORG, "type": "access", "exp": int(time.time()) + 60}, None, algorithm="none"),
    "not-a-jwt",
    "",
])
def test_rejects_anything_else(bad):
    assert pi.decode_platform_access_token(bad) is None


def test_rejects_when_no_secret_is_configured(monkeypatch):
    monkeypatch.setattr(pi.settings, "platform_jwt_secret", "", raising=False)
    monkeypatch.delenv("JWT_SECRET", raising=False)
    assert pi.decode_platform_access_token(token()) is None


# ── Mapping ───────────────────────────────────────────────────────────────────

def test_ids_are_deterministic_and_namespaced():
    assert pi.derive_object_id("user", USER) == pi.derive_object_id("user", USER)
    assert pi.derive_object_id("user", ORG) != pi.derive_object_id("org", ORG)
    assert isinstance(pi.derive_object_id("org", ORG), ObjectId)


def test_member_gets_a_shadow_user_in_the_org_team():
    users, teams, platform = stores()
    doc = pi.resolve_platform_user(pi.decode_platform_access_token(token()), users=users, teams=teams, platform_db=platform)
    org_oid = pi.derive_object_id("org", ORG)
    assert doc["email"] == "maya@example.com"
    assert doc["teamIds"] == [str(org_oid)]
    assert doc["ownedAccountId"] is None
    assert doc["hashed_password"] == "!"          # cannot verify against any password
    team = teams.find_one({"_id": org_oid})
    assert team["name"] == "Demo Corp"
    assert [m["team_role"] for m in team["members"]] == ["member"]


def test_admin_owns_the_account_and_role_changes_propagate():
    users, teams, platform = stores()
    admin = pi.resolve_platform_user(pi.decode_platform_access_token(token(roles=["ADMIN"])), users=users, teams=teams, platform_db=platform)
    assert admin["ownedAccountId"] == str(pi.derive_object_id("org", ORG))
    pi.clear_cache()
    pi.resolve_platform_user(pi.decode_platform_access_token(token(roles=["MEMBER"])), users=users, teams=teams, platform_db=platform)
    team = teams.find_one({"_id": pi.derive_object_id("org", ORG)})
    assert len(team["members"]) == 1                 # updated in place, not appended
    assert team["members"][0]["team_role"] == "member"


def test_token_for_another_org_is_refused():
    users, teams, platform = stores(org=ORG)
    claims = pi.decode_platform_access_token(token(orgId=OTHER_ORG))
    with pytest.raises(pi.PlatformIdentityError):
        pi.resolve_platform_user(claims, users=users, teams=teams, platform_db=platform)
    assert users.count_documents({}) == 0


def test_deleted_or_unknown_users_are_refused():
    users, teams, platform = stores(deleted="2026-09-01")
    with pytest.raises(pi.PlatformIdentityError):
        pi.resolve_platform_user(pi.decode_platform_access_token(token()), users=users, teams=teams, platform_db=platform)
    users, teams, platform = stores()
    with pytest.raises(pi.PlatformIdentityError):
        pi.resolve_platform_user(pi.decode_platform_access_token(token(sub="cmnobody")), users=users, teams=teams, platform_db=platform)


def test_deactivated_user_is_disabled():
    users, teams, platform = stores(status="DEACTIVATED")
    doc = pi.resolve_platform_user(pi.decode_platform_access_token(token()), users=users, teams=teams, platform_db=platform)
    assert doc["disabled"] is True
