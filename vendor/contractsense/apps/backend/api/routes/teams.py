# team_routes.py

import logging
from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Dict, Optional # Added Dict and Optional for potential future request bodies
from datetime import datetime
from bson import ObjectId
from pydantic import EmailStr, BaseModel # Import EmailStr if needed for add member payload
from pymongo.errors import PyMongoError  # Import PyMongoError for exception handling

# --- Import Models ---
# Use relative imports if files are in the same directory/package
from models.domain import (
    Team,
    TeamInDB,
    TeamMember,
    TeamCreateRequest,
    UserInDB,
    TeamBasicInfo,
    UpdateMemberRoleRequest
)

# --- Import Authentication Dependency ---
from core.security import get_current_active_user

try:
    from core.database import users_collection, teams_collection
except ImportError:
    logging.error("Could not import database collections from core.database.")
    users_collection = None
    teams_collection = None

try:
    from utils.audit_logger import create_audit_log
except ImportError:
    logging.error("Could not import create_audit_log. Audit logging for team actions will be disabled.")
    async def create_audit_log(*args, **kwargs): 
        logging.warning("create_audit_log (dummy) called because import failed.")
        pass 


# --- Initialize Logger ---
# Configure logging elsewhere in your app setup if preferred
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Create FastAPI Router ---
team_sub_router = APIRouter(
    prefix="/teams",  # <<< CHANGED from "/api/teams"
    tags=["Teams"] # We can apply tags when including it
)

# === HELPER MODELS (for Request Bodies if needed) ===

class AddMemberRequest(BaseModel):
    """Request body model for adding a member by email."""
    email: EmailStr # Use Pydantic's EmailStr for validation

# === TEAM ENDPOINTS ===




# --- create_new_team (NO CHANGES) ---
@team_sub_router.post("", response_model=TeamInDB, status_code=status.HTTP_201_CREATED)
async def create_new_team(
    team_payload: TeamCreateRequest,
    current_user: UserInDB = Depends(get_current_active_user)
):
    """
    Creates a new team, making the creator the initial admin.
    Uses globally imported collections.
    """
    if teams_collection is None or users_collection is None:
         if teams_collection is None: logger.error("Database error: 'teams_collection' is None.")
         if users_collection is None: logger.error("Database error: 'users_collection' is None.")
         raise HTTPException(status_code=500, detail="Database connection or collection setup failed.")

    team_name = team_payload.name.strip()
    if not team_name:
        raise HTTPException(status_code=400, detail="Team name cannot be empty.")

    # Convert current_user.id to ObjectId for database operations
    current_user_oid = ObjectId(current_user.id)

    # Prepare Team Member data for Creator
    creator_member = TeamMember(
        userId=str(current_user_oid),
        team_role='admin',
        addedAt=datetime.utcnow(),
        addedBy=str(current_user_oid)
    )

    # Prepare Team Data - use string for creatorId in the Team model
    new_team_data = Team(
        name=team_name,
        creatorId=str(current_user_oid),
        members=[creator_member],
        createdAt=datetime.utcnow(),
        updatedAt=datetime.utcnow()
    )

    # Database Operations
    try:
        # Convert back to ObjectId for MongoDB storage
        team_dict_to_insert = new_team_data.model_dump()
        team_dict_to_insert['creatorId'] = current_user_oid  # Convert back to ObjectId for storage

        # Convert TeamMember userId/addedBy back to ObjectId for storage
        for member in team_dict_to_insert['members']:
            member['userId'] = ObjectId(member['userId'])
            member['addedBy'] = ObjectId(member['addedBy'])

        insert_result = teams_collection.insert_one(team_dict_to_insert)
        new_team_id = insert_result.inserted_id
        logger.info(f"Team '{team_name}' (ID: {new_team_id}) created by User: {current_user.id}")

        # Update the user document to add the new team ID (store as ObjectId)
        # FIXED: Use ObjectId, not string, in the user's teamIds array
        update_result = users_collection.update_one(
            {"_id": current_user_oid},
            {"$addToSet": {"teamIds": new_team_id}}
        )

        if update_result.matched_count == 0:
            logger.error(f"CRITICAL: Failed to find user {current_user.id} to update teamIds after creating team {new_team_id}.")
            try:
                teams_collection.delete_one({"_id": new_team_id})
                logger.info(f"Rolled back team creation (deleted team {new_team_id}) due to user update failure.")
            except Exception as rollback_err:
                 logger.error(f"CRITICAL: Failed to rollback team creation (delete team {new_team_id}) after user update failure: {rollback_err}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update user record. Team creation rolled back."
            )
        elif update_result.modified_count == 0 and update_result.matched_count == 1:
             logger.warning(f"User {current_user.id} already had teamId {new_team_id} in their teamIds array during team creation.")


    

    except Exception as e:
        logger.exception(f"Error during database operation creating team '{team_name}' for user {current_user.id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected database error occurred while creating the team."
        )

    # Prepare and Return Response
    created_team_response = TeamInDB(
        id=str(new_team_id),
        name=new_team_data.name,
        creatorId=str(current_user_oid),
        members=new_team_data.members,
        createdAt=new_team_data.createdAt,
        updatedAt=new_team_data.updatedAt
    )
    logger.info(f"Returning created team details for ID: {new_team_id}")
    return created_team_response


