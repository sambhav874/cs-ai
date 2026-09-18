"""/users/me never returns the password hash (it used to return all of UserInDB)."""
import asyncio

from models.domain import UserInDB
from api.routes.auth import read_users_me


def test_users_me_omits_hashed_password():
    user = UserInDB.model_validate({
        "_id": "48d7843b748b8958c871f0a0",
        "username": "a@example.com",
        "email": "a@example.com",
        "hashed_password": "$2b$12$abcdefghijklmnopqrstuv",
        "tokens": 0,
    })
    body = asyncio.run(read_users_me(user))
    assert "hashed_password" not in body
    assert body["_id"] == "48d7843b748b8958c871f0a0"
    assert body["email"] == "a@example.com"
