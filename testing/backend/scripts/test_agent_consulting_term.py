"""Test script: queries the most recent contract about the Consulting Term clause."""
import os
import sys
import json
import asyncio
from pathlib import Path

_backend_root = Path(__file__).resolve().parents[3] / "apps" / "backend"
sys.path.insert(0, str(_backend_root))

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("TESTING", "false")

from pymongo import MongoClient
from core.config import settings
from services.contract_agent.rag.agent import ContractEvidenceLoop
from services.contract_agent.rag.facade import ContractRAGSystem


def find_latest_contract():
    client = MongoClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]
    collection = db.get_collection("contracts")

    doc = collection.find_one(
        {"index.status": "success"},
        {
            "_id": 1,
            "contract_name": 1,
            "projectId": 1,
            "created": 1,
            "created_at": 1,
            "updated_at": 1,
            "uploaded_at": 1,
            "index.content": {"$slice": 200},
        },
        sort=[("_id", -1)],
    )
    client.close()
    return doc


async def query_agent(contract_id: str, contract_name: str):
    question = (
        "What does the Consulting Term clause state? "
        "Show me the exact text of section (b) Consulting Term."
    )
    print(f"\n=== Testing agent on contract: {contract_name} ({contract_id}) ===")
    print(f"Question: {question}\n")

    rag = ContractRAGSystem(ai_provider="groq")

    result = rag.query_model(
        question=question,
        contract_id=contract_id,
    )

    answer = result.get("answer") or result.get("content") or str(result)
    citations = result.get("citations") or result.get("citation_details") or {}
    evidence = result.get("evidence") or result.get("segments") or []

    print("=== AGENT ANSWER ===")
    print(answer)
    print("\n=== CITATIONS ===")
    print(json.dumps(citations, indent=2, default=str)[:2000])
    print("\n=== EVIDENCE SEGMENTS ===")
    for i, seg in enumerate(evidence[:5]):
        text = str(seg.get("text") or seg.get("content") or seg)[:300]
        page = seg.get("page") or seg.get("page_number") or "?"
        print(f"  [{i}] p{page}: {text}")
    return result


def main():
    contract = find_latest_contract()
    if not contract:
        print("No indexed contracts found.")
        return

    cid = str(contract["_id"])
    cname = contract.get("contract_name", "unknown")
    print(f"Latest indexed contract: {cname} ({cid})")

    # First, check what's actually in the index
    client = MongoClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]
    col = db.get_collection("contracts")
    full_doc = col.find_one({"_id": contract["_id"]}, {"index.content": 1})
    client.close()

    index_content = (full_doc.get("index") or {}).get("content", "")
    print(f"\nIndex content length: {len(index_content)} chars")
    print(f"First 500 chars: {index_content[:500]}")

    # Check if the consulting term text exists in the index
    search_term = "Consulting Term"
    if search_term in index_content:
        idx = index_content.index(search_term)
        print(f"\n'{search_term}' FOUND in index at position {idx}:")
        print(index_content[idx:idx + 600])
    else:
        print(f"\n'{search_term}' NOT FOUND in index content!")
        # Try case-insensitive
        if "consulting term" in index_content.lower():
            idx = index_content.lower().index("consulting term")
            print(f"'consulting term' (lowercase) FOUND at position {idx}:")
            print(index_content[idx:idx + 600])

    asyncio.run(query_agent(cid, cname))


if __name__ == "__main__":
    main()