# --- list_user_teams (NO CHANGES) ---
@team_sub_router.get("", response_model=List[TeamBasicInfo])
async def list_user_teams(
    current_user: UserInDB = Depends(get_current_active_user)
):
    """
    Lists the basic information (_id, name) for teams the current user is a member of.
    """
    if teams_collection is None:
         logger.error("Database error: 'teams_collection' is None.")
         raise HTTPException(status_code=500, detail="Database connection or collection setup failed.")

    user_team_ids = current_user.teamIds if current_user.teamIds else []
    if not user_team_ids:
        logger.info(f"User {current_user.id} has no teams associated.")
        return []

    try:
        # Convert string IDs from user model to ObjectIds for the MongoDB query
        team_object_ids = []
        invalid_ids_found = []
        for tid in user_team_ids:
            # If teamIds are already ObjectIds, use them directly
            # If they're strings, convert to ObjectId
            if isinstance(tid, ObjectId):
                team_object_ids.append(tid)
            elif ObjectId.is_valid(tid):
                team_object_ids.append(ObjectId(tid))
            else:
                invalid_ids_found.append(tid)

        if invalid_ids_found:
             logger.error(f"User {current_user.id} has invalid ObjectId strings in teamIds: {invalid_ids_found}. Querying with valid IDs only.")
             if not team_object_ids: return []

        teams_cursor = teams_collection.find(
            {"_id": {"$in": team_object_ids}},
            {"_id": 1, "name": 1}
        )

        teams_list: List[TeamBasicInfo] = []
        for team_doc in teams_cursor:
             doc_id = team_doc.get("_id")
             doc_name = team_doc.get("name")
             if doc_id and doc_name is not None:
                 teams_list.append(TeamBasicInfo(id=str(doc_id), name=doc_name))
             else:
                  logger.warning(f"Skipping team document with missing _id or name during list creation: {team_doc}")

        logger.info(f"Found {len(teams_list)} teams for user {current_user.id}.")
        return teams_list

    except Exception as e:
        logger.exception(f"Error listing teams for user {current_user.id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve team list."
        )


