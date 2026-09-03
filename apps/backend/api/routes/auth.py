import logging
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, Request, Query, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from jose import JWTError, jwt

from core.config import settings
from core.rate_limiter import limiter
from core.validators import validate_password_strength
from core.database import (
    async_db,
    users_collection,
    accounts_collection,
    teams_collection,
    collection,
)
from core.security import (
    AUTH_COOKIE_NAME,
    AUTH_COOKIE_SENTINEL,
    authenticate_user,
    clear_auth_cookies,
    create_access_token,
    get_current_active_user,
    get_password_hash,
    set_auth_cookies,
)
from models.domain import (
    UserCreate,
    Token,
    UserInDB,
    TeamMember,
    AccessibleAccountInfo,
)
from utils.audit_logger import create_audit_log
from services.analytics import track_ga_event

logger = logging.getLogger(__name__)

auth_router = APIRouter()

@auth_router.post("/signup/", response_model=Token)
@limiter.limit("3/minute")
async def signup(request: Request, response: Response, user: UserCreate, background_tasks: BackgroundTasks):
    """
    Registers a new user, applies a coupon for free credits if provided,
    and initializes their account.
    """
    logger.info("Signup attempt received.")
    validate_password_strength(user.password)
    
    users_col = async_db["users"]
    accounts_col = async_db["accounts"]
    beta_signups_col = async_db["beta_signups"]

    # 1. Check if username or email already exists.
    if await users_col.find_one({"username": user.username}):
        logger.warning(f"Signup failed: Username '{user.username}' already registered.")
        raise HTTPException(status_code=400, detail="A user with this username or email already exists.")

    if await users_col.find_one({"email": user.email}):
        logger.warning(f"Signup failed: Email '{user.email}' already registered.")
        raise HTTPException(status_code=400, detail="A user with this username or email already exists.")

    # 2. Handle coupon code validation and credit assignment
    initial_page_credits = 0
    if user.coupon_code:
        coupon_doc = await beta_signups_col.find_one({
            "coupon.code": user.coupon_code,
            "email": user.email,
            "coupon.status": "issued"
        })

        if not coupon_doc:
            logger.warning("Invalid or already used coupon attempt.")
            raise HTTPException(status_code=400, detail="Invalid or already used coupon code.")

        initial_page_credits = 50  # Beta coupon is worth 50 free credits
        logger.info("Valid beta coupon provided during signup.")

        # Mark the coupon as redeemed to prevent reuse
        await beta_signups_col.update_one(
            {"_id": coupon_doc["_id"]},
            {"$set": {
                "coupon.status": "redeemed",
                "redemptionInfo.redeemedAt": datetime.utcnow(),
                "redemptionInfo.redeemedByUsername": user.username
            }}
        )
        logger.info("Beta coupon successfully redeemed.")

    # 3. Hash the password
    try:
        hashed_password = get_password_hash(user.password)
    except Exception as hash_err:
        logger.exception(f"Password hashing failed for user {user.username}: {hash_err}")
        raise HTTPException(status_code=500, detail="Error processing registration data.")

    # 4. Prepare user data for insertion
    new_user_data = {
        "username": user.username,
        "email": user.email,
        "hashed_password": hashed_password,
        "tokens": user.tokens,
        "teamIds": [],
        "disabled": False
    }

    # 5. Insert the new user document
    try:
        insert_result = await users_col.insert_one(new_user_data)
        user_oid = insert_result.inserted_id
        logger.info(f"User '{user.username}' created successfully with ID: {user_oid}")
    except Exception as e:
        logger.exception(f"Database error inserting user {user.username}: {e}")
        raise HTTPException(status_code=500, detail="Failed to register user due to a database error.")

    # 6. Create the account document with initial credits
    try:
        account_data = {
            "user_id": user_oid,
            "page_credits": initial_page_credits,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }
        await accounts_col.insert_one(account_data)
        logger.info(f"Account created for user ID: {user_oid} with {initial_page_credits} credits.")
    except Exception as e:
        logger.exception(f"CRITICAL: Failed to create account document for user ID {user_oid}: {e}")
        # Rollback user creation if account setup fails
        await users_col.delete_one({"_id": user_oid})
        logger.error(f"Rolled back user creation for {user.username} due to account creation failure.")
        raise HTTPException(status_code=500, detail="Failed to create user account.")

    # 7. Generate an access token
    try:
        access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
        access_token = create_access_token(
            data={"sub": user.username}, expires_delta=access_token_expires
        )
        logger.info(f"Access token generated for new user: {user.username}")
    except Exception as e:
        logger.exception(f"Failed to create access token for new user {user.username}: {e}")
        raise HTTPException(status_code=500, detail="User registered, but failed to create access token.")

    set_auth_cookies(response, access_token)
    background_tasks.add_task(
        track_ga_event,
        "sign_up",
        client_id=user.ga_client_id,
        user_id=str(user_oid),
        params={
            "method": "email_password",
            "status": "success",
            "coupon_applied": bool(user.coupon_code),
        },
    )

    return Token(access_token=AUTH_COOKIE_SENTINEL, token_type="cookie")

