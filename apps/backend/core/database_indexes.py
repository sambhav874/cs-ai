# database_indexes.py
from pymongo import ASCENDING, DESCENDING, TEXT
from pymongo.errors import DuplicateKeyError, OperationFailure
import logging

# Set up logging
logger = logging.getLogger(__name__)

def initialize_all_indexes(db):
    """
    Initialize all MongoDB indexes with proper error handling.
    Skips index creation if duplicates exist rather than failing.
    """
    try:
        # Contracts collection indexes
        contracts = db["contracts"]
        
        # Compound Index for list_documents (status + uploaded_at)
        _create_index_safe(
            contracts,
            [("status", ASCENDING), ("uploaded_at", DESCENDING)],
            "status_uploaded_at"
        )
        
        # Compound index for owner multi-filter
        _create_index_safe(
            contracts,
            [("ownerType", ASCENDING), ("ownerId", ASCENDING), ("status", ASCENDING)],
            "owner_status_filter"
        )
        
        # Workflow roles indexes
        _create_index_safe(
            contracts,
            [("workflowRoles.editorUserId", ASCENDING)],
            "editor_id"
        )
        _create_index_safe(
            contracts,
            [("workflowRoles.approverUserId", ASCENDING)],
            "approver_id"
        )
        
        _create_index_safe(
            contracts,
            [("ownerType", ASCENDING), ("ownerId", ASCENDING)],
            "ownerType_ownerId"
        )
        _create_index_safe(
            contracts,
            [("uploaded_at", DESCENDING)],
            "uploaded_at_desc"
        )
        _create_index_safe(
            contracts,
            [("contract_name", TEXT)],
            "contract_name_text"
        )
        _create_index_safe(
            contracts,
            [("process.status", ASCENDING)],
            "process.status"
        )
        _create_index_safe(
            contracts,
            [("process.results.version", DESCENDING)],
            "process.results.version_desc"
        )
        _create_index_safe(
            contracts,
            [("file_id", ASCENDING)],
            "file_id"
        )
        _create_index_safe(
            contracts,
            [("projectId", ASCENDING), ("uploaded_at", DESCENDING)],
            "project_uploaded_at"
        )
        _create_index_safe(
            contracts,
            [("ownerType", ASCENDING), ("ownerId", ASCENDING), ("projectId", ASCENDING), ("uploaded_at", DESCENDING)],
            "owner_project_uploaded_at"
        )
        _create_index_safe(
            contracts,
            [("ownerType", ASCENDING), ("ownerId", ASCENDING), ("projectId", ASCENDING), ("status", ASCENDING), ("uploaded_at", DESCENDING)],
            "owner_project_status_uploaded_at"
        )
        _create_index_safe(
            contracts,
            [("uploaded_by", ASCENDING), ("status", ASCENDING), ("uploaded_at", DESCENDING)],
            "uploader_status_uploaded_at"
        )
        _create_index_safe(
            contracts,
            [("workflowRoles.editorUserId", ASCENDING), ("status", ASCENDING), ("uploaded_at", DESCENDING)],
            "editor_status_uploaded_at"
        )
        _create_index_safe(
            contracts,
            [("workflowRoles.approverUserId", ASCENDING), ("status", ASCENDING), ("uploaded_at", DESCENDING)],
            "approver_status_uploaded_at"
        )

        # Projects collection indexes
        projects = db["projects"]
        _create_index_safe(
            projects,
            [("ownerType", ASCENDING), ("ownerId", ASCENDING), ("updatedAt", DESCENDING)],
            "project_owner_updated"
        )
        _create_index_safe(
            projects,
            [("ownerType", ASCENDING), ("ownerId", ASCENDING), ("name", ASCENDING)],
            "project_owner_name"
        )

        # Tabular reviews
        tabular_reviews = db["tabular_reviews"]
        _create_index_safe(
            tabular_reviews,
            [("userId", ASCENDING), ("updatedAt", DESCENDING)],
            "tabular_reviews_user_updated"
        )
        _create_index_safe(
            tabular_reviews,
            [("projectId", ASCENDING), ("updatedAt", DESCENDING)],
            "tabular_reviews_project_updated"
        )

        tabular_cells = db["tabular_cells"]
        _create_unique_index_safe(
            tabular_cells,
            [("reviewId", ASCENDING), ("documentId", ASCENDING), ("columnIndex", ASCENDING)],
            "tabular_cells_review_doc_column_unique"
        )
        _create_index_safe(
            tabular_cells,
            [("reviewId", ASCENDING), ("documentId", ASCENDING), ("columnIndex", ASCENDING)],
            "tabular_cells_review_doc_column"
        )

        # Playbooks
        playbooks = db["playbooks"]
        _create_index_safe(
            playbooks,
            [("userId", ASCENDING), ("updatedAt", DESCENDING)],
            "playbooks_user_updated"
        )
        _create_index_safe(
            playbooks,
            [("projectId", ASCENDING), ("visibility", ASCENDING), ("updatedAt", DESCENDING)],
            "playbooks_project_visibility_updated"
        )
        _create_index_safe(
            playbooks,
            [("grants.userId", ASCENDING), ("updatedAt", DESCENDING)],
            "playbooks_grants_user_updated"
        )

        playbook_runs = db["playbook_runs"]
        _create_index_safe(
            playbook_runs,
            [("playbookId", ASCENDING), ("createdAt", DESCENDING)],
            "playbook_runs_playbook_created"
        )
        _create_index_safe(
            playbook_runs,
            [("contractIds", ASCENDING), ("createdAt", DESCENDING)],
            "playbook_runs_contract_created"
        )

        playbook_findings = db["playbook_findings"]
        _create_index_safe(
            playbook_findings,
            [("runId", ASCENDING), ("documentId", ASCENDING), ("ruleId", ASCENDING)],
            "playbook_findings_run_doc_rule"
        )
        _create_index_safe(
            playbook_findings,
            [("playbookId", ASCENDING), ("status", ASCENDING), ("updatedAt", DESCENDING)],
            "playbook_findings_playbook_status_updated"
        )

        # ContractSense deep agent workflow collections
        agent_runs = db["agent_runs"]
        _create_unique_index_safe(
            agent_runs,
            [("workflow_id", ASCENDING)],
            "agent_runs_workflow_unique"
        )
        _create_index_safe(
            agent_runs,
            [("user_id", ASCENDING), ("updated_at", DESCENDING)],
            "agent_runs_user_updated"
        )
        _create_index_safe(
            agent_runs,
            [("context.project_id", ASCENDING), ("updated_at", DESCENDING)],
            "agent_runs_project_updated"
        )

        agent_trace_events = db["agent_trace_events"]
        _create_index_safe(
            agent_trace_events,
            [("workflow_id", ASCENDING), ("created_at", ASCENDING)],
            "agent_trace_workflow_created"
        )

        agent_approvals = db["agent_approvals"]
        _create_unique_index_safe(
            agent_approvals,
            [("approval_id", ASCENDING)],
            "agent_approvals_id_unique"
        )
        _create_index_safe(
            agent_approvals,
            [("workflow_id", ASCENDING), ("status", ASCENDING)],
            "agent_approvals_workflow_status"
        )

        agent_cost_events = db["agent_cost_events"]
        _create_index_safe(
            agent_cost_events,
            [("workflow_id", ASCENDING), ("created_at", ASCENDING)],
            "agent_cost_workflow_created"
        )

        agent_workflow_checkpoints = db["agent_workflow_checkpoints"]
        _create_index_safe(
            agent_workflow_checkpoints,
            [("workflow_id", ASCENDING), ("created_at", DESCENDING)],
            "agent_checkpoints_workflow_created"
        )

        agent_document_edits = db["agent_document_edits"]
        _create_unique_index_safe(
            agent_document_edits,
            [("edit_id", ASCENDING)],
            "agent_document_edits_id_unique"
        )
        _create_index_safe(
            agent_document_edits,
            [("document_id", ASCENDING), ("user_id", ASCENDING), ("status", ASCENDING)],
            "agent_document_edits_doc_user_status"
        )
        _create_index_safe(
            agent_document_edits,
            [("version_id", ASCENDING), ("created_at", ASCENDING)],
            "agent_document_edits_version_created"
        )

        # Users collection indexes
        users = db["users"]
        _create_unique_index_safe(
            users,
            "username",
            "username_unique"
        )
        _create_unique_index_safe(
            users,
            "email",
            "email_unique"
        )
        _create_index_safe(
            users,
            "teamIds",
            "teamIds"
        )

        # Teams collection indexes
        teams = db["teams"]
        _create_index_safe(
            teams,
            "name",
            "name"
        )
        _create_index_safe(
            teams,
            "memberIds",
            "memberIds"
        )
        _create_index_safe(
            teams,
            "members.userId",
            "members_userId"
        )

        # Accounts collection indexes
        accounts = db["accounts"]
        _create_unique_index_safe(
            accounts,
            "user_id",
            "user_id_unique"
        )

        # Revoked tokens (JWT blocklist) \u2014 TTL auto-purges expired entries.
        # The `expireAfterSeconds=0` means MongoDB deletes documents exactly at `expires_at`.
        revoked_tokens = db["revoked_tokens"]
        _create_unique_index_safe(
            revoked_tokens,
            "jti",
            "revoked_tokens_jti_unique"
        )
        try:
            revoked_tokens.create_index(
                "expires_at",
                expireAfterSeconds=0,
                name="revoked_tokens_expires_at_ttl",
            )
            logger.debug("Created TTL index revoked_tokens_expires_at_ttl on revoked_tokens")
        except Exception as ttl_err:
            if "already exists" not in str(ttl_err):
                logger.warning(f"Failed to create TTL index on revoked_tokens: {ttl_err}")

        # Vouchers \u2014 unique per issuing user to prevent TOCTOU duplicates.
        vouchers = db["vouchers"]
        _create_unique_index_safe(
            vouchers,
            "created_for_user_id",
            "vouchers_created_for_user_id_unique"
        )

        # Jobs collection indexes
        jobs = db["jobs"]
        _create_index_safe(
            jobs,
            [("contract_id", ASCENDING), ("updated_at", DESCENDING), ("created_at", DESCENDING)],
            "job_contract_latest"
        )

        # Agent memory / chat indexes
        agent_chat_sessions = db["agent_chat_sessions"]
        _create_unique_index_safe(
            agent_chat_sessions,
            [("session_id", ASCENDING), ("contract_id", ASCENDING), ("user_id", ASCENDING)],
            "agent_session_contract_user_unique"
        )
        _create_index_safe(
            agent_chat_sessions,
            [("contract_id", ASCENDING), ("user_id", ASCENDING), ("updated_at", DESCENDING)],
            "agent_sessions_contract_user_updated"
        )

        agent_chat_messages = db["agent_chat_messages"]
        _create_index_safe(
            agent_chat_messages,
            [("session_id", ASCENDING), ("contract_id", ASCENDING), ("user_id", ASCENDING), ("created_at", ASCENDING)],
            "agent_messages_session_order"
        )

        agent_memories = db["agent_memories"]
        _create_unique_index_safe(
            agent_memories,
            [("contract_id", ASCENDING), ("user_id", ASCENDING), ("memory_key", ASCENDING)],
            "agent_memory_contract_user_key_unique"
        )
        _create_index_safe(
            agent_memories,
            [("contract_id", ASCENDING), ("user_id", ASCENDING), ("updated_at", DESCENDING)],
            "agent_memory_contract_user_updated"
        )

        agent_drafts = db["agent_drafts"]
        _create_index_safe(
            agent_drafts,
            [("contract_id", ASCENDING), ("user_id", ASCENDING), ("updated_at", DESCENDING)],
            "agent_drafts_contract_user_updated"
        )

        # KPI register indexes
        contract_kpis = db["contract_kpis"]
        _create_unique_index_safe(
            contract_kpis,
            [("kpi_id", ASCENDING)],
            "kpi_id_unique"
        )
        _create_index_safe(
            contract_kpis,
            [("contract_id", ASCENDING), ("status", ASCENDING), ("kpi_type", ASCENDING)],
            "kpis_contract_status_type"
        )
        _create_index_safe(
            contract_kpis,
            [("project_id", ASCENDING), ("status", ASCENDING), ("kpi_type", ASCENDING)],
            "kpis_project_status_type"
        )
        _create_index_safe(
            contract_kpis,
            [("document_id", ASCENDING), ("page_start", ASCENDING)],
            "kpis_document_page"
        )

        contract_kpi_actuals = db["contract_kpi_actuals"]
        _create_index_safe(
            contract_kpi_actuals,
            [("kpi_id", ASCENDING), ("timestamp", DESCENDING)],
            "kpi_actuals_latest"
        )
        _create_index_safe(
            contract_kpi_actuals,
            [("contract_id", ASCENDING), ("timestamp", DESCENDING), ("created_at", DESCENDING)],
            "kpi_actuals_contract_timeline"
        )

        contract_kpi_breaches = db["contract_kpi_breaches"]
        _create_index_safe(
            contract_kpi_breaches,
            [("contract_id", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)],
            "kpi_breaches_contract_status"
        )

        contract_kpi_extraction_runs = db["contract_kpi_extraction_runs"]
        _create_index_safe(
            contract_kpi_extraction_runs,
            [("contract_id", ASCENDING), ("started_at", DESCENDING)],
            "kpi_runs_contract_started"
        )

        contract_kpi_source_configs = db["contract_kpi_source_configs"]
        _create_index_safe(
            contract_kpi_source_configs,
            [("contract_id", ASCENDING), ("updated_at", DESCENDING)],
            "kpi_source_configs_contract_updated"
        )
        _create_index_safe(
            contract_kpi_source_configs,
            [("enabled", ASCENDING), ("next_run_at", ASCENDING)],
            "kpi_source_configs_due_fetches"
        )

        contract_kpi_fetch_runs = db["contract_kpi_fetch_runs"]
        _create_index_safe(
            contract_kpi_fetch_runs,
            [("contract_id", ASCENDING), ("source_config_id", ASCENDING), ("started_at", DESCENDING)],
            "kpi_fetch_runs_source_started"
        )

        _create_index_safe(
            contract_kpi_actuals,
            [("contract_id", ASCENDING), ("metadata.source_config_id", ASCENDING), ("metadata.source_dedupe_key", ASCENDING)],
            "kpi_actuals_source_dedupe"
        )

        contract_kpi_metric_catalog = db["contract_kpi_metric_catalog"]
        _create_unique_index_safe(
            contract_kpi_metric_catalog,
            [("project_id", ASCENDING), ("metric_key", ASCENDING)],
            "kpi_metric_catalog_project_key_unique"
        )

        contract_kpi_governance_events = db["contract_kpi_governance_events"]
        _create_index_safe(
            contract_kpi_governance_events,
            [("contract_id", ASCENDING), ("kpi_id", ASCENDING), ("created_at", DESCENDING)],
            "kpi_governance_contract_kpi_created"
        )
        _create_index_safe(
            contract_kpi_governance_events,
            [("project_id", ASCENDING), ("metric_key", ASCENDING), ("created_at", DESCENDING)],
            "kpi_governance_project_metric_created"
        )

        contract_kpi_integration_profiles = db["contract_kpi_integration_profiles"]
        _create_unique_index_safe(
            contract_kpi_integration_profiles,
            [("profile_id", ASCENDING)],
            "kpi_integration_profile_id_unique"
        )
        _create_index_safe(
            contract_kpi_integration_profiles,
            [("owner_account_id", ASCENDING), ("source_type", ASCENDING), ("status", ASCENDING)],
            "kpi_integration_owner_source_status"
        )

        contract_kpi_alert_rules = db["contract_kpi_alert_rules"]
        _create_unique_index_safe(
            contract_kpi_alert_rules,
            [("contract_id", ASCENDING), ("rule_id", ASCENDING)],
            "kpi_alert_rules_contract_rule_unique"
        )
        _create_index_safe(
            contract_kpi_alert_rules,
            [("contract_id", ASCENDING), ("event_type", ASCENDING), ("active", ASCENDING)],
            "kpi_alert_rules_contract_event_active"
        )

        contract_kpi_alerts = db["contract_kpi_alerts"]
        _create_unique_index_safe(
            contract_kpi_alerts,
            [("alert_key", ASCENDING)],
            "kpi_alert_key_unique"
        )
        _create_index_safe(
            contract_kpi_alerts,
            [("project_id", ASCENDING), ("status", ASCENDING), ("last_seen_at", DESCENDING)],
            "kpi_alerts_project_status_seen"
        )
        _create_index_safe(
            contract_kpi_alerts,
            [("contract_id", ASCENDING), ("event_type", ASCENDING), ("status", ASCENDING)],
            "kpi_alerts_contract_event_status"
        )

        logger.info("Database indexes initialized successfully")

    except Exception as e:
        logger.error(f"Failed to initialize database indexes: {str(e)}")
        raise

