# In apps/backend/db.py

from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient
from gridfs import GridFS
from core.config import settings # Absolute import
import logging

MONGO_URI = settings.mongodb_uri 

# We dynamically choose the DATABASE NAME based on the TESTING flag.
if settings.testing:
    # When running E2E tests, we use the dedicated test database.
    DB_NAME = "contractsense-test-db"
else:
    # In normal development or production, we use the main database.
    DB_NAME = "contract_analysis_db"

logging.info(f"--- DB.PY --- Connecting to DB: '{DB_NAME}'")

# Connect to the MongoDB cluster
client = MongoClient(MONGO_URI)  # SECURITY: TLS is enforced by default. Never use tlsAllowInvalidCertificates=True.
# Select the correct database by name
db = client[DB_NAME]

# Initialize global audit logger collections
try:
    from utils.audit_logger import init_audit_collections
    init_audit_collections(db)
except Exception as e:
    logging.error(f"Failed to initialize audit log collections: {e}")

# Do the same for the asynchronous client
async_client = AsyncIOMotorClient(MONGO_URI)
async_db = async_client[DB_NAME]

logging.info(f"Database connection established to: {db.client.HOST}:{db.client.PORT}, DB: '{db.name}'")


# Define all collections here, once, as the single source of truth
collection = db["contracts"]
users_collection = db["users"]
accounts_collection = db["accounts"]
contract_roles_collection = db["contract_roles"]
teams_collection = db["teams"]
audit_logs_collection = db["audit_logs"]
projects_collection = db["projects"]

# Async Collections (Motor)
jobs_collection_async = async_db["jobs"]
contracts_collection_async = async_db["contracts"]

# GridFS
fs = GridFS(db)
