import logging
from typing import Dict, Any, Optional
from datetime import datetime
from pymongo import DESCENDING, ASCENDING 
from bson import ObjectId
from models.domain import UserInDB

logger = logging.getLogger(__name__)

# Global variables for collection instances; they will be set by init_audit_collections
audit_logs_collection_global = None
contracts_collection_global = None # For fetching contract_name
teams_collection_global = None     # For fetching account_name (if ownerType is 'team')
users_collection_global = None   # Not strictly needed if UserInDB always has username

def init_audit_collections(
    db_instance, # Pass the main PyMongo database instance (e.g., db from client["contract_analysis_db"])
    audit_coll_name: str = "audit_logs",
    contracts_coll_name: str = "contracts",
    teams_coll_name: str = "teams",
    users_coll_name: str = "users"
):
    """
    Initializes global collection variables for the audit logger and creates indexes.
    This should be called once at application startup after the main DB connection is established.
    """
    global audit_logs_collection_global, contracts_collection_global, teams_collection_global, users_collection_global
    
    if db_instance is None:
        logger.error("Database instance (db_instance) is None. Audit logger collections cannot be initialized.")
        return

    audit_logs_collection_global = db_instance[audit_coll_name]
    contracts_collection_global = db_instance[contracts_coll_name]
    teams_collection_global = db_instance[teams_coll_name]
    users_collection_global = db_instance[users_coll_name]

    if audit_logs_collection_global is not None:
        try:
            logger.info("Initializing audit log indexes from audit_logger.py...")
            audit_logs_collection_global.create_index([("timestamp", DESCENDING)])
            audit_logs_collection_global.create_index([("userId", ASCENDING)])
            audit_logs_collection_global.create_index([("action", ASCENDING)])
            audit_logs_collection_global.create_index([("contractId", ASCENDING)])
            audit_logs_collection_global.create_index([("accountId", ASCENDING)])
            logger.info("Audit log indexes created/verified successfully from audit_logger.py.")
        except Exception as e:
            logger.error(f"AUDIT_LOGGER: Error creating audit log indexes: {e}")
    else:
        logger.error("AUDIT_LOGGER: audit_logs_collection_global is None after assignment. Indexes not created.")

    # Verification logs for all collections
    if contracts_collection_global is None:
        logger.warning("AUDIT_LOGGER: contracts_collection_global is None. May affect fetching contract names.")
    else:
        logger.info("AUDIT_LOGGER: contracts_collection_global initialized successfully.")

    if teams_collection_global is None:
        logger.warning("AUDIT_LOGGER: teams_collection_global is None. May affect fetching account names.")
    else:
        logger.info("AUDIT_LOGGER: teams_collection_global initialized successfully.")

    if users_collection_global is None: 
        logger.warning("AUDIT_LOGGER: users_collection_global is None. May affect user-related lookups if needed directly by audit logger.")
    else:
        logger.info("AUDIT_LOGGER: users_collection_global initialized successfully.")



async def create_audit_log(
    user: UserInDB,
    action: str,
    contract_id: Optional[ObjectId] = None,
    contract_name_override: Optional[str] = None,
    account_id_override: Optional[ObjectId] = None, # Expect ObjectId if overridden
    account_name_override: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    # TODO: Consider adding ip_address, user_agent if obtainable from request context
    # You might need to pass the FastAPI `Request` object or extract these earlier
):
    """
    Creates an audit log entry.
    Uses globally initialized collections.
    This function is async because fetching names MIGHT become async if you switch to Motor for those collections.
    However, the actual insert into audit_logs is currently synchronous via audit_logs_collection_global.
    """
    global audit_logs_collection_global, contracts_collection_global, teams_collection_global, users_collection_global

    if audit_logs_collection_global is None:
        try:
            logger.info("AUDIT_LOGGER: Global collection is None. Attempting lazy initialization...")
            from core.database import db
            init_audit_collections(db)
        except Exception as e:
            logger.error(f"AUDIT_LOGGER: Failed to lazily initialize audit collections: {e}")

    if audit_logs_collection_global is None: # Explicitly compare with None
        logger.error("Audit log collection (audit_logs_collection_global) is not available. Skipping audit log.")
        return

    log_entry: Dict[str, Any] = {
        "timestamp": datetime.utcnow(),
        "userId": ObjectId(user.id) if user and user.id and ObjectId.is_valid(user.id) else None, # Store as ObjectId
        "username": user.username if user and hasattr(user, 'username') else "System", # hasattr for safety
        "action": action,
        "details": details or {},
    }

    final_contract_name: Optional[str] = contract_name_override
    final_account_id: Optional[ObjectId] = account_id_override # Assumed to be ObjectId if provided
    final_account_name: Optional[str] = account_name_override

    # Fetch contract details if contract_id is provided and names/account info are not overridden
    if contract_id:
        log_entry["contractId"] = contract_id # Store as ObjectId
        if (not final_contract_name or (not final_account_id and not account_name_override)) and contracts_collection_global is not None:
            try:
                # Using synchronous PyMongo collection for this lookup
                contract_doc = contracts_collection_global.find_one(
                    {"_id": contract_id},
                    {"contract_name": 1, "ownerType": 1, "ownerId": 1} # ownerId here is ObjectId
                )
                if contract_doc:
                    if not final_contract_name:
                        final_contract_name = contract_doc.get("contract_name")
                    
                    # If account_id wasn't overridden, try to get it from the contract
                    if not final_account_id and contract_doc.get("ownerType") == "team":
                        owner_id_val = contract_doc.get("ownerId") # This should be an ObjectId from the DB
                        if isinstance(owner_id_val, ObjectId):
                            final_account_id = owner_id_val
                        # No need to convert from string here as DB stores ObjectId for ownerId
                else:
                    logger.warning(f"Audit log: Contract {contract_id} not found for name/owner lookup.")
            except Exception as e:
                logger.error(f"Audit log: Error fetching contract details for {contract_id}: {e}")
        
        # If we have an account ID (either overridden or from contract) but no account name, fetch it
        if final_account_id and not final_account_name and teams_collection_global is not None:
            try:
                # Using synchronous PyMongo collection for this lookup
                account_doc = teams_collection_global.find_one({"_id": final_account_id}, {"name": 1})
                if account_doc:
                    final_account_name = account_doc.get("name")
                else:
                    logger.warning(f"Audit log: Account {final_account_id} not found for name lookup.")
            except Exception as e:
                logger.error(f"Audit log: Error fetching account name for {final_account_id}: {e}")

    # Populate the log entry with resolved names and IDs
    if final_contract_name:
        log_entry["contractName"] = final_contract_name
    if final_account_id: # Already ObjectId
        log_entry["accountId"] = final_account_id
    if final_account_name:
        log_entry["accountName"] = final_account_name
    
    try:
        # Using synchronous PyMongo collection for insert
        audit_logs_collection_global.insert_one(log_entry)
        log_details_summary = str(log_entry['details'])[:200] # Summary for concise logging
        logger.info(
            f"AUDIT: User '{log_entry.get('username', 'N/A')}' "
            f"action '{action}' on Contract '{str(contract_id) if contract_id else 'N/A'}' "
            f"Account '{str(final_account_id) if final_account_id else 'N/A'}'. "
            f"Details: {log_details_summary}{'...' if len(str(log_entry['details'])) > 200 else ''}"
        )
    except Exception as e:
        logger.error(f"Failed to create audit log: {e}. Entry structure: {log_entry}")