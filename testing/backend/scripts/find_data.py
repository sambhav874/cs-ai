"""Find where contract data lives in MongoDB."""
import os
import sys
from pathlib import Path

_backend_root = Path(__file__).resolve().parents[3] / "apps" / "intelligence"
sys.path.insert(0, str(_backend_root))

_env_path = _backend_root / ".env"
if _env_path.exists():
    with open(_env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            val = val.strip().strip('"').strip("'")
            key = key.strip()
            os.environ.setdefault(key, val)
os.environ.setdefault("APP_ENV", "development")

from pymongo import MongoClient
from core.config import settings

client = MongoClient(settings.mongodb_uri)
db = client[settings.mongodb_db_name]
print(f"DB: {settings.mongodb_db_name}")

collections = db.list_collection_names()
print(f"Collections: {collections}")

for name in collections:
    count = db[name].count_documents({})
    print(f"  {name}: {count} docs")
    if count > 0:
        sample = db[name].find_one({})
        keys = list(sample.keys()) if sample else []
        print(f"    keys: {keys[:20]}")
        # Check for index field or content
        if "index" in keys:
            idx = sample.get("index", {})
            print(f"    index.status: {idx.get('status')}")
            content_len = len(idx.get("content", ""))
            print(f"    index.content length: {content_len}")

client.close()
