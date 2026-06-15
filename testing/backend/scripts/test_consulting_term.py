"""Test: query contract 6a2dafc7767185f40434335a for the Consulting Term clause."""
import os
import sys
import json
import re
from pathlib import Path

_backend_root = Path(__file__).resolve().parents[3] / "apps" / "backend"
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
from core.database import collection as contracts_collection, db as contracts_db


def main():
    print(f"Contracts DB: {contracts_db.name}")
    print(f"Contracts count: {contracts_collection.count_documents({})}")

    target_id = ObjectId("6a2dafc7767185f40434335a")
    contract = contracts_collection.find_one({"_id": target_id})
    if not contract:
        print(f"Contract 6a2dafc... NOT FOUND in {contracts_db.name}")
        return

    cname = contract.get("contract_name", "???")
    idx = contract.get("index", {})
    content = idx.get("content", "")
    print(f"Contract: {cname}")
    print(f"Index status: {idx.get('status')}")
    print(f"Content length: {len(content)}")

    if "Consulting Term" in content:
        pos = content.index("Consulting Term")
        print(f"\n'Consulting Term' FOUND at char {pos}:")
        print(content[pos:pos + 700])
    else:
        print("\n'Consulting Term' NOT in content - showing first 800 chars:")
        print(content[:800])
        return

    # Test the RAG system
    print("\n=== RAG QUERY TEST ===")
    from services.contract_agent.rag.facade import ContractRAGSystem

    rag = ContractRAGSystem(ai_provider="groq")
    result = rag.answer_agent_question(
        contract_text=content,
        contract_name=cname,
        contract_id=str(target_id),
        question=(
            "What does the Consulting Term clause state? "
            "Show the exact text of section (b) Consulting Term describing "
            "Snyder's independent contractor status and benefits."
        ),
    )

    print(f"Answer: {result.answer}")
    print(f"Confidence: {result.confidence}")
    print(f"Citation: {json.dumps(result.citation, default=str)[:300]}")
    print(f"Citation details: {json.dumps(result.citation_details, default=str)[:500]}")
    print(f"Citation annotations: {json.dumps(result.citation_annotations, default=str)[:500]}")
    print(f"Reason: {result.reason}")
    print(f"Trace: {json.dumps(result.agent_trace, default=str)[:800]}")


if __name__ == "__main__":
    main()
