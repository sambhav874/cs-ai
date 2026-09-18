#audit_routes.py

import logging
from fastapi import APIRouter, Depends, Query, HTTPException, status, Request
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field, ValidationError
from datetime import datetime, timezone, timedelta
from bson import ObjectId 
try:
    from core.security import get_current_active_user, UserInDB 
except ImportError:
    UserInDB = Any 
    def get_current_active_user(): raise NotImplementedError("get_current_active_user not imported")

logger = logging.getLogger(__name__) 

audit_router = APIRouter(
    prefix="/audit", 
    tags=["Audit Logs & Analytics"],
    dependencies=[Depends(get_current_active_user)]
)


class AuditLogDetailField(BaseModel):
    class Config:
        extra = "allow" 

class AuditLogEntryResponse(BaseModel):
    id: str = Field(..., alias="_id", description="The unique ID of the audit log entry.")
    timestamp: datetime = Field(..., description="Timestamp of when the action occurred (UTC).")
    userId: Optional[str] = Field(None, description="ID of the user who performed the action.")
    username: Optional[str] = Field(None, description="Username of the user.")
    action: str = Field(..., description="Description of the action performed.")
    contractId: Optional[str] = Field(None, description="ID of the contract involved, if any.")
    contractName: Optional[str] = Field(None, description="Name of the contract involved, if any.")
    accountId: Optional[str] = Field(None, description="ID of the account/team context, if any.")
    accountName: Optional[str] = Field(None, description="Name of the account/team, if any.")
    details: Dict[str, Any] = Field(default_factory=dict, description="Additional context-specific information about the action.")

    class Config:
        populate_by_name = True 
        json_encoders = {
            ObjectId: str 
        }

class PaginationDetails(BaseModel):
    total_items: int
    total_pages: int
    current_page: int
    per_page: int

class PaginatedAuditLogsResponse(BaseModel):
    logs: List[AuditLogEntryResponse]
    pagination: PaginationDetails

#Pydantic modles for analytics API Responses 

#interface for chart on analytics/page.tsx:
class DailyUsageDataPoint(BaseModel):
    date_label: str
    credits_used: int

class TeamAnalyticsSummaryResponse(BaseModel):
    team_id: str
    team_name: Optional[str] = None
    remaining_credits: int
    used_credits_in_period: int
    time_filter: str 
    period_start_date: datetime
    period_end_date: datetime
    daily_usage_trend_30_days: List[DailyUsageDataPoint] = Field(default_factory=list, description="Daily usage trend for the last 30 days.")

class MemberCreditUsage(BaseModel):
    member_id: str
    member_name: Optional[str] = None
    credits_used: int

class TeamMemberUsageResponse(BaseModel):
    team_id: str
    team_name: Optional[str] = None
    member_usage: List[MemberCreditUsage]
    time_filter: str
    period_start_date: datetime
    period_end_date: datetime

class DetailedCreditLogEntry(BaseModel):
    timestamp: datetime
    credits_deducted: int
    service_description: Optional[str] = None
    contract_id: Optional[str] = None
    contract_name: Optional[str] = None
    # Add other relevant fields from the 'PROCESSING_CREDITS_DEDUCTED' details

class DetailedMemberLogResponse(BaseModel):
    team_id: str
    team_name: Optional[str] = None
    member_id: str
    member_name: Optional[str] = None
    detailed_logs: List[DetailedCreditLogEntry]
    time_filter: str
    period_start_date: datetime
    period_end_date: datetime
    pagination: PaginationDetails


#Helper Functions
def convert_objectids_to_strings_recursive(data: Any) -> Any:
    if isinstance(data, list):
        return [convert_objectids_to_strings_recursive(item) for item in data]
    elif isinstance(data, dict):
        return {
            key: convert_objectids_to_strings_recursive(value)
            for key, value in data.items()
        }
    elif isinstance(data, ObjectId):
        return str(data)
    return data

def convert_to_str(value: Any) -> Optional[str]:
    if value is None: return None
    if isinstance(value, ObjectId): return str(value)
    if isinstance(value, str): return value # Allow strings to pass
    return str(value)


async def require_system_audit_access(
    current_user: UserInDB = Depends(get_current_active_user),
) -> UserInDB:
    if getattr(current_user, "system_role", "user") not in {"admin", "auditor"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator or auditor access required.",
        )
    return current_user


