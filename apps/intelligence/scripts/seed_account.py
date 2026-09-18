"""Seed a user and its account with a credit balance.

    poetry run python scripts/seed_account.py --username ravikumar --credits 90000

Idempotent: re-running updates the password and sets the balance. Writes to the
core DB the API is pointed at, so pick your environment with MONGO_URI / .env.
"""

import argparse
import sys
from datetime import datetime
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from core.database import accounts_collection, users_collection  # noqa: E402
from core.security import get_password_hash  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--username", default="ravikumar")
    parser.add_argument("--email", default=None, help="defaults to <username>@example.com")
    parser.add_argument("--password", default="RaviKumar123!")
    parser.add_argument("--credits", type=int, default=90000)
    args = parser.parse_args()

    email = args.email or f"{args.username}@example.com"
    now = datetime.utcnow()

    user = users_collection.find_one({"username": args.username})
    if user:
        user_id = user["_id"]
        users_collection.update_one(
            {"_id": user_id},
            {"$set": {"hashed_password": get_password_hash(args.password), "email": email}},
        )
        print(f"user '{args.username}' exists ({user_id}) — password reset")
    else:
        user_id = users_collection.insert_one({
            "username": args.username,
            "email": email,
            "hashed_password": get_password_hash(args.password),
            "tokens": 0,
            "teamIds": [],
            "disabled": False,
        }).inserted_id
        print(f"user '{args.username}' created ({user_id})")

    accounts_collection.update_one(
        {"user_id": user_id},
        {"$set": {"page_credits": args.credits, "updated_at": now},
         "$setOnInsert": {"user_id": user_id, "created_at": now}},
        upsert=True,
    )
    print(f"account balance set to {args.credits} credits")
    print(f"\nlogin: {args.username} / {args.password}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
