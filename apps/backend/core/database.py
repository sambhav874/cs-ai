# In apps/backend/db.py

from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient
from gridfs import GridFS
from core.config import settings # Absolute import
import logging

MONGO_URI = settings.mongodb_uri 

# We dynamically choose the DATABASE NAMES based on the TESTING flag.
if settings.testing:
    CORE_DB_NAME = "contractsense-test-db"
    AGENT_DB_NAME = "contractsense-test-db"
    KPI_DB_NAME = "contractsense-test-db"
    EVAL_DB_NAME = "contractsense-test-db"
else:
    CORE_DB_NAME = "contract_core_db"
    AGENT_DB_NAME = "contract_agent_db"
    KPI_DB_NAME = "contract_kpi_db"
    EVAL_DB_NAME = "contract_eval_db"

logging.info(f"--- DB.PY --- Connecting to Core DB: '{CORE_DB_NAME}'")

# Connect to the MongoDB cluster
client = MongoClient(MONGO_URI)

# Domain Databases
core_db = client[CORE_DB_NAME]
agent_db = client[AGENT_DB_NAME]
kpi_db = client[KPI_DB_NAME]
eval_db = client[EVAL_DB_NAME]

# Main default db alias
db = core_db

# Initialize global audit logger collections
try:
    from utils.audit_logger import init_audit_collections
    init_audit_collections(db)
except Exception as e:
    logging.error(f"Failed to initialize audit log collections: {e}")

# Async client and domain databases
async_client = AsyncIOMotorClient(MONGO_URI)
async_core_db = async_client[CORE_DB_NAME]
async_agent_db = async_client[AGENT_DB_NAME]
async_kpi_db = async_client[KPI_DB_NAME]
async_eval_db = async_client[EVAL_DB_NAME]
async_db = async_core_db

logging.info(f"Database connection established to: {db.client.HOST}:{db.client.PORT}, DB: '{db.name}'")

# Single source of truth for collection handles across domain DBs
collection = core_db["contracts"]
users_collection = core_db["users"]
accounts_collection = core_db["accounts"]
contract_roles_collection = core_db["contract_roles"]
teams_collection = core_db["teams"]
audit_logs_collection = core_db["audit_logs"]
projects_collection = core_db["projects"]
personas_collection = core_db["personas"]

eval_runs_collection = eval_db["evaluation_runs"]
eval_attempts_collection = eval_db["evaluation_attempts"]
eval_csvs_collection = eval_db["evaluation_csvs"]

# Async Collections (Motor)
jobs_collection_async = async_core_db["jobs"]
contracts_collection_async = async_core_db["contracts"]
eval_runs_collection_async = async_eval_db["evaluation_runs"]
eval_attempts_collection_async = async_eval_db["evaluation_attempts"]
eval_csvs_collection_async = async_eval_db["evaluation_csvs"]

# GridFS on Core DB
fs = GridFS(core_db)