def get_time_range(time_filter: str) -> tuple[datetime, datetime]: # New helper
    now_utc = datetime.now(timezone.utc)
    # For "past N days", end_date is now. start_date is N days ago.
    # The query should be timestamp >= start_date AND timestamp < end_date (or <= now_utc if end_date is exactly now)
    # To make it inclusive of "today" if filter is "day", end_date might need to be end of current day.
    # For simplicity, "last 24 hours", "last 7*24 hours", etc.
    end_date = now_utc 
    if time_filter.lower() == "day":
        start_date = now_utc - timedelta(days=1)
    elif time_filter.lower() == "week":
        start_date = now_utc - timedelta(weeks=1)
    elif time_filter.lower() == "month":
        start_date = now_utc - timedelta(days=30) # Approx. a month
    else:
        logger.warning(f"Invalid time_filter '{time_filter}' in get_time_range. Defaulting to 'week'.")
        start_date = now_utc - timedelta(weeks=1) # Default to week
    return start_date, end_date

# --- Dependency for Specific Team Admin Authorization ---
async def get_current_team_admin_user( 
    team_id: str, # This will be taken from the path parameter of the endpoint
    request: Request, # To access app.state for teams_collection
    current_user: UserInDB = Depends(get_current_active_user) # Ensures user is active
) -> tuple[ObjectId, Optional[str]]: # Returns (team_oid, team_name) if authorized
    """
    Checks if the current_user is an admin of the specified team_id OR owns the account.
    """
    current_teams_collection = None
    try:
        current_teams_collection = request.app.state.teams_collection
    except AttributeError:
        logger.error("get_current_team_admin_user: teams_collection not found on app.state.")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Team service (app.state) configuration error for authorization.")
    
    if current_teams_collection is None: # If it was set to None on app.state
        logger.error("get_current_team_admin_user: teams_collection on app.state is None.")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Team service unavailable for authorization.")

    if not ObjectId.is_valid(team_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Team ID format provided.")
    
    team_oid = ObjectId(team_id)
    user_oid_for_check = ObjectId(current_user.id) # current_user.id is string

    # Check 1: Is the current_user the owner of this account/team?
    # current_user.ownedAccountId is string, team_id is string path param
    if current_user.ownedAccountId == team_id:
        logger.debug(f"User {current_user.id} is owner of account/team {team_id}. Analytics access for team granted.")
        team_doc_for_name = current_teams_collection.find_one({"_id": team_oid}, {"name": 1})
        team_name = team_doc_for_name.get("name") if team_doc_for_name else f"Team {team_id}" # Fallback name
        return team_oid, team_name

    # Check 2: Is the current_user listed as an 'admin' in this team's members array?
    # teams_collection is synchronous PyMongo collection
    team_doc = current_teams_collection.find_one(
        {"_id": team_oid, "members": {"$elemMatch": {"userId": user_oid_for_check, "team_role": "admin"}}},
        {"name": 1} # Fetch name as well
    )
    if not team_doc:
        logger.warning(f"User {current_user.id} is not an admin of team {team_id}. Access to this team's analytics denied.")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have admin privileges for this specific team's analytics dashboard.")
    
    return team_oid, team_doc.get("name")

async def get_current_team_admin_for_logs( 
    team_id: str, # From path parameter of the new endpoint
    request: Request, # To access app.state for teams_collection
    current_user: UserInDB = Depends(get_current_active_user) # Ensures user is active
) -> tuple[ObjectId, Optional[str]]: # Returns (team_oid, team_name) if authorized
    """
    Checks if the current_user is an admin of the specified team_id OR owns the account.
    This is for accessing resources specific to a team, like its audit logs or analytics.
    """
    current_teams_collection = None
    try:
        current_teams_collection = request.app.state.teams_collection
    except AttributeError:
        logger.error("get_current_team_admin_for_logs: teams_collection not found on app.state.")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Team service (app.state) configuration error.")
    
    if current_teams_collection is None:
        logger.error("get_current_team_admin_for_logs: teams_collection on app.state is None.")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Team service unavailable for authorization.")

    if not ObjectId.is_valid(team_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Team ID format provided.")
    
    team_oid = ObjectId(team_id)
    user_oid_for_check = ObjectId(current_user.id) # current_user.id is string from UserInDB

    # Check 1: Is the current_user the owner of this account/team?
    # current_user.ownedAccountId is a string (ObjectIdStr)
    if current_user.ownedAccountId == team_id: # Compare string team_id from path with string ownedAccountId
        logger.debug(f"User {current_user.id} is owner of account/team {team_id}. Access for team logs granted.")
        team_doc_for_name = current_teams_collection.find_one({"_id": team_oid}, {"name": 1})
        team_name = team_doc_for_name.get("name") if team_doc_for_name else f"Team {team_id}"
        return team_oid, team_name

    # Check 2: Is the current_user listed as an 'admin' in this team's members array?
    # teams_collection stores members.userId as ObjectId or string based on your TeamMember model (ObjectIdStr)
    # We should query with ObjectId if members.userId is stored as ObjectId
    team_doc = current_teams_collection.find_one(
        {"_id": team_oid, "members": {"$elemMatch": {"userId": user_oid_for_check, "team_role": "admin"}}},
        {"name": 1} 
    )
    if not team_doc:
        # Fallback: check if members.userId was stored as string in DB
        team_doc = current_teams_collection.find_one(
            {"_id": team_oid, "members": {"$elemMatch": {"userId": current_user.id, "team_role": "admin"}}},
            {"name": 1}
        )
        if not team_doc:
            logger.warning(f"User {current_user.id} is not an admin of team {team_id}. Access to this team's audit logs denied.")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have admin privileges for this team's audit logs.")
    
    return team_oid, team_doc.get("name")


@audit_router.get("/logs/", response_model=PaginatedAuditLogsResponse)
async def get_audit_logs(
    request: Request, 
    current_user: UserInDB = Depends(require_system_audit_access),
    page: int = Query(1, ge=1, description="Page number to retrieve."),
    per_page: int = Query(20, ge=1, le=100, description="Number of log entries per page."),
    action_filter: Optional[str] = Query(None, alias="action", description="Filter by action type (e.g., CONTRACT_APPROVED)."),
    user_id_filter: Optional[str] = Query(None, alias="userId", description="Filter by User ID (who performed the action)."),
    contract_id_filter: Optional[str] = Query(None, alias="contractId", description="Filter by Contract ID."),
    # NEW: Filter for logs related to a specific accountId (teamId)
    account_id_filter: Optional[str] = Query(None, alias="accountId", description="Filter by Account/Team ID logs are associated with."),
    sort_by: str = Query("timestamp", description="Field to sort by (currently only 'timestamp' supported)."),
    sort_order: str = Query("desc", description="Sort order ('asc' or 'desc')."),
):
    """
    Retrieves a paginated list of audit logs with filtering capabilities.
    """
    # Log all filters including new accountId
    logger.info(
        "AUDIT_ROUTES: /logs/ endpoint called by system audit user %s. "
        "Filters: action='%s', userId='%s', contractId='%s', accountId='%s'",
        current_user.id,
        action_filter,
        user_id_filter,
        contract_id_filter,
        account_id_filter,
    )

    # Robust state access with error handling
    try:
        current_audit_logs_collection = request.app.state.audit_logs_collection
        if current_audit_logs_collection is None:
            logger.error("AUDIT_ROUTES_ERROR: audit_logs_collection is None on app.state")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Audit log service unavailable (collection not initialized)"
            )
    except AttributeError:
        logger.error("AUDIT_ROUTES_ERROR_ATTR: audit_logs_collection NOT FOUND on app.state")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Audit log service configuration error"
        )
    except Exception as e_access_state:
        logger.error(f"AUDIT_ROUTES_ERROR_ACCESS_STATE: Unexpected error accessing app.state: {e_access_state}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal error accessing audit service"
        )

    # Build query filters with validation and warnings
    query_filter_dict: Dict[str, Any] = {}
    
    if action_filter:
        query_filter_dict["action"] = action_filter
        
    if user_id_filter:
        if ObjectId.is_valid(user_id_filter):
            query_filter_dict["userId"] = ObjectId(user_id_filter)
        else:
            logger.warning(f"Invalid ObjectId format for userId filter: {user_id_filter}. Filter skipped.")
            
    if contract_id_filter:
        if ObjectId.is_valid(contract_id_filter):
            query_filter_dict["contractId"] = ObjectId(contract_id_filter)
        else:
            logger.warning(f"Invalid ObjectId format for contractId filter: {contract_id_filter}. Filter skipped.")
            
    # NEW: Account ID filter
    if account_id_filter:
        if ObjectId.is_valid(account_id_filter):
            query_filter_dict["accountId"] = ObjectId(account_id_filter)
        else:
            logger.warning(f"Invalid ObjectId format for accountId filter: {account_id_filter}. Filter skipped.")

    # Sorting configuration
    sort_field_mongo = "timestamp"
    if sort_by.lower() != "timestamp": 
        logger.warning(f"Unsupported sort_by field '{sort_by}'. Defaulting to 'timestamp'.")
    sort_direction_mongo = -1 if sort_order.lower() == "desc" else 1

    try:
        # Pagination and database operations
        skip = (page - 1) * per_page
        total_logs = current_audit_logs_collection.count_documents(query_filter_dict)
        logger.info(f"AUDIT_ROUTES_DB_OP: Found {total_logs} logs matching filters")
        
        cursor = current_audit_logs_collection.find(query_filter_dict) \
            .sort(sort_field_mongo, sort_direction_mongo) \
            .skip(skip) \
            .limit(per_page)
            
        logs_from_db = list(cursor)
        logger.info(f"AUDIT_ROUTES_DB_OP: Retrieved {len(logs_from_db)} logs for page {page}")

        # Process and validate log entries
        processed_logs: List[AuditLogEntryResponse] = []
        for log_doc_from_db in logs_from_db:
            # Prepare data with proper ID conversions
            log_data = {
                "_id": str(log_doc_from_db["_id"]),
                "timestamp": log_doc_from_db["timestamp"],
                "userId": str(log_doc_from_db.get("userId")) if isinstance(log_doc_from_db.get("userId"), ObjectId) else log_doc_from_db.get("userId"),
                "username": log_doc_from_db.get("username"),
                "action": log_doc_from_db["action"],
                "contractId": str(log_doc_from_db.get("contractId")) if isinstance(log_doc_from_db.get("contractId"), ObjectId) else log_doc_from_db.get("contractId"),
                "contractName": log_doc_from_db.get("contractName"),
                "accountId": str(log_doc_from_db.get("accountId")) if isinstance(log_doc_from_db.get("accountId"), ObjectId) else log_doc_from_db.get("accountId"),
                "accountName": log_doc_from_db.get("accountName"),
                "details": convert_objectids_to_strings_recursive(log_doc_from_db.get("details", {}))
            }
            
            # Convert string 'None' to actual None
            for id_field in ["userId", "contractId", "accountId"]:
                if log_data.get(id_field) == 'None':
                    log_data[id_field] = None

            # Validate with Pydantic
            try:
                processed_logs.append(AuditLogEntryResponse.model_validate(log_data))
            except Exception as e_val:
                logger.error(f"Validation error for log {log_data.get('_id')}: {e_val}")
                # SECURITY: Only emit raw document data at DEBUG level when explicitly enabled.
                # Raw log_data may contain PII (usernames, contract names, etc.).
                if logger.isEnabledFor(logging.DEBUG):
                    logger.debug("Problematic log data (debug mode only): %s", log_data.get("_id"))

        # Calculate pagination details
        total_pages = (total_logs + per_page - 1) // per_page if per_page > 0 else 0
        
        return PaginatedAuditLogsResponse(
            logs=processed_logs,
            pagination=PaginationDetails(
                total_items=total_logs,
                total_pages=total_pages,
                current_page=page,
                per_page=per_page
            )
        )

    except Exception as e:
        logger.exception(f"Critical error during log processing: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve audit logs"
        )
    