@auth_router.post("/token/", response_model=Token)
@limiter.limit("5/minute")
async def login_for_access_token(
    request: Request,
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
):
    user = authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    username = getattr(user, 'username', user.get('username') if isinstance(user, dict) else None)
    if not username:
         logger.error(f"Authenticated user object missing username: {user}")
         raise HTTPException(status_code=500, detail="Internal authentication error")
    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    access_token = create_access_token(data={"sub": username}, expires_delta=access_token_expires)
    set_auth_cookies(response, access_token)
    return Token(access_token=AUTH_COOKIE_SENTINEL, token_type="cookie")

@auth_router.post("/logout/", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response):
    from core.security import revoke_access_token
    revoke_access_token(request.cookies.get(AUTH_COOKIE_NAME))
    clear_auth_cookies(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response

@auth_router.get("/users/me/")
async def read_users_me(current_user: UserInDB = Depends(get_current_active_user)):
    return current_user

EVALUATION_WORKSPACE_ID = "600c00000000000000000001"

# The frontend shows the Evaluations nav to these two accounts; the backend
# now agrees with it rather than offering the workspace to everyone.
EVALUATION_USERNAMES = {"test-uploader", "demouser"}


def _may_use_evaluation_workspace(current_user: UserInDB) -> bool:
    """Membership decides. The username allowlist is a fallback for
    environments where the evaluation team document does not exist."""
    if teams_collection is not None:
        try:
            if teams_collection.find_one(
                {
                    "_id": ObjectId(EVALUATION_WORKSPACE_ID),
                    "members.userId": ObjectId(current_user.id),
                },
                {"_id": 1},
            ):
                return True
        except Exception as exc:
            logger.warning("Could not check evaluation workspace membership: %s", exc)

    return (current_user.username or "") in EVALUATION_USERNAMES


@auth_router.get("/users/me/accounts", response_model=List[AccessibleAccountInfo])
def list_accessible_accounts(
    current_user: UserInDB = Depends(get_current_active_user)
) -> List[AccessibleAccountInfo]:
    """
    Returns the user's personal account info, plus any teams/accounts
    they are a member of.
    """
    accounts = []
    
    # 1. Add Personal Account
    accounts.append(AccessibleAccountInfo(
        id="personal",
        name="Personal Workspace",
        role="owner",
        type="personal"
    ))
    
    # 2. Add Team Accounts the user is a member of
    user_team_ids = current_user.teamIds or []
    if current_user.ownedAccountId:
        owned_oid = None
        try:
            owned_oid = ObjectId(current_user.ownedAccountId)
        except Exception:
            pass
        if owned_oid and owned_oid not in user_team_ids:
            user_team_ids.append(owned_oid)
            
    if user_team_ids:
        team_oids = [ObjectId(tid) if isinstance(tid, str) else tid for tid in user_team_ids if tid]
        teams = list(teams_collection.find({"_id": {"$in": team_oids}}, {"_id": 1, "name": 1, "members": 1}))
        
        for team in teams:
            team_id_str = str(team["_id"])
            role = "member"
            # Determine user's role in the team
            is_team_owner = current_user.ownedAccountId == team_id_str
            for member in team.get("members", []):
                if str(member.get("userId")) == str(current_user.id):
                    raw_role = member.get("team_role", "member")
                    if raw_role in ("owner", "admin") or is_team_owner:
                        role = "owner"
                    else:
                        role = "member"
                    break
            else:
                # User not in members list but owns the team via ownedAccountId
                if is_team_owner:
                    role = "owner"
            
            accounts.append(AccessibleAccountInfo(
                id=team_id_str,
                name=team.get("name", f"Team {team_id_str}"),
                role=role,
                type="team"
            ))
            
    # 3. The evaluation workspace, for the people who actually work in it.
    #
    # This used to be appended for every user, as "owner", whether or not they
    # were a member — so a brand-new account saw a workspace it could not open,
    # and selecting it returned "User is not a member of this team".
    if _may_use_evaluation_workspace(current_user) and not any(
        account.id == EVALUATION_WORKSPACE_ID for account in accounts
    ):
        accounts.append(AccessibleAccountInfo(
            id=EVALUATION_WORKSPACE_ID,
            name="Evaluation Team Workspace",
            role="member",
            type="team",
        ))

    return accounts

@auth_router.get("/account/balance")
async def get_account_balance(
    context_id: Optional[str] = Query(None, description="Team ID or 'personal'"),
    current_user: UserInDB = Depends(get_current_active_user)
):
    """
    Fetches the account balance for either personal or team accounts.
    """
    try:
        # Same gate as the account list: this context handed unlimited credits
        # to anyone who named it.
        if context_id == EVALUATION_WORKSPACE_ID:
            if not _may_use_evaluation_workspace(current_user):
                raise HTTPException(
                    status_code=403,
                    detail="You are not a member of the evaluation workspace.",
                )
            return {
                "account_type": "team",
                "context_id": EVALUATION_WORKSPACE_ID,
                "team_name": "Evaluation Team Workspace",
                "page_credits": 999999,
                "user_id": str(current_user.id),
                "updated_at": datetime.utcnow()
            }

        account_to_check = None
        response_data = {
            "account_type": "personal",
            "context_id": None
        }

        if context_id and context_id.lower() != "personal":
            try:
                context_oid = ObjectId(context_id)
            except Exception:
                logger.warning(f"Invalid context_id format: {context_id}")
                raise HTTPException(
                    status_code=400,
                    detail="Invalid context_id format. Must be a valid team ID or 'personal'"
                )

            if context_id not in [str(tid) for tid in (current_user.teamIds or [])] and context_id != current_user.ownedAccountId:
                logger.warning(f"User {current_user.id} provided invalid context_id: {context_id}")
                raise HTTPException(
                    status_code=403,
                    detail="You don't have access to this team"
                )

            team_doc = teams_collection.find_one(
                {"_id": context_oid},
                {"creatorId": 1, "name": 1}
            )
            
            if not team_doc:
                logger.warning(f"Team not found: {context_id}")
                raise HTTPException(
                    status_code=404,
                    detail="Team not found"
                )
            
            account_to_check = team_doc.get("creatorId")
            if not account_to_check:
                logger.error(f"Team {context_id} has no creator_id")
                raise HTTPException(
                    status_code=400,
                    detail="Team configuration error - no creator specified"
                )
            
            response_data.update({
                "account_type": "team",
                "context_id": context_id,
                "team_name": team_doc.get("name")
            })
        else:
            account_to_check = ObjectId(current_user.id)

        account = accounts_collection.find_one(
            {"user_id": account_to_check},
            {"page_credits": 1, "updated_at": 1}
        )

        if not account:
            logger.warning(f"No account found for ID: {account_to_check}")
            raise HTTPException(
                status_code=404,
                detail="Account not found"
            )
        
        balance = account.get("page_credits", 0)
        updated_at = account.get("updated_at", datetime.utcnow())
        
        response_data.update({
            "page_credits": balance,
            "user_id": str(account_to_check),
            "updated_at": updated_at
        })
        
        return response_data
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error fetching account balance: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve account balance"
        )