# --- get_team_details (NO CHANGES) ---
@team_sub_router.get("/{team_id}", response_model=TeamInDB)
async def get_team_details(
    team_id: str,
    current_user: UserInDB = Depends(get_current_active_user)
):
    """
    Gets the full details of a specific team, including populated member details (username, email),
    if the current user is a member of that team. Uses MongoDB aggregation $lookup.
    """
    if teams_collection is None or users_collection is None: # Check both collections
         if teams_collection is None: logger.error("DB error: 'teams_collection' is None.")
         if users_collection is None: logger.error("DB error: 'users_collection' is None.")
         raise HTTPException(status_code=500, detail="Database connection or collection setup failed.")

    try:
        team_oid = ObjectId(team_id)
    except Exception:
        logger.warning(f"Invalid team_id format requested: {team_id}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Team ID format.")

    try:
        # --- Use Aggregation Pipeline ---
        pipeline = [
            {"$match": {"_id": team_oid}},
            {"$unwind": {"path": "$members", "preserveNullAndEmptyArrays": True}},
            {
                "$lookup": {
                    "from": "users",
                    "let": {"memberUserId": {"$toObjectId": "$members.userId"}}, # Assumes members.userId could be string OR ObjectId - converts to ObjectId for lookup
                    "pipeline": [
                        {"$match": {"$expr": {"$eq": ["$_id", "$$memberUserId"]}}},
                        {"$project": {"_id": 0, "username": 1, "email": 1}}
                    ],
                    "as": "memberUserDetails"
                }
            },
            {"$unwind": {"path": "$memberUserDetails", "preserveNullAndEmptyArrays": True}},
            {"$addFields": {
                "members.username": "$memberUserDetails.username",
                "members.email": "$memberUserDetails.email"
            }},
            {
                "$group": {
                    "_id": "$_id",
                    "name": {"$first": "$name"},
                    "creatorId": {"$first": "$creatorId"},
                    "createdAt": {"$first": "$createdAt"},
                    "updatedAt": {"$first": "$updatedAt"},
                    "members": {"$push": {"$ifNull": ["$members", "$$REMOVE"]}}
                }
            },
             {
                 "$project": {
                     "_id": 1, "name": 1, "creatorId": 1, "createdAt": 1, "updatedAt": 1,
                     "members": {"$ifNull": ["$members", []]},
                 }
             }
        ]

        result_cursor = teams_collection.aggregate(pipeline)
        team_doc_list = list(result_cursor)

        if not team_doc_list:
            logger.warning(f"Team not found with id {team_id} requested by user {current_user.id} (or pipeline error)")
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found.")

        team_doc = team_doc_list[0]

        # --- Access Check ---
        # Important: Check access based on the IDs fetched before potential string conversion
        # This check assumes current_user.id is string, and member.userId might be ObjectId or string
        is_member_check = False
        for m in team_doc.get("members", []):
            if m.get("userId") and str(m.get("userId")) == current_user.id: # Compare as strings
                is_member_check = True
                break

        if not is_member_check:
             user_team_ids_obj = [ObjectId(tid) for tid in current_user.teamIds if ObjectId.is_valid(tid)] # Get user's teams as ObjectIds
             # Check if team_oid is in the user's list stored in their document
             if team_oid not in user_team_ids_obj: # Compare ObjectIds
                  logger.warning(f"User {current_user.id} is not member of team {team_id} (checked in DB user.teamIds).")
                  raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is not a member of this team.")
             else:
                  # This case indicates inconsistency - user doc has team, but team doc doesn't list user
                  logger.error(f"Data inconsistency: User {current_user.id} has teamId {team_id} in user.teamIds, but team doc doesn't list user ID {current_user.id}.")
                  # Proceed, but log the error. Or raise 500? For now, proceed.

        # --- End Access Check ---


        # Convert _id to string BEFORE validation
        if "_id" in team_doc:
             team_doc["_id"] = str(team_doc["_id"])

        # Validate the enriched document using Pydantic
        try:
            validated_team = TeamInDB.model_validate(team_doc)
            return validated_team
        except Exception as validation_err:
             logger.exception(f"Failed to validate enriched TeamInDB model for team {team_id}: {validation_err}")
             logger.error(f"Problematic aggregated team_doc: {team_doc}")
             raise HTTPException(status_code=500, detail="Error processing enriched team data.")

    except HTTPException as he:
        raise he # Re-raise known HTTP errors
    except Exception as e:
        logger.exception(f"Error during aggregation/lookup for team {team_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve enriched team details."
        )

