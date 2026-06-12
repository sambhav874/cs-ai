# In apps/backend/test_support/testing_utils.py
import logging
from fastapi import APIRouter, HTTPException, Depends
from core.config import settings
from core.database import db
from core.security import get_password_hash, UserInDB, get_current_active_user
from bson import ObjectId
from datetime import datetime
from pymongo.errors import ConnectionFailure

testing_router = APIRouter()

@testing_router.post("/testing/reset-and-seed", tags=["Testing"])
async def reset_and_seed_database(
    current_user: UserInDB = Depends(get_current_active_user)
):
    users_collection = db["users"]
    teams_collection = db["teams"]
    accounts_collection = db["accounts"]
    contracts_collection = db["contracts"]
    audit_logs_collection = db["audit_logs"]
    
    if getattr(current_user, "system_role", "user") != "admin":
        raise HTTPException(status_code=403, detail="System admin role required.")
        
    if not settings.testing:
        raise HTTPException(status_code=403, detail="Endpoint only available in testing.")
    
    try:
        # 1. HEALTH CHECK: Prove we can connect and authenticate.
        db.command('ping')
        logging.info(f"--- DB HEALTH CHECK PASSED --- Successfully pinged DB: '{db.name}'")

        # 2. Clear collections
        users_collection.delete_many({})
        teams_collection.delete_many({})
        accounts_collection.delete_many({})
        contracts_collection.delete_many({})
        audit_logs_collection.delete_many({})

        # 3. Define users and team
        owner_id = ObjectId()
        editor_id = ObjectId()
        approver_id = ObjectId()
        pro_team_id = ObjectId()
        
        users_to_create = [
            { "_id": owner_id, "username": "test-uploader", "email": "uploader@test.com", "hashed_password": get_password_hash("password123"), "ownedAccountId": str(pro_team_id), "teamIds": [str(pro_team_id)], "disabled": False, "tokens": 0 },
            { "_id": editor_id, "username": "test-editor", "email": "editor@test.com", "hashed_password": get_password_hash("password123"), "teamIds": [str(pro_team_id)], "disabled": False, "tokens": 0 },
            { "_id": approver_id, "username": "test-approver", "email": "approver@test.com", "hashed_password": get_password_hash("password123"), "teamIds": [str(pro_team_id)], "disabled": False, "tokens": 0 }
        ]

        # 4. Insert users and VERIFY the result
        insert_result = users_collection.insert_many(users_to_create)
        if not insert_result.acknowledged or len(insert_result.inserted_ids) != 3:
            raise Exception("Seeding users failed: Insert not acknowledged or wrong count.")
        logging.info(f"--- DB SEEDING --- Successfully inserted {len(insert_result.inserted_ids)} users.")

        # 5. Create Team and Account -- THIS IS WHERE THE FIX IS
        now = datetime.utcnow() # Get the current time once

        teams_collection.insert_one({
            "_id": pro_team_id,
            "name": "E2E Pro Team",
            "creatorId": owner_id,
            
            # --- START OF FIX ---
            "createdAt": now, # Add the required createdAt field
            "updatedAt": now, # Add the required updatedAt field
            "members": [
                {
                    "userId": owner_id, 
                    "team_role": "admin",
                    "addedBy": owner_id, # The owner added themselves
                    "addedAt": now       # Add the timestamp for when they were added
                },
                {
                    "userId": editor_id, 
                    "team_role": "member",
                    "addedBy": owner_id, # The owner added the editor
                    "addedAt": now
                },
                {
                    "userId": approver_id, 
                    "team_role": "member",
                    "addedBy": owner_id, # The owner added the approver
                    "addedAt": now
                }
            ]
            # --- END OF FIX ---
        })
        accounts_collection.insert_one({ "user_id": owner_id, "page_credits": 999 })

    except ConnectionFailure as e:
        logging.error(f"DATABASE CONNECTION FAILED: {e}")
        raise HTTPException(status_code=500, detail=f"Database Connection Failure: {e}")
    except Exception as e:
        logging.error(f"DATABASE SEEDING FAILED: {e}")
        raise HTTPException(status_code=500, detail=f"Database Seeding Failed: {e}")
    
    return {"message": "Test database reset and seeded with a Pro account."}


@testing_router.post("/testing/ensure-users", tags=["Testing"])
async def ensure_test_users(
    current_user: UserInDB = Depends(get_current_active_user)
):
    """
    Checks for E2E test users and creates them ONLY if they don't exist.
    This is a non-destructive operation, safe for a shared dev environment.
    It does NOT wipe any collections.
    """
    if getattr(current_user, "system_role", "user") != "admin":
        raise HTTPException(status_code=403, detail="System admin role required.")
        
    if not settings.testing:
        # Safety check: This endpoint should not be available in production.
        raise HTTPException(status_code=403, detail="Endpoint only available in testing.")

    users_collection = db["users"]
    
    users_to_ensure = [
        {"username": "test-uploader", "email": "uploader@e2e.test", "password": "password123"},
        {"username": "test-editor", "email": "editor@e2e.test", "password": "password123"},
        {"username": "test-approver", "email": "approver@e2e.test", "password": "password123"},
    ]

    users_created_count = 0
    users_found_count = 0

    try:
        for user_data in users_to_ensure:
            # Check if a user with this username already exists
            existing_user = users_collection.find_one({"username": user_data["username"]})
            
            if not existing_user:
                # If the user does not exist, create them
                hashed_password = get_password_hash(user_data["password"])
                
                new_user_doc = {
                    "username": user_data["username"],
                    "email": user_data["email"],
                    "hashed_password": hashed_password,
                    # Add default fields your user model requires to be valid
                    "disabled": False,
                    "tokens": 0,
                    "teamIds": [], # Initially empty, can be added to teams later if needed
                    "ownedAccountId": None
                }
                users_collection.insert_one(new_user_doc)
                users_created_count += 1
                logging.info(f"Created missing test user: {user_data['username']}")
            else:
                users_found_count += 1
                logging.info(f"Found existing test user: {user_data['username']}")
        
        # NOTE: This endpoint does NOT create teams or accounts. It assumes the
        # necessary "E2E Pro Team" and its associated billing account already exist
        # in the dev environment from a one-time manual setup.

    except Exception as e:
        logging.error(f"FAILED TO ENSURE TEST USERS: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to ensure test users exist: {e}")
    
    return {
        "message": "Test user check complete.",
        "users_found": users_found_count,
        "users_created": users_created_count
    }
