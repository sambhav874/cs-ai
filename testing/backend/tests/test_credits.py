import sys
import os
import unittest
from unittest.mock import AsyncMock, MagicMock
from pathlib import Path
from bson import ObjectId

# Setup path so backend modules are importable
APP_BACKEND_ROOT = Path(__file__).resolve().parents[3] / "apps" / "intelligence"
sys.path.insert(0, str(APP_BACKEND_ROOT))

# Ensure testing environment is set before importing core modules
os.environ["TESTING"] = "true"

# Setup dummy environment variables for config validation
os.environ.setdefault("HUGGINGFACE_TOKEN", "test")
os.environ.setdefault("GROQ_API_KEY", "test")
os.environ.setdefault("FINAL_OUTPUT_DIR", "/tmp/extractor-test-output")
os.environ.setdefault("SUPPORT_EMAIL_ADDRESS", "test@example.com")
os.environ.setdefault("AZURE_COMMUNICATION_CONNECTION_STRING", "endpoint=https://example.com/;accesskey=test")
os.environ.setdefault("AZURE_SENDER_ADDRESS", "test@example.com")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017/test")

# Mock core.database module to avoid connecting to MongoDB
mock_database_module = MagicMock()
mock_async_db = MagicMock()
mock_database_module.async_db = mock_async_db
sys.modules['core.database'] = mock_database_module

from api.dependencies import deduct_credits

class CreditsTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.accounts_col = MagicMock()
        mock_async_db.__getitem__.return_value = self.accounts_col
        self.test_user_id = ObjectId()

    async def test_deduct_credits_success(self) -> None:
        # Mock update_one to return modified_count = 1
        mock_result = MagicMock()
        mock_result.modified_count = 1
        self.accounts_col.update_one = AsyncMock(return_value=mock_result)

        # Deduct 30 credits
        success = await deduct_credits(self.test_user_id, 30)
        self.assertTrue(success)

        # Verify the database update query parameters
        self.accounts_col.update_one.assert_called_once()
        args, kwargs = self.accounts_col.update_one.call_args
        query_filter = args[0]
        update_doc = args[1]

        self.assertEqual(query_filter["user_id"], self.test_user_id)
        self.assertEqual(query_filter["page_credits"]["$gte"], 30)
        self.assertEqual(update_doc["$inc"]["page_credits"], -30)
        self.assertIn("updated_at", update_doc["$set"])

    async def test_deduct_credits_insufficient(self) -> None:
        # Mock update_one to return modified_count = 0 (insufficient funds or user not found)
        mock_result = MagicMock()
        mock_result.modified_count = 0
        self.accounts_col.update_one = AsyncMock(return_value=mock_result)

        # Attempt deduction
        success = await deduct_credits(self.test_user_id, 60)
        self.assertFalse(success)

        # Verify the database update query was called with 60 credits
        self.accounts_col.update_one.assert_called_once()
        args, kwargs = self.accounts_col.update_one.call_args
        self.assertEqual(args[0]["page_credits"]["$gte"], 60)
        self.assertEqual(args[1]["$inc"]["page_credits"], -60)