@auth_router.post("/users/me/upgrade-to-pro", status_code=status.HTTP_200_OK)
async def upgrade_user_to_pro(
    current_user: UserInDB = Depends(get_current_active_user)
):
    """
    Upgrades the current user to Pro, creating their default Account and migrating personal documents.
    """
    logger.info(f"Upgrade to Pro request for user {current_user.id} ({current_user.username})")

    if teams_collection is None or users_collection is None or collection is None:
         logger.error("Database connection failure: One or more collections (teams, users, contracts) are None.")
         raise HTTPException(status_code=500, detail="Database connection failure during pro upgradation.")

    if current_user.ownedAccountId:
        logger.info(f"User {current_user.id} ({current_user.username}) is already Pro. Account ID: {current_user.ownedAccountId}")
        return {"message": "User is already upgraded to Pro.", "accountId": current_user.ownedAccountId}

    try:
        user_oid = ObjectId(current_user.id)
    except Exception:
        logger.error(f"Invalid user ID format for user {current_user.id}.")
        raise HTTPException(status_code=400, detail="Invalid user ID format.")

    account_name = f"{current_user.username}'s Account"
    new_pro_account_obj_id = None

    try:
        owner_member = TeamMember(
             userId=str(user_oid),
             team_role='admin',
             addedAt=datetime.utcnow(),
             addedBy=str(user_oid)
        )
        owner_member_dict = owner_member.model_dump()
        owner_member_dict['userId'] = user_oid
        owner_member_dict['addedBy'] = user_oid

        new_account_doc = {
            "name": account_name,
            "creatorId": user_oid,
            "members": [owner_member_dict],
            "createdAt": datetime.utcnow(),
            "updatedAt": datetime.utcnow()
        }

        insert_result = teams_collection.insert_one(new_account_doc)
        new_pro_account_obj_id = insert_result.inserted_id
        new_pro_account_id_str = str(new_pro_account_obj_id)
        logger.info(f"Pro Account created for user {current_user.id} with ID: {new_pro_account_id_str}.")

    except PyMongoError as e:
        logger.exception(f"Database error during Pro Account creation for user {current_user.id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to create Pro Account due to a database error.")
    except Exception as e:
        logger.exception(f"Unexpected error during Pro Account creation for user {current_user.id}: {e}")
        raise HTTPException(status_code=500, detail="An unexpected error occurred while creating Pro Account.")

    try:
        update_user_result = users_collection.update_one(
            {"_id": user_oid},
            {"$set": {"ownedAccountId": new_pro_account_obj_id}}
        )

        if update_user_result.matched_count == 0:
             logger.error(f"CRITICAL: Failed to find user {current_user.id} to set ownedAccountId after account creation. Rollback.")
             if new_pro_account_obj_id:
                 teams_collection.delete_one({"_id": new_pro_account_obj_id})
             raise HTTPException(status_code=500, detail="Account created, but failed to link to user profile. Account creation rolled back.")
        
        logger.info(f"User {current_user.id} profile updated with ownedAccountId: {new_pro_account_id_str}")

    except PyMongoError as e:
        logger.exception(f"Database error linking Pro Account {new_pro_account_id_str} to user {current_user.id}: {e}")
        if new_pro_account_obj_id:
            teams_collection.delete_one({"_id": new_pro_account_obj_id})
        raise HTTPException(status_code=500, detail="Failed to link Pro Account to user due to database error. Account creation rolled back.")
    except Exception as e:
        logger.exception(f"Unexpected error linking Pro Account {new_pro_account_id_str} to user {current_user.id}: {e}")
        if new_pro_account_obj_id:
            teams_collection.delete_one({"_id": new_pro_account_obj_id})
        raise HTTPException(status_code=500, detail="An unexpected error occurred while linking Pro Account to user. Account creation rolled back.")

    migrated_doc_count = 0
    try:
        migration_result = collection.update_many(
            {"ownerType": "user", "ownerId": user_oid},
            {"$set": {"ownerType": "team", "ownerId": new_pro_account_obj_id}}
        )
        migrated_doc_count = migration_result.modified_count
        logger.info(f"Migrated {migrated_doc_count} personal documents for user {current_user.id} to Pro Account {new_pro_account_id_str}.")

    except PyMongoError as e:
        logger.exception(f"Database error migrating documents for user {current_user.id} to account {new_pro_account_id_str}: {e}")
        if new_pro_account_obj_id: 
            teams_collection.delete_one({"_id": new_pro_account_obj_id})
            users_collection.update_one(
                {"_id": user_oid},
                {"$unset": {"ownedAccountId": ""}}
            )
        raise HTTPException(status_code=500, detail="Failed to migrate personal documents to Pro Account. Upgrade process rolled back.")

    try:
        await create_audit_log(
            user=current_user,
            action="ACCOUNT_UPGRADED_TO_PRO",
            account_id_override=new_pro_account_obj_id,
            account_name_override=account_name,
            details={
                "account_name_created": account_name,
                "linked_to_user_id": str(user_oid),
                "migrated_personal_documents_count": migrated_doc_count
            }
        )
        return {
            "message": "User successfully upgraded to Pro and personal documents migrated.",
            "accountId": new_pro_account_id_str,
            "migrated_documents_count": migrated_doc_count
        }
    except Exception as e:
        logger.exception(f"Error during audit logging for Pro upgrade: {e}")
        return {
            "message": "User successfully upgraded to Pro and documents migrated. Audit logging failed.",
            "accountId": new_pro_account_id_str,
            "migrated_documents_count": migrated_doc_count,
            "warning": "Audit log creation failed post-upgrade."
        }