@team_sub_router.post("/{team_id}/members", response_model=TeamInDB, status_code=status.HTTP_200_OK)
async def add_team_member(
    team_id: str, 
    payload: AddMemberRequest,
    current_user: UserInDB = Depends(get_current_active_user)
):
    """ 
    Adds an existing registered user (found by email) to the specified team as a 'member'.
    - Only admins of the team can perform this action.
    - The user to be added must already exist in the system.
    - A user cannot be added if they are already a member of the team.
    - Updates both the team's member list and the added user's teamIds list (with ObjectIds).
    - Returns the fully populated and updated team details.
    """
    action_by_username = current_user.username or f"User ID {current_user.id}"
    logger.info(f"Add member attempt: User '{action_by_username}' trying to add user with email '{payload.email}' to team '{team_id}'.")

    if teams_collection is None or users_collection is None:
         logger.error("Database connection failure: teams_collection or users_collection is None.")
         raise HTTPException(status_code=500, detail="Database connection or collection setup failed.")

    try:
        team_oid = ObjectId(team_id)
        current_admin_oid = ObjectId(current_user.id)
    except Exception: # Catches bson.errors.InvalidId
        logger.warning(f"Invalid Team ID format provided for add member: {team_id}")
        raise HTTPException(status_code=400, detail="Invalid Team ID format.")

    # --- Start of main try-except for operations ---
    try:
        # 1. Fetch team to check admin status and existing members
        team_doc_initial = teams_collection.find_one({"_id": team_oid})
        if not team_doc_initial:
            logger.warning(f"Team {team_id} not found for add member attempt by {action_by_username}.")
            raise HTTPException(status_code=404, detail="Team not found.")

        team_name_for_audit = team_doc_initial.get("name", f"Team {team_id}")
        team_members_list_initial = team_doc_initial.get("members", [])

        # 2. Authorization: Check if current_user is an admin of this team
        is_performing_user_admin = False
        for member_in_list in team_members_list_initial:
            if member_in_list.get("userId") == current_admin_oid and member_in_list.get("team_role") == 'admin':
                is_performing_user_admin = True
                break
        
        if not is_performing_user_admin:
            logger.warning(f"User {action_by_username} (not an admin) attempted to add member to team {team_id}.")
            raise HTTPException(status_code=403, detail="Only team admins can add members.")

        # 3. Find the user to add by email
        user_to_add_doc = users_collection.find_one(
            {"email": payload.email},
            {"_id": 1, "username": 1} 
        )
        if not user_to_add_doc:
            logger.warning(f"User with email '{payload.email}' not found in the system for adding to team {team_id}.")
            raise HTTPException(status_code=404, detail=f"User with email {payload.email} not found.")
        
        user_to_add_oid = user_to_add_doc["_id"] # This is an ObjectId from DB
        user_to_add_username_for_audit = user_to_add_doc.get("username", f"User ID {str(user_to_add_oid)}")

        if user_to_add_oid == current_admin_oid:
            logger.warning(f"Admin {action_by_username} attempted to add themselves to team {team_id} (already admin or creator).")
            raise HTTPException(status_code=400, detail="Cannot add yourself to the team again.")

        # 4. Check if user is already a member (compare ObjectIds)
        is_already_member = any(
            member_in_list.get("userId") == user_to_add_oid
            for member_in_list in team_members_list_initial
        )
        if is_already_member:
            logger.warning(f"User '{payload.email}' (ID: {user_to_add_oid}) is already a member of team {team_id}.")
            raise HTTPException(status_code=400, detail="User is already a member of this team.")

        # 5. Prepare new member data for team document
        new_member_instance = TeamMember(
            userId=str(user_to_add_oid), 
            team_role='member', 
            addedAt=datetime.utcnow(),
            addedBy=str(current_admin_oid) 
        )
        new_member_dict_for_db = new_member_instance.model_dump()
        new_member_dict_for_db['userId'] = user_to_add_oid # Ensure ObjectId for DB
        new_member_dict_for_db['addedBy'] = current_admin_oid # Ensure ObjectId for DB
        
        # --- Database Updates ---
        # 5a. Add member to the team's members array
        update_team_result = teams_collection.update_one(
            {"_id": team_oid},
            {
                "$addToSet": {"members": new_member_dict_for_db},
                "$set": {"updatedAt": datetime.utcnow()}
            }
        )
        # Note: modified_count check for addToSet can be tricky if an exact duplicate object was somehow present.
        # The is_already_member check by userId is the primary guard.

        # 5b. Add team_oid (ObjectId) to the added user's teamIds array
        update_user_profile_result = users_collection.update_one(
            {"_id": user_to_add_oid},
            {"$addToSet": {"teamIds": team_oid}} # Add team_oid (ObjectId)
        )

        if update_user_profile_result.matched_count == 0:
            logger.error(f"CRITICAL: User to add (ID: {user_to_add_oid}) not found during profile update for team {team_id}. Rolling back member addition from team.")
            teams_collection.update_one(
                {"_id": team_oid},
                {"$pull": {"members": {"userId": user_to_add_oid}}} # Rollback
            )
            raise HTTPException(status_code=500, detail="Failed to update added user's profile. Member addition has been rolled back.")
        
        # --- Audit Log ---
        await create_audit_log(
            user=current_user, 
            action="TEAM_MEMBER_ADDED",
            account_id_override=team_oid, 
            account_name_override=team_name_for_audit,
            details={
                "target_user_id": str(user_to_add_oid),
                "target_username": user_to_add_username_for_audit,
                "target_user_email": payload.email,
                "assigned_role_in_team": new_member_instance.team_role 
            }
        )
        logger.info(f"Successfully added member {user_to_add_username_for_audit} (Email: {payload.email}) to team {team_id} by admin {action_by_username}.")
        
        # --- Prepare and Return Rich Response (Populated TeamInDB) ---
        # Use aggregation pipeline similar to get_team_details to populate member info
        pipeline_for_response = [
            {"$match": {"_id": team_oid}},
            {"$unwind": {"path": "$members", "preserveNullAndEmptyArrays": True}},
            {
                "$lookup": {
                    "from": users_collection.name, 
                    "localField": "members.userId", 
                    "foreignField": "_id", 
                    "as": "memberUserDetails"       # This is an array at the root of the doc
                }
            },
            # $unwind memberUserDetails so each doc has one user detail object (or empty if no match)
            {"$unwind": {"path": "$memberUserDetails", "preserveNullAndEmptyArrays": True}}, 
            {
                # Add username and email to the members sub-document being processed
                "$addFields": {
                    "members.username": "$memberUserDetails.username", 
                    "members.email": "$memberUserDetails.email"
                }
            },
            {
                "$group": {
                    "_id": "$_id",
                    "name": {"$first": "$name"},
                    "creatorId": {"$first": "$creatorId"},
                    "createdAt": {"$first": "$createdAt"},
                    "updatedAt": {"$first": "$updatedAt"},
                    # $members here refers to the members sub-document that now has username/email
                    "members": {"$push": "$members"} 
                }
            },
            {
                # Final shape of the document
                "$project": { 
                    "_id": 1, 
                    "name": 1, 
                    "creatorId": 1, 
                    "createdAt": 1, 
                    "updatedAt": 1,
                    "members": {"$ifNull": ["$members", []]} 
                }
            }
        ]
        
        aggregated_result_cursor = teams_collection.aggregate(pipeline_for_response)
        aggregated_team_doc_list = list(aggregated_result_cursor)

        if not aggregated_team_doc_list:
            logger.error(f"CRITICAL: Aggregation failed to return team {team_id} after adding member.")
            # Member was added, but we can't return the full details.
            # This indicates a problem with the aggregation or data state.
            raise HTTPException(status_code=500, detail="Member added, but error fetching full updated team details.")

        populated_team_doc_for_response = aggregated_team_doc_list[0]
        
        if "_id" in populated_team_doc_for_response and isinstance(populated_team_doc_for_response["_id"], ObjectId):
            populated_team_doc_for_response["_id"] = str(populated_team_doc_for_response["_id"])

        try:
            validated_team_response = TeamInDB.model_validate(populated_team_doc_for_response)
            return validated_team_response
        except Exception as val_err:
            logger.exception(f"Pydantic validation error for team response after adding member: {val_err}. Data: {populated_team_doc_for_response}")
            raise HTTPException(status_code=500, detail="Error preparing rich team data for response.")

    # --- Exception Handling for the main try block ---
    except HTTPException as he:
        raise he 
    except PyMongoError as e_db:
        logger.exception(f"Database error during add member operation (email: {payload.email}, team: {team_id}): {e_db}")
        raise HTTPException(status_code=500, detail="A database error occurred.")
    except Exception as e_gen:
        logger.exception(f"Unexpected error adding member {payload.email} to team {team_id}: {e_gen}")
        raise HTTPException(status_code=500, detail="An unexpected error occurred.")


