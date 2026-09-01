import logging
import re
import uuid
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
from bson import ObjectId
from fastapi import Depends, HTTPException, status, Request, Query
from jose import JWTError, jwt

from core.config import settings
from core.database import (
    collection,
    users_collection,
    teams_collection,
    db,
)
from core.security import (
    AUTH_COOKIE_NAME,
    get_current_active_user,
    get_current_user,
)
from models.domain import UserInDB
from worker.tasks import index_contract_task
from api.routes.projects import verify_project_access, ensure_default_project

logger = logging.getLogger(__name__)

async def deduct_credits(user_id: ObjectId, page_count: int) -> bool:
    """Deduct credits from user's account if available"""
    from core.database import async_db
    accounts_col = async_db["accounts"]
    
    result = await accounts_col.update_one(
        {"user_id": user_id, "page_credits": {"$gte": page_count}},
        {"$inc": {"page_credits": -page_count}, "$set": {"updated_at": datetime.utcnow()}}
    )
    
    if result.modified_count > 0:
        logger.info(f"Successfully deducted {page_count} credits from user {user_id}")
        return True
        
    logger.warning(f"Failed to deduct {page_count} credits from user {user_id}: Insufficient credits or account not found")
    return False

def queue_contract_ingestion(
    *,
    contract_id: str,
    contract_oid: ObjectId,
    file_id: ObjectId,
    file_name: str,
    user_id: str,
) -> Optional[str]:
    collection.update_one(
        {"_id": contract_oid},
        {"$set": {
            "index.status": "processing",
            "index.started_at": datetime.utcnow(),
            "index.error": "",
            "status": "Processing",
        }}
    )
    try:
        task = index_contract_task.delay(
            contract_id=contract_id,
            contract_oid_str=str(contract_oid),
            file_id_str=str(file_id),
            file_name=file_name,
            user_id=user_id,
        )
        return task.id if hasattr(task, "id") else None
    except Exception as e:
        logger.warning("Failed to queue contract ingestion task for %s (broker may be unavailable): %s", contract_id, e)
        # Mark as queued so the retry mechanism can pick it up
        collection.update_one(
            {"_id": contract_oid},
            {"$set": {
                "index.status": "queued",
                "index.queued_at": datetime.utcnow(),
                "index.retry_count": 0,
                "index.error": "Ingestion queued — will resume when the processing service is available.",
                "status": "Queued",
            }}
        )
        return None

def check_contract_access(contract_doc: Optional[Dict[str, Any]], current_user: UserInDB):
    """
    Checks if the user has access to the given contract document based on ownerType/ownerId.
    Raises HTTPException (404 or 403) if access is denied or contract not found.
    """
    if not contract_doc:
        logger.warning(f"Access check failed: Contract document is None (User: {current_user.id}).")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")

    contract_id = contract_doc.get("_id", "Unknown ID")
    owner_type = contract_doc.get("ownerType")
    owner_id = contract_doc.get("ownerId") 

    if not owner_type or not owner_id:
        logger.error(f"Contract {contract_id} is missing ownerType ('{owner_type}') or ownerId ('{owner_id}'). Access denied.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Contract ownership data invalid or missing.")

    user_oid = ObjectId(current_user.id)
    owner_id_str = str(owner_id) if owner_id is not None else None

    if owner_type == "user":
        if owner_id != user_oid and owner_id_str != current_user.id:
            logger.warning(f"Access denied: User {current_user.id} attempting to access user-owned contract {contract_id} owned by {owner_id}.")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to access this contract.")
    elif owner_type == "team":
        user_team_ids = current_user.teamIds if current_user.teamIds else []
        is_owner = current_user.ownedAccountId == owner_id_str
        is_member = owner_id_str in user_team_ids
        direct_membership = False
        if not is_owner and not is_member and teams_collection is not None and isinstance(owner_id, ObjectId):
            direct_membership = bool(teams_collection.find_one(
                {"_id": owner_id, "members.userId": user_oid},
                {"_id": 1}
            ))
        if not (is_owner or is_member or direct_membership):
            logger.warning(f"Access denied: User {current_user.id} attempting to access team-owned contract {contract_id} owned by team {owner_id}. User is not a member of this team.")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to access this contract (not a team member).")
    else:
        logger.error(f"Contract {contract_id} has an invalid ownerType: '{owner_type}'. Access denied.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Invalid contract ownership type found.")

def get_contract_and_verify_access(
    contract_id: str,
    current_user: UserInDB,
    projection: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, projection)
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found.")

    check_contract_access(contract, current_user)
    return contract

def get_project_and_verify_access(
    project_id: str,
    current_user: UserInDB,
) -> Dict[str, Any]:
    return verify_project_access(project_id, current_user)

async def get_current_user_from_ticket_or_session(
    request: Request,
    ticket: Optional[str] = Query(None),
) -> UserInDB:
    if ticket:
        try:
            payload = jwt.decode(ticket, settings.secret_key, algorithms=[settings.algorithm])
            if not payload.get("ticket"):
                raise HTTPException(status_code=401, detail="Invalid ticket.")
            
            user_id = payload.get("sub")
            if not user_id:
                raise HTTPException(status_code=401, detail="Invalid ticket subject.")
            
            try:
                user_oid = ObjectId(user_id)
            except Exception:
                raise HTTPException(status_code=401, detail="Invalid user ID in ticket.")
                
            user_data = users_collection.find_one({"_id": user_oid})
            if not user_data:
                raise HTTPException(status_code=401, detail="User not found.")
            
            data_for_pydantic = user_data.copy()
            data_for_pydantic["_id"] = str(data_for_pydantic["_id"])
            if "teamIds" not in data_for_pydantic or data_for_pydantic["teamIds"] is None:
                data_for_pydantic["teamIds"] = []
            if "system_role" not in data_for_pydantic:
                data_for_pydantic["system_role"] = "user"
                
            user = UserInDB.model_validate(data_for_pydantic)
            if user.disabled:
                raise HTTPException(status_code=400, detail="Inactive user account.")
            
            return user
        except JWTError:
            raise HTTPException(status_code=401, detail="Download ticket expired or invalid.")
            
    return get_current_active_user(get_current_user(request, token=None))