@audit_router.get(
    "/teams/{team_id}/logs",
    response_model=PaginatedAuditLogsResponse,
)
async def get_account_specific_audit_logs(
    request: Request, 
    team_auth_data: tuple[ObjectId, Optional[str]] = Depends(get_current_team_admin_for_logs), 
    page: int = Query(1, ge=1, description="Page number to retrieve."),
    per_page: int = Query(20, ge=1, le=100, description="Number of log entries per page."),
    action_filter: Optional[str] = Query(None, alias="action", description="Filter by action type (case-insensitive)."),
    user_filter: Optional[str] = Query(None, alias="user", description="Filter by User ID or Username (case-insensitive)."), # Renamed for clarity
    target_filter: Optional[str] = Query(None, alias="target", description="Filter by Contract ID or Name (case-insensitive)."), # Renamed for clarity
    start_date: Optional[datetime] = Query(None, description="Filter logs from this date (YYYY-MM-DD)"),
    end_date: Optional[datetime] = Query(None, description="Filter logs up to this date (YYYY-MM-DD)"),
    sort_by: str = Query("timestamp", description="Field to sort by (currently 'timestamp')."),
    sort_order: str = Query("desc", description="Sort order ('asc' or 'desc')."),
):
    team_oid, team_name = team_auth_data
    logger.info(
        f"Account-specific audit log request for team: {team_name} ({str(team_oid)}), User: {request.state.current_user.username if hasattr(request.state, 'current_user') else 'N/A'}, "
        f"Filters: action='{action_filter}', user='{user_filter}', target='{target_filter}', "
        f"date_range='{start_date} to {end_date}'"
    )

    try:
        current_audit_logs_collection = request.app.state.audit_logs_collection
        if current_audit_logs_collection is None:
            raise AttributeError("audit_logs_collection is None on app.state")
    except AttributeError:
        logger.exception("Audit collection not properly configured on app.state for account-specific logs.")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Audit log service configuration error.")

    query_filter_dict: Dict[str, Any] = {"accountId": team_oid}

    if action_filter:
        query_filter_dict["action"] = {"$regex": action_filter, "$options": "i"} # Case-insensitive
        
    if user_filter:
        if ObjectId.is_valid(user_filter):
            query_filter_dict["userId"] = ObjectId(user_filter)
        else:
            # Assume it's a username search if not a valid ObjectId
            query_filter_dict["username"] = {"$regex": user_filter, "$options": "i"}
            
    if target_filter: # Can be contract ID or contract name
        if ObjectId.is_valid(target_filter):
            query_filter_dict["contractId"] = ObjectId(target_filter)
        else:
            query_filter_dict["contractName"] = {"$regex": target_filter, "$options": "i"}

    timestamp_conditions: Dict[str, datetime] = {}
    if start_date:
        timestamp_conditions["$gte"] = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc) # Start of day UTC
    if end_date:
        # End of the selected day UTC
        timestamp_conditions["$lt"] = datetime.combine(end_date, datetime.max.time(), tzinfo=timezone.utc).replace(microsecond=0) + timedelta(microseconds=1)
        # Or simply: timestamp_conditions["$lt"] = end_date + timedelta(days=1)

    if timestamp_conditions:
        query_filter_dict["timestamp"] = timestamp_conditions

    sort_direction_mongo = -1 if sort_order.lower() == "desc" else 1
    # For now, only supporting sort by timestamp. Add mapping if more fields needed.
    sort_field_mongo = "timestamp" 
    if sort_by.lower() != "timestamp": 
        logger.warning(f"Unsupported sort field: '{sort_by}'. Defaulting to 'timestamp' for account-specific logs.")

    try:
        skip = (page - 1) * per_page
        total_logs = current_audit_logs_collection.count_documents(query_filter_dict)
        
        cursor = current_audit_logs_collection.find(query_filter_dict) \
            .sort(sort_field_mongo, sort_direction_mongo) \
            .skip(skip) \
            .limit(per_page)
            
        logs_from_db = list(cursor)
        processed_logs: List[AuditLogEntryResponse] = []
        
        for log_doc in logs_from_db: # Renamed from log_doc_from_db for consistency
            # Prepare data for Pydantic model carefully
            log_data_for_pydantic = {
                "_id": str(log_doc["_id"]),
                "timestamp": log_doc["timestamp"],
                "userId": convert_to_str(log_doc.get("userId")),
                "username": log_doc.get("username"),
                "action": log_doc["action"],
                "contractId": convert_to_str(log_doc.get("contractId")),
                "contractName": log_doc.get("contractName"),
                "accountId": convert_to_str(log_doc.get("accountId")), # Should always be team_oid here
                "accountName": log_doc.get("accountName"), # Should be team_name here
                "details": convert_objectids_to_strings_recursive(log_doc.get("details", {}))
            }
            
            try:
                processed_logs.append(AuditLogEntryResponse.model_validate(log_data_for_pydantic))
            except ValidationError as e_val:
                logger.error(f"Pydantic validation error for account log entry ID {log_data_for_pydantic.get('_id')}: {e_val}. Raw log_doc: {log_doc}")
                logger.debug(f"Data passed to Pydantic for account log: {log_data_for_pydantic}")
                continue # Skip problematic logs

        total_pages = (total_logs + per_page - 1) // per_page if per_page > 0 else 0
        
        return PaginatedAuditLogsResponse(
            logs=processed_logs,
            pagination=PaginationDetails(
                total_items=total_logs, total_pages=total_pages,
                current_page=page, per_page=per_page
            )
        )

    except Exception as e:
        logger.exception(f"Database error retrieving account-specific logs for team {team_oid}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error retrieving audit logs for account.")