# --- remove_team_member (MINIMAL CHANGES for comparison and $pull) ---
@team_sub_router.delete("/{team_id}/members/{user_id_to_remove}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_team_member(
    team_id: str,
    user_id_to_remove: str, # Incoming string representation
    current_user: UserInDB = Depends(get_current_active_user) # Admin performing the action
):
    """ 
    Removes a member from a team.
    - Only admins of the team can perform this action.
    - An admin cannot remove themselves via this endpoint.
    - The last admin of a team cannot be removed.
    - The original creator of the team cannot be removed.
    """
    action_by_username = current_user.username or f"User ID {current_user.id}"
    logger.info(f"Remove member attempt: User '{action_by_username}' trying to remove user '{user_id_to_remove}' from team '{team_id}'.")

    if teams_collection is None or users_collection is None:
         logger.error("Database connection failure: teams_collection or users_collection is None.")
         raise HTTPException(status_code=500, detail="Database connection failure.")

    try:
        team_oid = ObjectId(team_id)
        user_id_to_remove_oid = ObjectId(user_id_to_remove) # Convert once for consistent use
        current_admin_oid = ObjectId(current_user.id)
    except Exception: # Catches bson.errors.InvalidId
         logger.warning(f"Invalid ID format provided. TeamID: {team_id}, UserIDToRemove: {user_id_to_remove}")
         raise HTTPException(status_code=400, detail="Invalid Team ID or User ID format for removal.")

    if current_admin_oid == user_id_to_remove_oid:
        logger.warning(f"Admin {action_by_username} attempted to remove themselves from team {team_id}.")
        raise HTTPException(status_code=400, detail="Admins cannot remove themselves using this endpoint. Use a 'Leave Team' feature if applicable.")

    try:
        # Fetch the full team document to check creatorId, members, and name for audit
        team_doc = teams_collection.find_one({"_id":  team_oid}) # No specific projection, need members and creatorId
        if not team_doc:
            logger.warning(f"Team {team_id} not found for member removal attempt by {action_by_username}.")
            raise HTTPException(status_code=404, detail="Team not found.")

        team_members_list = team_doc.get("members", [])
        team_creator_oid = team_doc.get("creatorId") # This is an ObjectId from DB
        team_name_for_audit = team_doc.get("name", f"Team {team_id}")


        # Authorization: Check if current_user is an admin of this team
        is_performing_user_admin = False
        for member_in_list in team_members_list:
            if member_in_list.get("userId") == current_admin_oid and member_in_list.get("team_role") == 'admin':
                is_performing_user_admin = True
                break
        
        if not is_performing_user_admin:
            logger.warning(f"User {action_by_username} (not an admin) attempted to remove member from team {team_id}.")
            raise HTTPException(status_code=403, detail="Only team admins can remove members.")

        # Find Member to Remove & Get Their Role
        member_to_remove_data = None
        for member_in_list in team_members_list:
            if member_in_list.get("userId") == user_id_to_remove_oid:
                member_to_remove_data = member_in_list
                break
        
        if not member_to_remove_data:
            logger.warning(f"User {user_id_to_remove} not found as a member in team {team_id}.")
            raise HTTPException(status_code=404, detail="User specified for removal is not currently a member of this team.")

        role_of_member_to_remove = member_to_remove_data.get("team_role")

        # --- Business Rule Safeguards ---
        # 1. Prevent Removal of Team Creator
        if user_id_to_remove_oid == team_creator_oid:
            logger.warning(f"Admin {action_by_username} attempted to remove the team creator ({user_id_to_remove}) from team {team_id}.")
            raise HTTPException(status_code=400, detail="The original team creator cannot be removed from the team.")

        # 2. Prevent Removal of the Last Admin
        if role_of_member_to_remove == 'admin':
            current_admin_count = 0
            for member_in_list in team_members_list:
                if member_in_list.get("team_role") == 'admin':
                    current_admin_count += 1
            
            if current_admin_count <= 1: # The user being removed is the last (or only) admin
                logger.warning(f"Admin {action_by_username} attempted to remove the last admin ({user_id_to_remove}) from team {team_id}.")
                raise HTTPException(status_code=400, detail="Cannot remove the last admin. Assign another admin first or delete the team.")
        # --- End Safeguards ---

        # Database Update: Pull member from team's members array
        update_team_result = teams_collection.update_one(
            {"_id": team_oid},
            {
                "$pull": {"members": {"userId": user_id_to_remove_oid}}, # Use ObjectId to match DB
                "$set": {"updatedAt": datetime.utcnow()}
            }
        )
        
        if update_team_result.modified_count == 0:
            # This could happen if the member was already removed by another process between find_one and update_one.
            # Or if userId didn't match (though previous checks should catch this).
            logger.warning(f"Attempted removal of member {user_id_to_remove} from team {team_id} resulted in modified_count=0 (already removed or ID mismatch in pull). Matched: {update_team_result.matched_count}")
            # Depending on strictness, you might raise an error or just proceed if matched_count was 1.
            # For now, proceed if matched, as the member is effectively not in the list.

        # Update Removed User's Document: Pull team_id from their teamIds array
        try:
            # user_id_to_remove_oid is already ObjectId
            update_user_result = users_collection.update_one(
                {"_id": user_id_to_remove_oid},
                {"$pull": {"teamIds": team_oid}} # team_id is a string as stored in user.teamIds
            )
            if update_user_result.matched_count == 0:
                 logger.error(f"Failed to find user {user_id_to_remove} to update their teamIds array after removal from team {team_id}.")
            elif update_user_result.modified_count == 0:
                 logger.warning(f"User {user_id_to_remove}'s teamIds array did not contain team {team_id} or was not modified for team {team_id}.")
        except PyMongoError as user_update_e_db:
             logger.exception(f"Non-critical DB error updating user {user_id_to_remove}'s teamIds after removal from team {team_id}: {user_update_e_db}")
        except Exception as user_update_e_gen:
             logger.exception(f"Non-critical unexpected error updating user {user_id_to_remove}'s teamIds after removal from team {team_id}: {user_update_e_gen}")

        # Prepare for Audit Log
        removed_user_info_for_audit = users_collection.find_one({"_id": user_id_to_remove_oid}, {"username": 1})
        removed_username_for_audit = removed_user_info_for_audit.get("username") if removed_user_info_for_audit else f"User ID {user_id_to_remove}"

        await create_audit_log(
            user=current_user,
            action="TEAM_MEMBER_REMOVED",
            account_id_override=team_oid,
            account_name_override=team_name_for_audit,
            details={
                "target_user_id": str(user_id_to_remove_oid),
                "target_username": removed_username_for_audit,
                "role_in_team_before_removal": role_of_member_to_remove 
            }
        )

        logger.info(f"Successfully removed member {user_id_to_remove} ({removed_username_for_audit}) from team {team_id} by admin {action_by_username}.")
        return None # HTTP 204 No Content

    except HTTPException as he:
        raise he # Re-raise HTTPExceptions
    except PyMongoError as e_db:
        logger.exception(f"Database error during member removal (user: {user_id_to_remove}, team: {team_id}): {e_db}")
        raise HTTPException(status_code=500, detail="A database error occurred while removing the member.")
    except Exception as e_gen:
        logger.exception(f"Unexpected error removing member {user_id_to_remove} from team {team_id}: {e_gen}")
        raise HTTPException(status_code=500, detail="An unexpected error occurred while removing the member.")
    

