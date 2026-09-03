import logging
from datetime import datetime
from typing import Dict, Any, List, Optional
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status, Request

from core.config import settings
from core.database import (
    db,
    async_db,
    collection,
    users_collection,
    teams_collection,
    projects_collection,
)
from core.security import get_current_active_user
from models.domain import (
    UserInDB,
    AssignWorkflowRolesRequest,
    RejectContractRequest,
    ReEditRequest,
    DenyReEditRequest,
)
from models.response_types import ContractResponse
from api.dependencies import (
    privileges_for,
    get_contract_and_verify_access,
    get_current_user_from_ticket_or_session,
    check_contract_access,
)
from core.cache import cache
from utils.audit_logger import create_audit_log
from core.privileges import ROLES_ASSIGN_CONTRACT
from services.personas import can_hold_workflow_role, effective_privileges
from services.workflow_roles import (
    effective_roles_for_contract,
    load_project_for_contract,
    resolve_workflow_roles,
)

logger = logging.getLogger(__name__)

workflows_router = APIRouter()


def privileges_for_user_id(user_oid: ObjectId, account_oid: Optional[ObjectId]) -> set:
    """What some other member of this account holds — used to check whether a
    person may be handed a role, not what the caller may do."""
    from core.database import personas_collection

    if not isinstance(account_oid, ObjectId) or teams_collection is None:
        return set()
    team = teams_collection.find_one({"_id": account_oid})
    if not team:
        return set()
    personas = list(personas_collection.find({"accountId": account_oid}))
    return effective_privileges(team=team, user_id=user_oid, personas=personas)


def _forget_cached_contract(contract_id: str) -> None:
    """Drop the cached contract document after a transition.

    get_contract caches for five minutes. Without this, approving a contract
    leaves every reader — the UI included — looking at the previous status
    until the entry expires, so the action appears to have done nothing.
    """
    try:
        cache.delete(f"contract:doc:{contract_id}")
    except Exception as exc:  # a cache that is down must not fail the workflow
        logger.warning("Could not invalidate cached contract %s: %s", contract_id, exc)