# Helper function for ID conversion
def convert_to_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, ObjectId):
        return str(value)
    return value
    

@audit_router.get(
    "/analytics/teams/{team_id}/summary", 
    response_model=TeamAnalyticsSummaryResponse,
)
async def get_team_analytics_summary(
    request: Request, 
    team_auth_data: tuple[ObjectId, Optional[str]] = Depends(get_current_team_admin_user), 
    time_filter: str = Query("week", enum=["day", "week", "month"], description="Time period for CARD summary: 'day', 'week', 'month'."),
):
    team_oid, team_name = team_auth_data
    logger.info(
        f"Analytics summary request for team_id: {str(team_oid)} (Name: {team_name}), "
        f"card_time_filter: {time_filter}, by user: {request.state.current_user.username if hasattr(request.state, 'current_user') else 'Unknown'}"
    )

    current_audit_logs_collection = None
    current_accounts_collection = None
    current_teams_collection = None
    try:
        current_audit_logs_collection = request.app.state.audit_logs_collection
        current_accounts_collection = request.app.state.accounts_collection
        current_teams_collection = request.app.state.teams_collection
    except AttributeError as e:
        logger.error(f"Analytics summary: A required collection not found on app.state: {e}")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Analytics data service (app.state) configuration error.")

    collections_are_valid = all([
        current_audit_logs_collection is not None,
        current_accounts_collection is not None,
        current_teams_collection is not None
    ])
    if not collections_are_valid:
         raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="A required data service for analytics is unavailable (collection is None on app.state).")
    
    # 1. Get Team Creator ID (for remaining credits)
    team_doc_for_creator = current_teams_collection.find_one({"_id": team_oid}, {"creatorId": 1})
    if not team_doc_for_creator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team details for creator lookup not found.")
    team_creator_oid = team_doc_for_creator.get("creatorId")
    if not isinstance(team_creator_oid, ObjectId):
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Team configuration error (invalid creatorId).")

    # 2. Get Remaining Credits
    account_balance_doc = current_accounts_collection.find_one({"user_id": team_creator_oid}, {"page_credits": 1})
    remaining_credits = account_balance_doc.get("page_credits", 0) if account_balance_doc else 0

    # 3. Calculate Used Credits for the time_filter (for the summary card)
    card_period_start_date, card_period_end_date = get_time_range(time_filter)
    card_usage_pipeline = [
        {"$match": {
            "action": "PROCESSING_CREDITS_DEDUCTED",
            "accountId": team_oid,
            "timestamp": {"$gte": card_period_start_date, "$lt": card_period_end_date}
        }},
        {"$group": {"_id": None, "total_credits_used": {"$sum": "$details.credits_deducted"}}}
    ]
    try:
        card_usage_aggregation_result = list(current_audit_logs_collection.aggregate(card_usage_pipeline))
        used_credits_in_card_period = card_usage_aggregation_result[0]["total_credits_used"] if card_usage_aggregation_result and "total_credits_used" in card_usage_aggregation_result[0] else 0
    except Exception as agg_e:
        logger.exception(f"Error during card credit usage aggregation for team {team_oid}: {agg_e}")
        raise HTTPException(status_code=500, detail="Failed to calculate period credit usage.")

    # --- 4. Calculate Daily Usage Trend for the Last 30 Days (for the line chart) ---
    now_utc = datetime.now(timezone.utc)
    trend_end_date = now_utc 
    trend_start_date = now_utc - timedelta(days=30) # Last 30 days from now

    logger.info(f"DEBUG_TREND: Trend Start Date (UTC): {trend_start_date.isoformat()}")
    logger.info(f"DEBUG_TREND: Trend End Date (UTC) for query ($lt): {trend_end_date.isoformat()}")

    daily_trend_pipeline = [
        {
            "$match": {
                "action": "PROCESSING_CREDITS_DEDUCTED",
                "accountId": team_oid,
                "timestamp": {"$gte": trend_start_date, "$lt": trend_end_date} 
            }
        },
        {
            "$group": {
                "_id": { # Group by year, month, day
                    "year": {"$year": "$timestamp"},
                    "month": {"$month": "$timestamp"},
                    "day": {"$dayOfMonth": "$timestamp"}
                },
                "daily_total_used": {"$sum": "$details.credits_deducted"}
            }
        },
        { # Project to a more usable date format and sort
            "$project": {
                "_id": 0,
                "date_str": {
                    "$dateToString": {
                        "format": "%Y-%m-%d", # Standard date string
                        "date": {"$dateFromParts": {"year": "$_id.year", "month": "$_id.month", "day": "$_id.day"}}
                    }
                },
                "credits_used": "$daily_total_used"
            }
        },
        {"$sort": {"date_str": 1}} # Sort by date ascending
    ]
    
    daily_usage_trend_data: List[DailyUsageDataPoint] = []
    try:
        aggregated_daily_usage = list(current_audit_logs_collection.aggregate(daily_trend_pipeline))

        logger.info(f"DEBUG_TREND: Aggregated daily usage raw output (last 30 days): {aggregated_daily_usage}") # LOG 1
        
        # Create a map of usage per day from aggregation results
        usage_by_date_map: Dict[str, int] = {
            item["date_str"]: item["credits_used"] for item in aggregated_daily_usage
        }

        logger.info(f"DEBUG_TREND: Usage by date map for trend: {usage_by_date_map}") # LOG 2

        # Fill in gaps for the last 30 days
        for i in range(30):
            day_to_check = trend_start_date + timedelta(days=i)
            # To handle the edge case where trend_start_date + 30 days might be slightly off from now_utc due to timedelta calculation at start of day
            # we should iterate up to today. Or simply iterate from trend_start_date to trend_end_date (day by day).
            # Let's iterate based on the number of days in the period.
            
            # If `day_to_check` is the start of the day, we want to format it as YYYY-MM-DD
            # but the aggregation uses UTC parts. For simplicity, let's iterate the number of days.
            # A more robust way would be to iterate from trend_start_date to trend_end_date day by day.
            
            # Simpler: Iterate 30 days back from "today" (trend_end_date)
            current_day_in_loop = trend_end_date - timedelta(days=29 - i) # Starts from 30 days ago up to today
            date_label_str = current_day_in_loop.strftime("%Y-%m-%d")
            
            credits_for_this_day = usage_by_date_map.get(date_label_str, 0) # Default to 0 if no usage
            
            daily_usage_trend_data.append(
                DailyUsageDataPoint(
                    date_label=date_label_str, # Or format as "Mon, Jun 10" if preferred by chart
                    credits_used=credits_for_this_day
                )
            )
        # Ensure the list is sorted by date if the loop order wasn't guaranteed (though it should be here)
        daily_usage_trend_data.sort(key=lambda x: x.date_label)

    except Exception as trend_agg_e:
        logger.exception(f"Error during daily usage trend aggregation for team {team_oid}: {trend_agg_e}")
        # Don't fail the whole request, just return empty trend data
        daily_usage_trend_data = []
    # --- END Daily Usage Trend Calculation ---
        
    return TeamAnalyticsSummaryResponse(
        team_id=str(team_oid), 
        team_name=team_name,
        remaining_credits=remaining_credits, 
        used_credits_in_period=used_credits_in_card_period, # For the D/W/M filter
        time_filter=time_filter, 
        period_start_date=card_period_start_date, # For the D/W/M filter
        period_end_date=card_period_end_date,     # For the D/W/M filter
        daily_usage_trend_30_days=daily_usage_trend_data # NEW field
    )

