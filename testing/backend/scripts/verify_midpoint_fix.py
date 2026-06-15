"""Verify the Midpoint EPS fix works end-to-end."""
import os, sys, json, importlib
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[3] / "apps" / "backend"))
from pathlib import Path
_env_path = Path(__file__).resolve().parents[3] / "apps" / "backend" / ".env"
if _env_path.exists():
    with open(_env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line: continue
            key, _, val = line.partition("=")
            val = val.strip().strip('"').strip("'"); key = key.strip()
            os.environ.setdefault(key, val)
os.environ.setdefault('APP_ENV', 'development')

from bson import ObjectId
from core.database import collection as contracts_collection
from services.contract_agent.rag.facade import ContractRAGSystem

contract_id = "6a1ca2a9efa67a9070dbb8cd"
contract = contracts_collection.find_one({"_id": ObjectId(contract_id)})
content = (contract.get("index") or {}).get("content", "")
cname = contract.get("contract_name", "")

rag = ContractRAGSystem(ai_provider="groq")
result = rag.answer_agent_question(
    contract_text=content,
    contract_name=cname,
    contract_id=contract_id,
    question="What are the Midpoint EPS Definitions? List the threshold, midpoint, and maximum levels.",
)
print(f"Answer: {result.answer}")
print(f"Confidence: {result.confidence}")