def _roles_for(contract: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Roles that apply to this contract right now.

    Contract override, else the project default, and then whoever is standing
    in for that person while they are away.
    """
    return effective_roles_for_contract(contract, projects_collection, users_collection)


def _notify_role_holder(
    user_oid: Optional[ObjectId],
    *,
    subject: str,
    headline: str,
    body: str,
    contract: Optional[Dict[str, Any]] = None,
    contract_id: Optional[str] = None,
) -> None:
    """Email whoever now has to act. Never let this break the transition.

    A queued notification failing is an annoyance; an approval rolling back
    because an email failed is a bug the user cannot work around.
    """
    if not isinstance(user_oid, ObjectId) or users_collection is None:
        return
    try:
        user = users_collection.find_one({"_id": user_oid}, {"email": 1, "username": 1})
        recipient = (user or {}).get("email")
        if not recipient:
            logger.info("No email on file for user %s; skipping workflow notification.", user_oid)
            return

        # No dedicated frontend-URL setting exists; the first allowed origin is
        # the app the user actually browses.
        action_url = None
        origins = str(getattr(settings, "allowed_origins", "") or "")
        first_origin = next((o.strip() for o in origins.split(",") if o.strip()), None)
        if first_origin and contract_id:
            action_url = f"{first_origin.rstrip('/')}/contracts/{contract_id}"

        from worker.tasks import send_workflow_notification_task

        send_workflow_notification_task.delay(
            recipient_email=recipient,
            subject=subject,
            headline=headline,
            body=body,
            contract_name=(contract or {}).get("contract_name"),
            action_url=action_url,
        )
    except Exception as exc:  # broker down, task import failure, anything
        logger.warning("Could not queue workflow notification for %s: %s", user_oid, exc)

# Forward reference / local function definitions if needed, or import get_contract from contracts.py
# Since we need to return get_contract(...) in some routes, we can import it from api.routes.contracts
from api.routes.contracts import get_contract

# --- Workflow Routes ---
@workflows_router.put("/contracts/{contract_id}/roles", status_code=status.HTTP_200_OK)
async def assign_workflow_roles(
    contract_id: str,
    request: AssignWorkflowRolesRequest,
    current_user: UserInDB = Depends(get_current_active_user)
) -> Dict[str, Any]: # Changed return type to Dict to match your last version's return
    """
    Assigns or updates the Editor and Approver roles for a specific contract.
    Allowed only for the Account Owner OR the original uploader of the contract.
    Logs this action.
    """
    logger.info(f"Role assignment request for contract {contract_id} by user {current_user.id} ({current_user.username}). Payload: {request.model_dump_json(exclude_none=True)}")

    if collection is None or users_collection is None or teams_collection is None:
        logger.error("assign_workflow_roles: Database connection/collection failure.")
        raise HTTPException(status_code=500, detail="Database connection failure.")

    # 1. Validate Contract ID
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        logger.warning(f"Invalid contract_id format for role assignment: {contract_id}")
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    # 2. Fetch contract details for permission check, audit, and current roles
    contract_before_roles_update = collection.find_one(
        {"_id": contract_oid},
        {"ownerType": 1, "ownerId": 1, "uploaded_by": 1, "contract_name": 1, "workflowRoles": 1, "projectId": 1}
    )
    if not contract_before_roles_update:
        logger.warning(f"Contract {contract_id} not found for role assignment.")
        raise HTTPException(status_code=404, detail="Contract not found.")

    # 3. Permission Check
    owner_type = contract_before_roles_update.get("ownerType")
    owner_id_obj_from_db = contract_before_roles_update.get("ownerId") # This is ObjectId
    uploader_id_obj_from_db = contract_before_roles_update.get("uploaded_by") # This is ObjectId
    user_oid_current = ObjectId(current_user.id) # Current user's ObjectId

    can_assign_roles = False
    if owner_type == "user":
        # Personal documents typically don't have this complex workflow.
        # Only the owner of a personal document can interact with it in specific ways.
        # If owner_id_obj_from_db == user_oid_current:
        #    can_assign_roles = True # Or you might decide roles are not applicable
        logger.warning(f"Attempt to assign roles to a personal document {contract_id}. This is not standard workflow.")
        raise HTTPException(status_code=400, detail="Workflow roles cannot be assigned to personal documents.")
    elif owner_type == "team":
        if not isinstance(owner_id_obj_from_db, ObjectId):
            logger.error(f"Contract {contract_id} (team owned) has invalid ownerId type: {type(owner_id_obj_from_db)}")
            raise HTTPException(status_code=500, detail="Invalid team ownership data for contract.")

        owner_id_str_for_check = str(owner_id_obj_from_db)
        is_account_owner = current_user.ownedAccountId == owner_id_str_for_check
        is_contract_uploader = uploader_id_obj_from_db == user_oid_current

        # The uploader shortcut predates privileges; roles.assign.contract is
        # the real test, and the owner keeps it because their persona carries it.
        holds_assign_privilege = ROLES_ASSIGN_CONTRACT in privileges_for(
            current_user, owner_id_obj_from_db
        )

        if is_account_owner or is_contract_uploader or holds_assign_privilege:
            can_assign_roles = True
            logger.debug(f"Role assignment allowed for contract {contract_id}: User {current_user.id} is {'Account Owner' if is_account_owner else ''}{' and ' if is_account_owner and is_contract_uploader else ''}{'Contract Uploader' if is_contract_uploader else ''}.")
        else:
            is_member_for_log = owner_id_str_for_check in (current_user.teamIds or [])
            logger.warning(f"Role assignment denied for contract {contract_id}: User {current_user.id} is not Account Owner or Contract Uploader. (Is Member: {is_member_for_log})")
            raise HTTPException(status_code=403, detail="Only the account owner or the contract uploader can assign workflow roles.")
    else:
         logger.error(f"Contract {contract_id} has invalid ownerType: '{owner_type}'")
         raise HTTPException(status_code=500, detail="Invalid contract ownership type.")

    if not can_assign_roles: # Fallback, should be caught by logic above
        raise HTTPException(status_code=403, detail="Permission denied to assign roles for this contract.")

    # 4. Prepare update_payload and validate assigned user IDs
    update_payload: Dict[str, Any] = {}
    users_to_validate_map: Dict[str, ObjectId] = {} # Maps string ID from request to ObjectId for validation

    final_editor_oid: Optional[ObjectId] = None
    if request.editorUserId is not None: # If explicitly provided in request (even if empty string, but model should prevent that for ID)
        if request.editorUserId == "": # Handle explicit unsetting via empty string
            update_payload["workflowRoles.editorUserId"] = None
        elif ObjectId.is_valid(request.editorUserId):
            final_editor_oid = ObjectId(request.editorUserId)
            update_payload["workflowRoles.editorUserId"] = final_editor_oid
            users_to_validate_map[request.editorUserId] = final_editor_oid
        else:
            raise HTTPException(status_code=400, detail=f"Invalid format for editorUserId: {request.editorUserId}")
    else: # If key is missing in request, don't change it
        pass


    final_approver_oid: Optional[ObjectId] = None
    if request.approverUserId is not None:
        if request.approverUserId == "": # Handle explicit unsetting
            update_payload["workflowRoles.approverUserId"] = None
        elif ObjectId.is_valid(request.approverUserId):
            final_approver_oid = ObjectId(request.approverUserId)
            update_payload["workflowRoles.approverUserId"] = final_approver_oid
            users_to_validate_map[request.approverUserId] = final_approver_oid
        else:
            raise HTTPException(status_code=400, detail=f"Invalid format for approverUserId: {request.approverUserId}")
    else: # Key missing, don't change
        pass

    # Validate that assigned users are members of the team (account)
    if users_to_validate_map and owner_type == "team": # Validation only needed if users are assigned AND it's a team doc
        if not isinstance(owner_id_obj_from_db, ObjectId): # Should be an ObjectId if owner_type is team
             logger.error(f"Cannot validate members: ownerId for team contract {contract_id} is not an ObjectId.")
             raise HTTPException(status_code=500, detail="Internal server error processing team data.")

        team_doc_for_members = teams_collection.find_one(
            {"_id": owner_id_obj_from_db}, # Use the ObjectId of the team/account
            {"members.userId": 1}
        )
        if not team_doc_for_members:
            logger.error(f"Team/Account document {owner_id_obj_from_db} not found for membership check during role assignment.")
            raise HTTPException(status_code=404, detail="Associated account for membership validation not found.")

        account_member_oids = [
            member.get("userId") for member in team_doc_for_members.get("members", [])
            if isinstance(member.get("userId"), ObjectId)
        ]

        for user_id_str_assign, user_oid_assign in users_to_validate_map.items():
            if user_oid_assign not in account_member_oids:
                logger.warning(f"User ID {user_id_str_assign} (OID: {user_oid_assign}) is not a member of account {owner_id_obj_from_db}. Members: {account_member_oids}")
                raise HTTPException(status_code=400, detail=f"User {user_id_str_assign} is not a member of this account and cannot be assigned a role.")
        logger.debug(f"Assigned users {list(users_to_validate_map.keys())} validated as account members for account {owner_id_obj_from_db}.")

    # Store old roles (ObjectIds or None) for audit log details
    old_workflow_roles_from_db = contract_before_roles_update.get("workflowRoles", {})
    old_editor_id_obj = old_workflow_roles_from_db.get("editorUserId")
    old_approver_id_obj = old_workflow_roles_from_db.get("approverUserId")

    # One person cannot both edit and approve the same contract. A request may
    # set only one of the two roles, so the check is against the pair that will
    # exist after this update, not against what the request happens to carry.
    # An unset role falls through to the project default, so the pair being
    # checked has to include what would be inherited. The fallback is the
    # project's value alone — resolving against the contract would hand back the
    # very role this request is clearing.
    inherited_roles = resolve_workflow_roles(
        None, load_project_for_contract(contract_before_roles_update, projects_collection)
    )
    effective_editor_oid = (
        update_payload["workflowRoles.editorUserId"]
        if "workflowRoles.editorUserId" in update_payload
        else old_editor_id_obj
    ) or inherited_roles["editorUserId"]
    effective_approver_oid = (
        update_payload["workflowRoles.approverUserId"]
        if "workflowRoles.approverUserId" in update_payload
        else old_approver_id_obj
    ) or inherited_roles["approverUserId"]
    # A workflow role allocates work to someone who can do it. Assignment used
    # to be trusted on its own, so anyone in the account could be named Approver
    # whether or not they could approve anything.
    for role_name, candidate in (
        ("editor", update_payload.get("workflowRoles.editorUserId")),
        ("approver", update_payload.get("workflowRoles.approverUserId")),
    ):
        if not isinstance(candidate, ObjectId):
            continue
        candidate_privileges = privileges_for_user_id(candidate, owner_id_obj_from_db)
        if not can_hold_workflow_role(candidate_privileges, role_name):
            raise HTTPException(
                status_code=400,
                detail=f"That person's persona does not allow them to be the {role_name} on a contract.",
            )

    if (
        effective_editor_oid is not None
        and effective_approver_oid is not None
        and effective_editor_oid == effective_approver_oid
    ):
        logger.warning(
            "Role assignment rejected for contract %s: user %s would hold both Editor and Approver.",
            contract_id, effective_editor_oid,
        )
        raise HTTPException(
            status_code=400,
            detail="The same user cannot be both Editor and Approver on a contract. Assign a different approver.",
        )

    # 5. Update the Contract Document
    try:
        if not update_payload: # No roles were specified in the request to change
             logger.info(f"No role changes specified in request for contract {contract_id}.")
             # Depending on desired behavior, could return a 200 with "no changes" or a 304 Not Modified, or just proceed.
             # For simplicity, if Pydantic model allows empty, this path means no changes from client.
             return {"message": "No role information provided to update.", "updated": False}

        update_result = collection.update_one(
            {"_id": contract_oid},
            {"$set": update_payload}
        )

        if update_result.matched_count == 0: # Should not happen if contract_before_roles_update was found
            logger.error(f"CRITICAL: Contract {contract_id} not found during role update operation.")
            raise HTTPException(status_code=404, detail="Contract not found during role update.")
        
        modified = update_result.modified_count > 0
        if modified:
            logger.info(f"Workflow roles updated for contract {contract_id}.")
        else:
            logger.info(f"Workflow roles for contract {contract_id} were not modified (likely same values or no update needed).")
        
        audit_account_id_for_log: Optional[ObjectId] = None
        if owner_type == "team" and isinstance(owner_id_obj_from_db, ObjectId):
            audit_account_id_for_log = owner_id_obj_from_db
        
        # Usernames for NEWLY ASSIGNED or CHANGED roles
        assigned_editor_username: Optional[str] = None
        assigned_approver_username: Optional[str] = None

        ids_for_username_lookup: Dict[ObjectId, str] = {}
        
        # Get the final new ObjectIds from update_payload to be sure what was set
        new_editor_oid_in_db = update_payload.get("workflowRoles.editorUserId") # ObjectId or None
        new_approver_oid_in_db = update_payload.get("workflowRoles.approverUserId") # ObjectId or None

        if new_editor_oid_in_db and new_editor_oid_in_db != old_editor_id_obj:
            ids_for_username_lookup[new_editor_oid_in_db] = "editor"
        if new_approver_oid_in_db and new_approver_oid_in_db != old_approver_id_obj:
            ids_for_username_lookup[new_approver_oid_in_db] = "approver"
        
        if ids_for_username_lookup and users_collection is not None:
            try:
                name_cursor = users_collection.find(
                    {"_id": {"$in": list(ids_for_username_lookup.keys())}},
                    {"username": 1}
                )
                for user_doc_for_name in name_cursor:
                    role_type = ids_for_username_lookup.get(user_doc_for_name["_id"])
                    if role_type == "editor":
                        assigned_editor_username = user_doc_for_name.get("username")
                    elif role_type == "approver":
                        assigned_approver_username = user_doc_for_name.get("username")
            except Exception as e_name_fetch:
                logger.error(f"Error fetching usernames for audit log in /roles for contract {contract_id}: {e_name_fetch}")
        
        action_details = {
            "old_editor_userId": old_editor_id_obj, # ObjectId or None
            "new_editor_userId": new_editor_oid_in_db, # ObjectId or None from payload
            "new_editor_username": assigned_editor_username if new_editor_oid_in_db else None,
            "old_approver_userId": old_approver_id_obj, # ObjectId or None
            "new_approver_userId": new_approver_oid_in_db, # ObjectId or None from payload
            "new_approver_username": assigned_approver_username if new_approver_oid_in_db else None
        }
        
        # Filter out None values for new usernames if their corresponding ID is None
        # Keep old IDs even if None to show a role was previously empty.
        # Keep new IDs even if None to show a role was explicitly unset.
        # Usernames are only relevant if the new ID is not None.
        if not new_editor_oid_in_db: action_details.pop("new_editor_username", None)
        if not new_approver_oid_in_db: action_details.pop("new_approver_username", None)


        await create_audit_log(
            user=current_user,
            action="WORKFLOW_ROLES_UPDATED",
            contract_id=contract_oid,
            contract_name_override=contract_before_roles_update.get("contract_name"),
            account_id_override=audit_account_id_for_log, # This is ObjectId
            details=action_details
        )
        # --- End Audit Log ---

        # Return simple message as per your last version
        return {"message": "Workflow roles updated successfully.", "updated": modified}

    except HTTPException as he: 
        raise he
    except Exception as e:
        logger.exception(f"Error updating workflow roles for contract {contract_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to update workflow roles.")


@workflows_router.post("/contracts/{contract_id}/submit", response_model=ContractResponse)
async def submit_contract_for_approval(
    contract_id: str,
    current_user: UserInDB = Depends(get_current_active_user)
):
    """
    Submits a contract for approval by the assigned Editor or Account Owner.
    Changes status to 'Pending Approval'.
    """
    logger.info(f"Submit request for contract {contract_id} by user {current_user.id}")

    if collection is None or users_collection is None or teams_collection is None:
        raise HTTPException(status_code=500, detail="Database connection failure.")

    # 1. Validate Contract ID
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        logger.warning(f"Invalid contract_id format for submit: {contract_id}")
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    # 2. Fetch contract data needed for checks and audit details
    contract_before_submit = collection.find_one(
        {
            "_id": contract_oid
        },
        {
            "ownerType": 1,
            "ownerId": 1,
            "status": 1,
            "workflowRoles": 1,
            "projectId": 1,
            "contract_name": 1
        }
    ) #i hate formating code!!! specially of this type and with this type of indentation

    if not contract_before_submit:
        raise HTTPException(status_code=404, detail="Contract not found.")

    # 3. Permission and Status Check
    owner_type = contract_before_submit.get("ownerType")
    owner_id_obj_from_db = contract_before_submit.get("ownerId")
    owner_id_str = str(owner_id_obj_from_db) if isinstance(owner_id_obj_from_db, ObjectId) else None
    current_status_before = contract_before_submit.get("status")
    editor_user_id_obj = _roles_for(contract_before_submit)["editorUserId"] # contract override, else the project default
    user_oid = ObjectId(current_user.id)
    user_id_str = current_user.id

    # Who can submit? Account Owner OR the assigned Editor
    is_owner = (owner_type == "team" and owner_id_str == current_user.ownedAccountId)
    is_assigned_editor = (editor_user_id_obj == user_oid)

    can_submit = False
    # Allow owner or assigned editor to submit
    if owner_type == "user" and owner_id_obj_from_db == user_oid:
         # Allow owner of personal doc to submit (will transition to Completed later)
         # Or should personal docs use a different endpoint like /complete?
         # For now, let's allow submit, but maybe the /complete endpoint is better for personal.
         # Let's restrict submit to team docs for now.
         logger.warning(f"Submit action attempted on personal doc {contract_id} by owner {user_id_str}.")
         raise HTTPException(status_code=400, detail="Personal documents use 'Mark as Complete', not 'Submit'.") # Or handle differently
    elif owner_type == "team":
         if is_owner or is_assigned_editor:
              can_submit = True
         else:
              # Check if user is member just for logging clarity
              is_member = owner_id_str in (current_user.teamIds or [])
              logger.warning(f"Submit denied for contract {contract_id}: User {user_id_str} is neither Owner nor assigned Editor. (Is Member: {is_member})")
              raise HTTPException(status_code=403, detail="Only the Account Owner or assigned Editor can submit for approval.")

    # Check if the status allows submission
    allowed_statuses = ["Ready to Edit", "Editing", "Rejected", "Ingested"]
    if current_status_before not in allowed_statuses:
         logger.warning(f"Submit denied for contract {contract_id}: Invalid status '{current_status_before}'. Must be one of {allowed_statuses}.")
         raise HTTPException(status_code=400, detail=f"Cannot submit contract with status '{current_status_before}'.")

    if not can_submit: # Fallback check
         raise HTTPException(status_code=403, detail="Permission denied to submit this contract.")

    # 4. Update Database
    try:
        now = datetime.utcnow()
        update_result = collection.update_one(
            {"_id": contract_oid},
            {"$set": {
                "status": "Pending Approval", # New status
                "submittedBy": user_oid, # Record who submitted (as ObjectId)
                "updatedAt": now # Optionally update timestamp
            }}
        )
        new_status_after = "Pending Approval"

        if update_result.modified_count == 0 and update_result.matched_count > 0:
            logger.warning(f"Submit for approval for {contract_id} modified 0 docs.")
        elif update_result.modified_count == 0:
            # Could happen if status was already Pending Approval? Log warning.
            logger.warning(f"Submit action for contract {contract_id} modified 0 documents (status might already be Pending Approval?).")

        # --- Create Audit Log ---
        audit_account_id: Optional[ObjectId] = None
        if owner_type == "team" and isinstance(owner_id_obj_from_db, ObjectId):
            audit_account_id = owner_id_obj_from_db

        await create_audit_log(
            user=current_user,
            action="SUBMITTED_FOR_APPROVAL",
            contract_id=contract_oid,
            contract_name_override=contract_before_submit.get("contract_name"),
            account_id_override=audit_account_id,
            details={
                "oldStatus": current_status_before,
                "newStatus": new_status_after
            }
        )

        _notify_role_holder(
            _roles_for(contract_before_submit)["approverUserId"],
            subject="A contract is waiting for your approval",
            headline="Waiting for your approval",
            body=f"{current_user.username} submitted this contract for approval.",
            contract=contract_before_submit,
            contract_id=contract_id,
        )

        logger.info(f"Contract {contract_id} successfully submitted for approval by user {user_id_str}.")
        

        # 5. Return updated contract state
        _forget_cached_contract(contract_id)
        return get_contract(contract_id=contract_id, current_user=current_user)

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Error submitting contract {contract_id}: {e}")
        raise HTTPException(status_code=500, detail="An error occurred while submitting the contract.")
    
#endpoint for approve

@workflows_router.post("/contracts/{contract_id}/approve", response_model=ContractResponse)
async def approve_contract(
    contract_id: str,
    current_user: UserInDB = Depends(get_current_active_user)
):
    """
    Approves a submitted contract. Logs this action.
    """
    logger.info(f"Approve request for contract {contract_id} by user {current_user.id} ({current_user.username})")

    # Ensure collections are initialized (important if db could be None at startup)
    if collection is None or users_collection is None or teams_collection is None:
        logger.error("approve_contract: One or more required collections are not initialized.")
        raise HTTPException(status_code=500, detail="Database service unavailable.")

    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        logger.warning(f"Invalid contract_id format for approve: {contract_id}")
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    # Fetch contract data needed for checks AND for audit log
    # Ensure all fields needed for audit (contract_name, ownerId, ownerType) are fetched
    contract_before = collection.find_one(
        {"_id": contract_oid},
        {
            "ownerType": 1,
            "ownerId": 1, # This is an ObjectId in the DB
            "status": 1,
            "workflowRoles": 1,
            "projectId": 1,
            "submittedBy": 1, # Needed to keep a submitter from approving their own work
            "contract_name": 1 # Important for audit log
        }
    )
    if not contract_before:
        logger.warning(f"Contract not found for approval: {contract_id}")
        raise HTTPException(status_code=404, detail="Contract not found.")

    # --- Your existing Permission and Status Check logic ---
    owner_type = contract_before.get("ownerType")
    owner_id_obj_from_db = contract_before.get("ownerId") # This is an ObjectId from DB
    current_status_before = contract_before.get("status")
    approver_user_id_obj_from_db = _roles_for(contract_before)["approverUserId"] # contract override, else the project default
    
    user_id_obj_for_comparison = ObjectId(current_user.id) # current_user.id is string, convert for DB comparison

    # Permission checks (as you had them)
    is_owner_of_team_contract = (
        owner_type == "team" and 
        owner_id_obj_from_db and # Ensure owner_id_obj_from_db is not None
        current_user.ownedAccountId == str(owner_id_obj_from_db) # Compare string ownedAccountId with string of DB ObjectId
    )
    is_assigned_approver = (approver_user_id_obj_from_db == user_id_obj_for_comparison)

    can_approve = False
    if owner_type == "user":
         raise HTTPException(status_code=400, detail="Approval workflow not applicable to personal documents.")
    elif owner_type == "team":
         if is_owner_of_team_contract or is_assigned_approver:
              can_approve = True
         else:
              # ... (log warning & raise 403) ...
              logger.warning(f"Approve denied for contract {contract_id}: User {current_user.id} is neither Owner nor assigned Approver.")
              raise HTTPException(status_code=403, detail="Only the Account Owner or assigned Approver can approve.")
    
    if current_status_before != "Pending Approval":
         logger.warning(f"Approve denied for contract {contract_id}: Invalid status '{current_status_before}'. Must be 'Pending Approval'.")
         raise HTTPException(status_code=400, detail=f"Cannot approve contract with status '{current_status_before}'.")

    if not can_approve: # Fallback check
         raise HTTPException(status_code=403, detail="Permission denied to approve this contract.")

    # Approving your own submission is not a review. The assigned approver is
    # blocked outright; the account owner may still do it — a small team can be
    # one person — but the override is named in the audit trail rather than
    # passing as an ordinary approval.
    submitted_by_oid = contract_before.get("submittedBy")
    is_self_approval = (
        submitted_by_oid is not None and submitted_by_oid == user_id_obj_for_comparison
    )
    if is_self_approval and not is_owner_of_team_contract:
        logger.warning(
            "Approve denied for contract %s: user %s submitted it and cannot approve it.",
            contract_id, current_user.id,
        )
        raise HTTPException(
            status_code=403,
            detail="You submitted this contract for approval. Someone else must approve it.",
        )
    # --- End Permission Check ---

    # Update Database
    try:
        now = datetime.utcnow()
        # A terminal state of its own. Writing "Ingested" here made an approved
        # contract indistinguishable from one the OCR worker had just finished.
        new_status_after = "Approved"

        update_payload = {
            "status": new_status_after,
            "approvedOrRejectedBy": user_id_obj_for_comparison, # Store ObjectId
            "rejectedReason": None, # Clear any previous rejection reason
            "updatedAt": now
        }
        
        update_result = collection.update_one(
            {"_id": contract_oid},
            {"$set": update_payload}
        )

        if update_result.matched_count == 0:
            logger.error(f"CRITICAL: Contract {contract_id} not found during approve update.")
            # Potentially, the contract was deleted between fetch and update.
            raise HTTPException(status_code=404, detail="Contract not found during approval update.")
        if update_result.modified_count == 0:
            logger.warning(f"Approve action for contract {contract_id} modified 0 documents (status might already be '{new_status_after}' or concurrent update).")
            # This is not necessarily an error if status was already "Completed" by another process.

        # --- Create Audit Log AFTER successful DB update ---
        audit_account_id: Optional[ObjectId] = None
        if owner_type == "team" and owner_id_obj_from_db: # owner_id_obj_from_db is already ObjectId
            audit_account_id = owner_id_obj_from_db
        
        # Call the imported async function
        await create_audit_log(
            user=current_user, # Pass the UserInDB object
            action="SELF_APPROVAL_OVERRIDE" if is_self_approval else "CONTRACT_APPROVED",
            contract_id=contract_oid, # Pass ObjectId
            contract_name_override=contract_before.get("contract_name"), # Pass fetched name
            account_id_override=audit_account_id, # Pass ObjectId if team doc
            # account_name_override will be fetched by create_audit_log if audit_account_id is provided
            details={
                "oldStatus": current_status_before,
                "newStatus": new_status_after,
                "selfApproval": is_self_approval,
                # Add any other relevant details, e.g., version if applicable
            }
        )
        # --- End Audit Log ---

        _notify_role_holder(
            _roles_for(contract_before)["editorUserId"],
            subject="Your contract was approved",
            headline="Approved",
            body=f"{current_user.username} approved this contract.",
            contract=contract_before,
            contract_id=contract_id,
        )

        logger.info(f"Contract {contract_id} successfully approved by user {current_user.id} ({current_user.username}).")
        
        # Return updated contract state (get_contract is async)
        _forget_cached_contract(contract_id)
        return get_contract(contract_id=contract_id, current_user=current_user)

    except HTTPException as he:
        raise he # Re-raise HTTPExceptions
    except Exception as e:
        logger.exception(f"Error during approve_contract operation for {contract_id}: {e}")
        # If audit log fails, the main operation might have succeeded.
        # Consider how to handle this. For now, log and raise 500.
        raise HTTPException(status_code=500, detail="An error occurred while approving the contract.")

#endpoint for rejecting a contract
@workflows_router.post("/contracts/{contract_id}/reject", response_model=ContractResponse)
async def reject_contract(
    contract_id: str,
    request: RejectContractRequest, # Use the new request body model
    current_user: UserInDB = Depends(get_current_active_user)
):
    """
    Rejects a submitted contract by the assigned Approver or Account Owner.
    Changes status to 'Rejected' and optionally stores a reason.
    """
    logger.info(f"Reject request for contract {contract_id} by user {current_user.id}. Reason: {request.reason or 'None provided'}")

    if collection is None or users_collection is None or teams_collection is None:
        raise HTTPException(status_code=500, detail="Database connection failure.")

    # 1. Validate Contract ID
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        logger.warning(f"Invalid contract_id format for reject: {contract_id}")
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    # 2. Fetch contract data needed for checks
    contract_before_reject = collection.find_one(
        {"_id": contract_oid},
        {
            "ownerType": 1,
            "ownerId": 1,
            "status": 1,
            "workflowRoles": 1,
            "projectId": 1,
            "contract_name": 1 
        }
    )
    if not contract_before_reject:
        raise HTTPException(status_code=404, detail="Contract not found.")

    # 3. Permission and Status Check (Identical to /approve)
    owner_type = contract_before_reject.get("ownerType")
    owner_id_obj_from_db = contract_before_reject.get("ownerId")
    owner_id_str = str(owner_id_obj_from_db) if isinstance(owner_id_obj_from_db, ObjectId) else None
    current_status_before = contract_before_reject.get("status")
    approver_user_id_obj = _roles_for(contract_before_reject)["approverUserId"]
    user_oid = ObjectId(current_user.id)
    user_id_str = current_user.id

    is_owner = (owner_type == "team" and owner_id_str == current_user.ownedAccountId)
    is_assigned_approver = (approver_user_id_obj == user_oid)
    can_reject = False

    if owner_type == "user":
        raise HTTPException(status_code=400, detail="Rejection workflow not applicable to personal documents.")
    elif owner_type == "team":
        if is_owner or is_assigned_approver:
             can_reject = True
        else:
             # ... (log warning & raise 403 as in /approve) ...
             raise HTTPException(status_code=403, detail="Only the Account Owner or assigned Approver can reject.")

    if current_status_before != "Pending Approval":
         logger.warning(f"Reject denied for contract {contract_id}: Invalid status '{current_status_before}'. Must be 'Pending Approval'.")
         raise HTTPException(status_code=400, detail=f"Cannot reject contract with status '{current_status_before}'.")

    if not can_reject: # Fallback
         raise HTTPException(status_code=403, detail="Permission denied to reject this contract.")

    # 4. Update Database
    try:
        now = datetime.utcnow()
        update_result = collection.update_one(
            {"_id": contract_oid},
            {"$set": {
                "status": "Rejected", # New status
                "approvedOrRejectedBy": user_oid, # Record rejector (as ObjectId)
                "rejectedReason": request.reason, # Store the reason
                "updatedAt": now # Optionally update timestamp
            }}
        )
        new_status_after = "Rejected"
        
        if update_result.matched_count == 0:
            logger.error(f"CRITICAL: Contract {contract_id} not found during reject update.")
            raise HTTPException(status_code=404, detail="Contract not found during rejection.")
        if update_result.modified_count == 0:
            logger.warning(f"Reject action for contract {contract_id} modified 0 documents (status might already be Rejected?).")

        audit_account_id: Optional[ObjectId] = None
        if owner_type == "team" and isinstance(owner_id_obj_from_db, ObjectId):
            audit_account_id = owner_id_obj_from_db

        await create_audit_log(
            user=current_user,
            action="CONTRACT_REJECTED",
            contract_id=contract_oid,
            contract_name_override=contract_before_reject.get("contract_name"),
            account_id_override=audit_account_id,
            details={
                "oldStatus": current_status_before,
                "newStatus": new_status_after,
                "rejectionReason": request.reason 
            }
        )

        _notify_role_holder(
            _roles_for(contract_before_reject)["editorUserId"],
            subject="A contract was returned to you",
            headline="Returned for changes",
            body=(
                f"{current_user.username} rejected this contract.\n\n"
                f"Reason: {request.reason or 'No reason given.'}"
            ),
            contract=contract_before_reject,
            contract_id=contract_id,
        )

        logger.info(f"Contract {contract_id} successfully rejected by user {user_id_str}.")

        # 5. Return updated contract state
        _forget_cached_contract(contract_id)
        return get_contract(contract_id=contract_id, current_user=current_user)

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Error rejecting contract {contract_id}: {e}")
        raise HTTPException(status_code=500, detail="An error occurred while rejecting the contract.")
    

#Mark as Complete for individual Users
@workflows_router.post("/contracts/{contract_id}/complete", response_model=ContractResponse)
async def complete_personal_contract(
    contract_id: str,
    current_user: UserInDB = Depends(get_current_active_user)
):
    """
    Marks a user's personal contract as completed.
    Changes status to 'Completed' and updates any draft reports to final.
    Only for user-owned documents.
    """
    logger.info(f"Mark as Complete request for contract {contract_id} by user {current_user.id}")

    # Validate Contract ID
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        logger.warning(f"Invalid contract_id format for complete: {contract_id}")
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    # Fetch contract data
    contract_before = collection.find_one(
        {"_id": contract_oid},
        {
            "ownerType": 1,
            "ownerId": 1,
            "status": 1,
            "contract_name": 1,
        }
    )
    if not contract_before:
        raise HTTPException(status_code=404, detail="Contract not found.")

    # Permission Check
    owner_type = contract_before.get("ownerType")
    owner_id = contract_before.get("ownerId")
    current_status = contract_before.get("status")
    user_oid = ObjectId(current_user.id)

    if not (owner_type == "user" and owner_id == user_oid):
        raise HTTPException(
            status_code=403,
            detail="This action is only valid for your personal documents."
        )

    # Status Check
    allowed_statuses = ["Ready to Edit", "Editing", "Ingested"]
    if current_status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot complete contract with status '{current_status}'"
        )

    try:
        now = datetime.utcnow()
        update_payload = {
            "status": "Approved",
            "updatedAt": now
        }

        update_result = collection.update_one(
            {"_id": contract_oid},
            {"$set": update_payload},
        )

        if update_result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Contract not found during completion.")

        # Create Audit Log
        await create_audit_log(
            user=current_user,
            action="PERSONAL_CONTRACT_COMPLETED",
            contract_id=contract_oid,
            contract_name_override=contract_before.get("contract_name"),
            details={
                "oldStatus": current_status,
                "newStatus": "Approved",
            }
        )

        logger.info(f"Personal contract {contract_id} marked as completed by user {current_user.id}")
        _forget_cached_contract(contract_id)
        return get_contract(contract_id=contract_id, current_user=current_user)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error completing contract {contract_id}: {e}")
        raise HTTPException(status_code=500, detail="An error occurred while completing the contract.")
    
#======================================================================
# Endpoint 1: For an Editor/User to Request a Re-edit
#======================================================================
@workflows_router.post("/contracts/{contract_id}/request-reedit", response_model=ContractResponse, tags=["Workflow Actions"])
async def request_reedit_contract(
    contract_id: str,
    request: ReEditRequest,
    current_user: UserInDB = Depends(get_current_active_user)
):
    """
    Allows an editor or owner to request re-editing a 'Completed' contract.
    - For team accounts, this moves the status to 'Pending Re-edit Approval'.
    - For individual accounts, this moves the status directly to 'Editing'.
    """
    logger.info(f"Re-edit request for contract {contract_id} by user {current_user.id}")

    if collection is None:
        raise HTTPException(status_code=500, detail="Database connection failure.")

    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    # Fetch the contract with all necessary fields for checks and audit
    contract_before = collection.find_one({"_id": contract_oid})
    if not contract_before:
        raise HTTPException(status_code=404, detail="Contract not found.")

    # 1. Permission and Status Check
    current_status_before = contract_before.get("status")
    # "Completed" is legacy: no code path writes it any more, but documents from
    # older releases still carry it, and they must stay re-editable.
    reeditable_statuses = ("Approved", "Completed")
    if current_status_before not in reeditable_statuses:
        logger.warning(f"Re-edit request denied for {contract_id}: Invalid status '{current_status_before}'.")
        raise HTTPException(status_code=400, detail=f"Cannot request re-edit on a contract with status '{current_status_before}'.")

    owner_type = contract_before.get("ownerType")
    owner_id_obj = contract_before.get("ownerId")
    user_oid = ObjectId(current_user.id)
    now = datetime.utcnow()
    
    update_payload = {}
    audit_action = ""
    audit_details = {}
    new_status_after = ""

    # 2. Handle Logic Based on Account Type
    # --- INDIVIDUAL (Non-Pro) WORKFLOW ---
    if owner_type == "user":
        if owner_id_obj != user_oid:
            raise HTTPException(status_code=403, detail="You do not have permission to edit this personal document.")
        
        new_status_after = "Editing"
        update_payload = {"$set": {"status": new_status_after, "updatedAt": now}}
        # We can also unset the reEditRequest field if it exists from a previous cycle
        update_payload["$unset"] = {"reEditRequest": ""}
        
        audit_action = "REEDIT_BYPASSED_APPROVAL"
        audit_details = {"oldStatus": current_status_before, "newStatus": new_status_after, "reason": request.reason}

    # --- TEAM (Pro) WORKFLOW ---
    elif owner_type == "team":
        editor_user_id_obj = _roles_for(contract_before)["editorUserId"]
        if editor_user_id_obj != user_oid:
            raise HTTPException(status_code=403, detail="Only the assigned editor can request to re-edit this contract.")

        new_status_after = "Pending Re-edit Approval"
        update_payload = {
            "$set": {
                "status": new_status_after,
                "reEditRequest": {
                    "requestedByUserId": user_oid,
                    "reason": request.reason,
                    "requestedAt": now,
                    "denialReason": None, # Explicitly clear any previous denial reason
                    "reviewedByUserId": None,
                    "reviewedAt": None
                },
                "updatedAt": now
            }
        }
        audit_action = "REEDIT_REQUESTED"
        audit_details = {"oldStatus": current_status_before, "newStatus": new_status_after, "reason": request.reason}
    
    else:
        raise HTTPException(status_code=500, detail="Invalid owner type found on contract.")

    # 3. Update Database and Create Audit Log
    try:
        update_result = collection.update_one({"_id": contract_oid}, update_payload)
        
        if update_result.modified_count == 0:
             logger.warning(f"Re-edit request for {contract_id} modified 0 documents.")

        await create_audit_log(
            user=current_user,
            action=audit_action,
            contract_id=contract_oid,
            contract_name_override=contract_before.get("contract_name"),
            account_id_override=owner_id_obj if owner_type == "team" else None,
            details=audit_details
        )
        if new_status_after == "Pending Re-edit Approval":
            _notify_role_holder(
                _roles_for(contract_before)["approverUserId"],
                subject="A re-edit request is waiting for you",
                headline="Re-edit requested",
                body=(
                    f"{current_user.username} asked to reopen this approved contract.\n\n"
                    f"Reason: {request.reason}"
                ),
                contract=contract_before,
                contract_id=contract_id,
            )

        logger.info(f"Contract {contract_id} re-edit request processed. New status: {new_status_after}")
        
        _forget_cached_contract(contract_id)
        return get_contract(contract_id=contract_id, current_user=current_user)
    except Exception as e:
        logger.exception(f"Error processing re-edit request for contract {contract_id}: {e}")
        raise HTTPException(status_code=500, detail="An error occurred during the re-edit request.")


#======================================================================
# Endpoint 2: For an Approver to Approve a Re-edit Request
#======================================================================
@workflows_router.post("/contracts/{contract_id}/approve-reedit", response_model=ContractResponse, tags=["Workflow Actions"])
async def approve_reedit_request(
    contract_id: str,
    current_user: UserInDB = Depends(get_current_active_user)
):
    """Approves a request to re-edit a completed contract (Team accounts only)."""
    logger.info(f"Approve re-edit request for contract {contract_id} by user {current_user.id}")

    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract_before = collection.find_one({"_id": contract_oid})
    if not contract_before:
        raise HTTPException(status_code=404, detail="Contract not found.")

    # 1. Permission and Status Check
    if contract_before.get("ownerType") != "team":
        raise HTTPException(status_code=400, detail="This action is only applicable to team-owned contracts.")
    if contract_before.get("status") != "Pending Re-edit Approval":
        raise HTTPException(status_code=400, detail="Contract is not awaiting re-edit approval.")

    approver_user_id_obj = _roles_for(contract_before)["approverUserId"]
    owner_id_str = str(contract_before.get("ownerId"))
    user_oid = ObjectId(current_user.id)
    is_owner = (owner_id_str == current_user.ownedAccountId)
    is_assigned_approver = (approver_user_id_obj == user_oid)

    if not (is_owner or is_assigned_approver):
        raise HTTPException(status_code=403, detail="Only the Account Owner or assigned Approver can approve this request.")

    # 2. Update Database and Create Audit Log
    try:
        now = datetime.utcnow()
        collection.update_one(
            {"_id": contract_oid},
            {"$set": {
                "status": "Editing",
                "updatedAt": now,
                "reEditRequest.reviewedByUserId": user_oid,
                "reEditRequest.reviewedAt": now
            }}
        )
        
        await create_audit_log(
            user=current_user,
            action="REEDIT_APPROVED",
            contract_id=contract_oid,
            contract_name_override=contract_before.get("contract_name"),
            account_id_override=contract_before.get("ownerId"),
            details={"oldStatus": "Pending Re-edit Approval", "newStatus": "Editing"}
        )
        
        _notify_role_holder(
            _roles_for(contract_before)["editorUserId"],
            subject="Your re-edit request was approved",
            headline="Reopened for editing",
            body=f"{current_user.username} approved your request to reopen this contract.",
            contract=contract_before,
            contract_id=contract_id,
        )

        logger.info(f"Re-edit request for {contract_id} approved by {current_user.id}.")
        _forget_cached_contract(contract_id)
        return get_contract(contract_id=contract_id, current_user=current_user)
    except Exception as e:
        logger.exception(f"Error approving re-edit for contract {contract_id}: {e}")
        raise HTTPException(status_code=500, detail="An error occurred while approving the re-edit request.")


#======================================================================
# Endpoint 3: For an Approver to Deny a Re-edit Request
#======================================================================
@workflows_router.post("/contracts/{contract_id}/deny-reedit", response_model=ContractResponse, tags=["Workflow Actions"])
async def deny_reedit_request(
    contract_id: str,
    request: DenyReEditRequest,
    current_user: UserInDB = Depends(get_current_active_user)
):
    """Denies a request to re-edit a completed contract (Team accounts only)."""
    logger.info(f"Deny re-edit request for contract {contract_id} by user {current_user.id}")

    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract_before = collection.find_one({"_id": contract_oid})
    if not contract_before:
        raise HTTPException(status_code=404, detail="Contract not found.")

    # 1. Permission and Status Check (Identical to approve-reedit)
    if contract_before.get("ownerType") != "team":
        raise HTTPException(status_code=400, detail="This action is only applicable to team-owned contracts.")
    if contract_before.get("status") != "Pending Re-edit Approval":
        raise HTTPException(status_code=400, detail="Contract is not awaiting re-edit approval.")

    approver_user_id_obj = _roles_for(contract_before)["approverUserId"]
    owner_id_str = str(contract_before.get("ownerId"))
    user_oid = ObjectId(current_user.id)
    is_owner = (owner_id_str == current_user.ownedAccountId)
    is_assigned_approver = (approver_user_id_obj == user_oid)

    if not (is_owner or is_assigned_approver):
        raise HTTPException(status_code=403, detail="Only the Account Owner or assigned Approver can deny this request.")

    # 2. Update Database and Create Audit Log
    try:
        now = datetime.utcnow()
        new_status_after = "Re-edit Denied"
        collection.update_one(
            {"_id": contract_oid},
            {"$set": {
                "status": new_status_after, # Revert status
                "updatedAt": now,
                "reEditRequest.denialReason": request.reason,
                "reEditRequest.reviewedByUserId": user_oid,
                "reEditRequest.reviewedAt": now
            }}
        )
        
        await create_audit_log(
            user=current_user,
            action="REEDIT_DENIED",
            contract_id=contract_oid,
            contract_name_override=contract_before.get("contract_name"),
            account_id_override=contract_before.get("ownerId"),
            details={
                "oldStatus": "Pending Re-edit Approval",
                "newStatus": new_status_after,
                "denialReason": request.reason
            }
        )
        
        _notify_role_holder(
            _roles_for(contract_before)["editorUserId"],
            subject="Your re-edit request was denied",
            headline="Re-edit denied",
            body=(
                f"{current_user.username} denied your request to reopen this contract.\n\n"
                f"Reason: {request.reason}"
            ),
            contract=contract_before,
            contract_id=contract_id,
        )

        logger.info(f"Re-edit request for {contract_id} denied by {current_user.id}. New status: {new_status_after}")
        _forget_cached_contract(contract_id)
        return get_contract(contract_id=contract_id, current_user=current_user)
    except Exception as e:
        logger.exception(f"Error denying re-edit for contract {contract_id}: {e}")
        raise HTTPException(status_code=500, detail="An error occurred while denying the re-edit request.")

@workflows_router.post("/contracts/{contract_id}/acknowledge-denial", response_model=ContractResponse, tags=["Workflow Actions"])
async def acknowledge_reedit_denial(
    contract_id: str,
    current_user: UserInDB = Depends(get_current_active_user)
):
    """
    Acknowledges a re-edit denial.
    Changes status from 'Re-edit Denied' to 'Completed'.
    This is called when the editor views the denied contract.
    """
    logger.info(f"Re-edit denial for {contract_id} acknowledged by user {current_user.id}")

    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract_before = collection.find_one({"_id": contract_oid})
    if not contract_before:
        raise HTTPException(status_code=404, detail="Contract not found.")

    # Permission Check: Only the assigned editor can acknowledge.
    editor_user_id_obj = _roles_for(contract_before)["editorUserId"]
    if ObjectId(current_user.id) != editor_user_id_obj:
        raise HTTPException(status_code=403, detail="Only the assigned editor can acknowledge this denial.")

    # Status Check: Must be in the correct state.
    if contract_before.get("status") != "Re-edit Denied":
        # If it's already Ingested, we don't need to do anything. Just return the contract.
        if contract_before.get("status") in ["Approved", "Completed", "Ingested"]:
            _forget_cached_contract(contract_id)
            return get_contract(contract_id=contract_id, current_user=current_user)
        raise HTTPException(status_code=400, detail="This contract is not in a 'Re-edit Denied' state.")

    # Update the status to 'Ingested'
    collection.update_one(
        {"_id": contract_oid},
        {"$set": {"status": "Approved", "updatedAt": datetime.utcnow()}}
    )
    
    await create_audit_log(
        user=current_user,
        action="REEDIT_DENIAL_ACKNOWLEDGED",
        contract_id=contract_oid,
        details={"oldStatus": "Re-edit Denied", "newStatus": "Approved"}
    )
    
    _forget_cached_contract(contract_id)
    return get_contract(contract_id=contract_id, current_user=current_user)