@audit_router.get(
    "/analytics/teams/{team_id}/member-usage",
    response_model=TeamMemberUsageResponse,
)
async def get_team_member_credit_usage(
    request: Request,
    team_auth_data: tuple[ObjectId, Optional[str]] = Depends(get_current_team_admin_user),
    time_filter: str = Query("week", enum=["day", "week", "month"], description="Time period for usage: 'day', 'week', 'month'."),
):
    team_oid, team_name = team_auth_data
    logger.info(
        f"Analytics member usage request for team_id: {str(team_oid)} (Name: {team_name}), "
        f"filter: {time_filter}, by user: {request.state.current_user.username if hasattr(request.state, 'current_user') else 'Unknown'}"
    )

    current_audit_logs_collection = None
    current_users_collection = None
    try:
        current_audit_logs_collection = request.app.state.audit_logs_collection
        current_users_collection = request.app.state.users_collection 
    except AttributeError as e:
        logger.error(f"Per-member usage: A required collection not found on app.state: {e}")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Analytics data service (app.state) configuration error.")

    # --- CORRECTED CHECK HERE ---
    collections_are_valid = all([
        current_audit_logs_collection is not None,
        current_users_collection is not None
    ])

    if not collections_are_valid:
         logger.error(
             f"Per-member usage: One or more required collections are None after app.state access. "
             f"Audit valid: {current_audit_logs_collection is not None}, "
             f"Users valid: {current_users_collection is not None}"
         )
         raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="A required data service for member usage analytics is unavailable (collection is None).")
    # --- END CORRECTION ---

    start_date, end_date = get_time_range(time_filter)

    pipeline = [
        {
            "$match": {
                "action": "PROCESSING_CREDITS_DEDUCTED",
                "accountId": team_oid, 
                "timestamp": {"$gte": start_date, "$lt": end_date},
                "userId": {"$ne": None} 
            }
        },
        {
            "$group": {
                "_id": "$userId", 
                "total_credits_used_by_member": {"$sum": "$details.credits_deducted"}
            }
        },
        {"$sort": {"total_credits_used_by_member": -1}}
    ]

    try:
        member_usage_aggregation = list(current_audit_logs_collection.aggregate(pipeline))
    except Exception as agg_e:
        # ... (error handling for aggregation) ...
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to calculate member credit usage.")

    member_usage_list: List[MemberCreditUsage] = []
    if member_usage_aggregation:
        member_ids = [item["_id"] for item in member_usage_aggregation if isinstance(item.get("_id"), ObjectId)]
        
        user_name_map: Dict[ObjectId, str] = {}
        if member_ids:
            users_cursor = current_users_collection.find( # Use the validated current_users_collection
                {"_id": {"$in": member_ids}},
                {"username": 1}
            )
            for user_doc in users_cursor:
                user_name_map[user_doc["_id"]] = user_doc.get("username", "Unknown User")
        
        for item in member_usage_aggregation:
            member_id_obj = item.get("_id")
            if not isinstance(member_id_obj, ObjectId):
                continue
            member_usage_list.append(
                MemberCreditUsage(
                    member_id=str(member_id_obj),
                    member_name=user_name_map.get(member_id_obj),
                    credits_used=item.get("total_credits_used_by_member", 0)
                )
            )
            
    return TeamMemberUsageResponse(
        team_id=str(team_oid),
        team_name=team_name,
        member_usage=member_usage_list,
        time_filter=time_filter,
        period_start_date=start_date,
        period_end_date=end_date
    )