def _create_index_safe(collection, keys, index_name=None):
    """
    Safely create a non-unique index, skipping if it already exists.
    """
    try:
        if isinstance(keys, str):
            # Simple single field index
            collection.create_index(keys, name=index_name)
        else:
            # Compound index
            collection.create_index(keys, name=index_name)
        logger.debug(f"Created index {index_name or str(keys)} on {collection.name}")
    except OperationFailure as e:
        if "already exists" in str(e):
            logger.debug(f"Index {index_name or str(keys)} already exists on {collection.name}")
        else:
            logger.warning(f"Failed to create index {index_name or str(keys)} on {collection.name}: {str(e)}")
            raise

def _create_unique_index_safe(collection, keys, index_name=None):
    """
    Safely create a unique index, skipping if duplicates exist.
    """
    try:
        if isinstance(keys, str):
            # Simple single field index
            collection.create_index(keys, unique=True, name=index_name)
        else:
            # Compound index
            collection.create_index(keys, unique=True, name=index_name)
        logger.debug(f"Created unique index {index_name or str(keys)} on {collection.name}")
    except DuplicateKeyError:
        logger.warning(
            f"Skipping unique index creation for {index_name or str(keys)} on {collection.name} "
            f"due to duplicate key values. Please clean up duplicates."
        )
    except OperationFailure as e:
        if "already exists" in str(e):
            logger.debug(f"Index {index_name or str(keys)} already exists on {collection.name}")
        else:
            logger.warning(f"Failed to create unique index {index_name or str(keys)} on {collection.name}: {str(e)}")
            raise
