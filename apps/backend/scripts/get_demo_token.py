#!/usr/bin/env python3
"""Automated script to create/retrieve a demo account and print the auth token."""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from core.config import settings
from core.database import db, users_collection, accounts_collection
from core.security import get_password_hash, create_access_token

DEMO_USERNAME = "demouser"
DEMO_EMAIL = "demouser@contractsense.com"
DEMO_PASSWORD = "DemoPassword123!"


def main():
    print("[*] Connecting to database...")
    print(f"[*] Target DB Name: {db.name}")

    # 1. Look for existing demo user
    user = users_collection.find_one({"username": DEMO_USERNAME})
    
    if not user:
        print("[+] Demo user not found. Creating a new demo account...")
        hashed_password = get_password_hash(DEMO_PASSWORD)
        new_user = {
            "username": DEMO_USERNAME,
            "email": DEMO_EMAIL,
            "hashed_password": hashed_password,
            "tokens": 0,
            "teamIds": [],
            "disabled": False
        }
        insert_result = users_collection.insert_one(new_user)
        user_id = insert_result.inserted_id
        
        # Create corresponding account with free credits
        account_data = {
            "user_id": user_id,
            "page_credits": 10000,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }
        accounts_collection.insert_one(account_data)
        print(f"[+] Demo account created successfully with ID: {user_id}")
    else:
        user_id = user["_id"]
        print(f"[*] Demo user already exists with ID: {user_id}")
        
        # Ensure credits are topped up
        account = accounts_collection.find_one({"user_id": user_id})
        if not account or account.get("page_credits", 0) < 5000:
            accounts_collection.update_one(
                {"user_id": user_id},
                {"$set": {"page_credits": 10000, "updated_at": datetime.utcnow()}},
                upsert=True
            )
            print("[+] Demo credits topped up to 10,000.")

    # 2. Generate long-term JWT access token (valid for 7 days)
    token_expiry = timedelta(days=7)
    access_token = create_access_token(
        data={"sub": DEMO_USERNAME},
        expires_delta=token_expiry
    )

    # 3. Print copy-pasteable details
    print("\n" + "="*70)
    print("DEMO ACCOUNT CREDENTIALS")
    print("="*70)
    print(f"Username: {DEMO_USERNAME}")
    print(f"Password: {DEMO_PASSWORD}")
    print(f"Email:    {DEMO_EMAIL}")
    print(f"Credits:  10,000 pages")
    print("="*70)
    print("\nTo set the token in your terminal environment, copy and paste this command:")
    print("-" * 70)
    print(f'export CONTRACTSENSE_FINAL_EVAL_AUTH_TOKEN="{access_token}"')
    print("-" * 70)
    print("="*70 + "\n")


if __name__ == "__main__":
    main()