@audit_router.get(
    "/analytics/teams/{team_id}/member-log/{member_id}", 
    response_model=DetailedMemberLogResponse,
)
async def get_detailed_member_credit_log(
    request: Request,
    member_id: str, 
    team_auth_data: tuple[ObjectId, Optional[str]] = Depends(get_current_team_admin_user),
    time_filter: str = Query("week", enum=["day", "week", "month"]),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    team_oid, team_name = team_auth_data
    
    if not ObjectId.is_valid(member_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid member User ID format.")
    member_oid = ObjectId(member_id)

    logger.info(
        f"Detailed member log request for team_id: {str(team_oid)} (Name: {team_name}), "
        f"member_id: {member_id}, filter: {time_filter}, "
        f"by admin: {request.state.current_user.username if hasattr(request.state, 'current_user') else 'Unknown'}"
    )

    current_audit_logs_collection = None
    current_users_collection = None
    try:
        current_audit_logs_collection = request.app.state.audit_logs_collection
        current_users_collection = request.app.state.users_collection 
    except AttributeError as e:
        logger.error(f"Detailed member log: A required collection not found on app.state: {e}")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Analytics data service (app.state) configuration error.")

    # --- CORRECTED CHECK HERE ---
    collections_are_valid = all([
        current_audit_logs_collection is not None,
        current_users_collection is not None
    ])

    if not collections_are_valid:
         logger.error(
             f"Detailed member log: One or more required collections are None after app.state access. "
             f"Audit valid: {current_audit_logs_collection is not None}, "
             f"Users valid: {current_users_collection is not None}"
         )
         raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="A required data service for detailed member log is unavailable (collection is None).")
    # --- END CORRECTION ---

    member_user_doc = current_users_collection.find_one({"_id": member_oid}, {"username": 1})
    member_name = member_user_doc.get("username") if member_user_doc else "Unknown Member"

    start_date, end_date = get_time_range(time_filter)

    query_filter_dict: Dict[str, Any] = {
        "action": "PROCESSING_CREDITS_DEDUCTED",
        "accountId": team_oid,       
        "userId": member_oid,        
        "timestamp": {"$gte": start_date, "$lt": end_date}
    }
    
    try:
        skip = (page - 1) * per_page
        total_logs = current_audit_logs_collection.count_documents(query_filter_dict)
        
        cursor = current_audit_logs_collection.find(query_filter_dict)\
                                      .sort("timestamp", -1)\
                                      .skip(skip)\
                                      .limit(per_page)
        logs_from_db = list(cursor)
        
        detailed_log_entries: List[DetailedCreditLogEntry] = []
        for log_doc in logs_from_db:
            details = log_doc.get("details", {})
            entry = DetailedCreditLogEntry(
                timestamp=log_doc["timestamp"],
                credits_deducted=details.get("credits_deducted", 0),
                service_description=details.get("service_description", "Processing"),
                contract_id=str(log_doc.get("contractId")) if log_doc.get("contractId") else None,
                contract_name=log_doc.get("contractName")
            )
            detailed_log_entries.append(entry)
            
        total_pages = (total_logs + per_page - 1) // per_page if per_page > 0 else 0

        response_data_obj = DetailedMemberLogResponse(
            team_id=str(team_oid),
            team_name=team_name,
            member_id=member_id,
            member_name=member_name,
            detailed_logs=detailed_log_entries,
            time_filter=time_filter,
            period_start_date=start_date,
            period_end_date=end_date,
            pagination=PaginationDetails( # This should always be created
                total_items=total_logs,
                total_pages=total_pages,
                current_page=page,
                per_page=per_page
            )
        )
        
        # --- ADD THIS LOG ---
        logger.info(f"DETAILED_MEMBER_LOG_ENDPOINT: Response object before serialization: {response_data_obj.model_dump_json(indent=2)}")
        # --- END ADD THIS LOG ---
        
        return response_data_obj


    except Exception as e:
        logger.exception(f"Error retrieving detailed member credit log for team {team_oid}, member {member_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to retrieve detailed member credit log.")


