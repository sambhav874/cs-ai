"""Debug why vector search fails for the deep agent."""
import os
import sys
import json
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

from bson import ObjectId
from core.database import collection as contracts_collection

contract_id = "6a2dafc7767185f40434335a"
contract = contracts_collection.find_one({"_id": ObjectId(contract_id)})
idx = contract.get("index", {})

print(f"Contract: {contract.get('contract_name')}")
print(f"vector_namespace: {idx.get('vector_namespace')}")
print(f"vector_backend: {idx.get('vector_backend')}")
print(f"vector_count: {idx.get('vector_count')}")
print(f"vector_collection: {idx.get('vector_collection')}")
print(f"segment_count: {idx.get('segment_count')}")

from services.contract_agent.rag.facade import ContractRAGSystem

rag = ContractRAGSystem(ai_provider="groq")
namespace = idx.get("vector_namespace", "")
print(f"\nLoading vector store for namespace: '{namespace}'")

try:
    store = rag.load_existing_vector_store(namespace)
    print(f"Vector store: {store}")
    if store:
        if hasattr(store, "doc_count") or hasattr(store, "_collection"):
            print("Store has doc_count or _collection")

        retriever = store.as_retriever(search_kwargs={"k": 5})
        docs = retriever.invoke("Consulting Term independent contractor Snyder")
        print(f"\nRetrieved {len(docs)} docs:")
        for i, doc in enumerate(docs[:3]):
            meta = getattr(doc, "metadata", {})
            text = getattr(doc, "page_content", "")[:200]
            print(f"  [{i}] {json.dumps(meta, default=str)[:200]}")
            print(f"       text: {text}")
    else:
        print("No vector store returned.")
except Exception as e:
    print(f"Error: {e}")

# Check what's in contract_vectors for this contract
from core.config import settings
from pymongo import MongoClient

client = MongoClient(settings.mongodb_uri)
vectors = client[settings.mongodb_db_name]["contract_vectors"]

# Find by namespace
by_ns = list(vectors.find({"namespace": namespace}).limit(3))
print(f"\nVectors by namespace '{namespace}': {len(by_ns)}")
if by_ns:
    for v in by_ns:
        print(f"  text_id: {v.get('_id')}")
        print(f"  source: {v.get('source')}")
        print(f"  has embedding: {'embedding' in v}")

# Find by source matching the contract
by_source = list(vectors.find({"source": idx.get("vector_namespace")}).limit(3))
print(f"\nVectors by source: {len(by_source)}")

# Find by contract name
by_name = list(vectors.find({"contract_name": contract.get("contract_name")}).limit(3))
print(f"Vectors by contract_name: {len(by_name)}")
if by_name:
    v = by_name[0]
    print(f"  namespace: {v.get('namespace')}")
    print(f"  source: {v.get('source')}")

client.close()