@team_sub_router.put(
    "/{team_id}/members/{member_user_id}/role",
    status_code=status.HTTP_200_OK,
    summary="Update a team member's role",
    response_model=Dict[str, str] # Simple success message
)
async def update_team_member_role(
    team_id: str,
    member_user_id: str, # The user whose role is being changed
    request: UpdateMemberRoleRequest, # Contains new_role: 'admin' or 'member'
    current_user: UserInDB = Depends(get_current_active_user) # The admin performing the change
):
    """
    Allows a account admin to change the role of another member within the account.
    """
    action_by_username = current_user.username or f"User ID {current_user.id}"
    logger.info(f"Role update attempt for member {member_user_id} in account {team_id} to '{request.new_role}' by admin '{action_by_username}'.")

    if teams_collection is None or users_collection is None: # Essential collections
        logger.error("Database connection failure: teams_collection or users_collection is None.")
        raise HTTPException(status_code=500, detail="Database connection failure.")

    try:
        team_oid = ObjectId(team_id)
        target_user_oid = ObjectId(member_user_id) # User whose role is to be changed
        current_admin_oid = ObjectId(current_user.id) # Admin making the request
    except Exception: # Catches bson.errors.InvalidId
        logger.warning(f"Invalid ID format provided. accountID: {team_id}, MemberUserID: {member_user_id}")
        raise HTTPException(status_code=400, detail="Invalid account ID or Member User ID format.")

    if current_admin_oid == target_user_oid:
        logger.warning(f"Admin {action_by_username} attempted to change their own role in account {team_id}.")
        raise HTTPException(status_code=400, detail="Admins cannot change their own role using this endpoint.")

    # Fetch the account document
    try:
        team_doc = teams_collection.find_one(
            {"_id": team_oid},
            # Project fields needed for checks, audit log, and potentially response
            {"members": 1, "name": 1, "creatorId": 1}
        )
    except PyMongoError as e_find:
        logger.exception(f"Database error fetching account {team_id} for role update: {e_find}")
        raise HTTPException(status_code=500, detail="Error accessing account data.")

    if not team_doc:
        logger.warning(f"account {team_id} not found for role update by admin {action_by_username}.")
        raise HTTPException(status_code=404, detail="account not found.")

    team_members_list = team_doc.get("members", [])
    team_name_for_audit = team_doc.get("name", f"account {team_id}")
    team_creator_oid = team_doc.get("creatorId") # This is an ObjectId 

    # Authorization: Check if current_user is an admin of this account
    is_current_user_admin = False
    for member_in_list in team_members_list:
        if member_in_list.get("userId") == current_admin_oid and member_in_list.get("team_role") == "admin":
            is_current_user_admin = True
            break
    
    if not is_current_user_admin:
        logger.warning(f"User {action_by_username} (not an admin) attempted to change role in account {team_id}.")
        raise HTTPException(status_code=403, detail="You do not have permission to change member roles in this account.")

    # Target Member Validation: Check if target_user_oid is a member and get their current role
    target_member_data = None
    for member_in_list in team_members_list:
        if member_in_list.get("userId") == target_user_oid:
            target_member_data = member_in_list
            break
            
    if not target_member_data:
        logger.warning(f"Target user {member_user_id} not found as a member in account {team_id}.")
        raise HTTPException(status_code=404, detail="Target user is not a member of this account.")
        
    target_member_current_role = target_member_data.get("team_role")

    # Role Already Set Check
    if target_member_current_role == request.new_role:
        logger.info(f"Role for member {member_user_id} in account {team_id} is already '{request.new_role}'. No update performed.")
        return {"message": f"Member is already a {request.new_role}."}

    # Business Rule Safeguards (Only if demoting from 'admin' to 'member')
    if target_member_current_role == 'admin' and request.new_role == 'member':
        # 1. Last Admin Demotion Prevention
        current_admin_count = 0
        for member_in_list in team_members_list:
            if member_in_list.get("team_role") == 'admin':
                current_admin_count += 1
        
        if current_admin_count <= 1: # target_user_oid is the only admin
            logger.warning(f"Attempt to demote the last admin ({member_user_id}) of account {team_id} by {action_by_username}.")
            raise HTTPException(status_code=400, detail="Cannot demote the last admin of the account. Assign another admin first.")

        # 2. Creator Demotion Prevention (if creator is not the one making the change to themselves, which is already blocked)
        if team_creator_oid == target_user_oid: # target_user_oid is the creator
            # And current_admin_oid != target_user_oid is implied by the self-change check earlier
            logger.warning(f"Admin {action_by_username} attempted to demote account creator ({member_user_id}) of account {team_id}.")
            raise HTTPException(status_code=400, detail="The original account creator cannot be demoted to 'member' by another admin.")

    # Database Update
    try:
        update_result = teams_collection.update_one(
            {"_id": team_oid, "members.userId": target_user_oid}, # Match the specific member
            {"$set": {
                "members.$.team_role": request.new_role, # Update role of matched member
                "updatedAt": datetime.utcnow()
            }}
        )

        if update_result.matched_count == 0:
            # Should not happen if target_member_data was found, implies a race condition or error
            logger.error(f"Concurrency issue or bug: Member {member_user_id} in account {team_id} not found during DB update, though previously verified.")
            raise HTTPException(status_code=404, detail="Target member not found during update operation. This might be a temporary issue, please try again.")
        
        # modified_count will be 0 if role was already set, but we have a check for that above.
        # If we reach here, modified_count should ideally be 1.
        if update_result.modified_count == 0:
             logger.warning(f"Role for member {member_user_id} in account {team_id} was NOT modified by DB (matched: {update_result.matched_count}). Current role might already be '{request.new_role}' or another issue.")
             # This situation is less likely given the explicit check earlier, but good to log.

        # --- Audit Log ---
        # Fetch target user's username for a more descriptive audit log
        target_user_details_for_audit = users_collection.find_one({"_id": target_user_oid}, {"username": 1})
        target_username_for_audit = target_user_details_for_audit.get("username", f"User ID {member_user_id}") if target_user_details_for_audit else f"User ID {member_user_id}"

        await create_audit_log(
            user=current_user, # UserInDB object of the admin performing the action
            action="ACCOUNT_MEMBER_ROLE_UPDATED",
            account_id_override=team_oid, # ObjectId of the team/account
            account_name_override=team_name_for_audit,
            details={
                "target_user_id": str(target_user_oid),
                "target_username": target_username_for_audit,
                "previous_role": target_member_current_role,
                "new_role_assigned": request.new_role,
                "changed_by_admin_id": str(current_admin_oid),
                "changed_by_admin_username": current_user.username # Already available
            }
        )
        # --- End Audit Log ---

        logger.info(f"Role of member {member_user_id} ({target_username_for_audit}) in account {team_id} successfully changed from '{target_member_current_role}' to '{request.new_role}' by admin {action_by_username}.")
        return {"message": f"Member role successfully updated to {request.new_role}."}

    except PyMongoError as e_update:
        logger.exception(f"Database error updating member role for {member_user_id} in account {team_id}: {e_update}")
        raise HTTPException(status_code=500, detail="Failed to update member role due to a database error.")
    except Exception as e_general: # Catch any other unexpected errors
        logger.exception(f"Unexpected error updating member role for {member_user_id} in account {team_id}: {e_general}")
        raise HTTPException(status_code=500, detail="An unexpected error occurred while updating member role.")

# --- Keep original comments about future endpoints ---
# future endpoints:
# PUT /api/teams/{team_id} (e.g., update team name - admin only)
# PUT /api/teams/{team_id}/members/{user_id} (e.g., change member role - admin only)
# DELETE /api/teams/{team_id} (delete the whole team - admin only, maybe only creator?)
