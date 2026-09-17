"""Debug why Midpoint EPS definition isn't found."""
import os, sys, json, re
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

contract_id = "6a1ca2a9efa67a9070dbb8cd"
contract = contracts_collection.find_one({"_id": ObjectId(contract_id)})
content = (contract.get("index") or {}).get("content", "")

# Check page_boundaries
pages = re.split(r'--- Page (\d+) ---', content)

# Find which page has the definition
for i, part in enumerate(pages):
    if "Midpoint EPS" in part and "Definitions" in part:
        print(f"Found in pages[{i}]: {pages[i-1] if i > 0 else 'preamble'}")
        print(f"Full page content ({len(part)} chars):")
        print(part[:1000])

# Check the evidence retrieval for this
print("\n=== Evidence Retrieval ===")
from services.contract_agent.graph.tools.executor import _search_documents, _evidence_chunks

documents = [contract]
matches, backend, trace = _search_documents(
    contracts_collection, documents, 
    ["Midpoint EPS definitions threshold midpoint maximum"],
    top_k=10, ai_provider="groq",
    intent="Find the Midpoint EPS Definitions section"
)

print(f"Backend: {backend}, matches: {len(matches)}")
for i, m in enumerate(matches[:5]):
    snippet = m.get("snippet", "")[:300]
    has_def = "Definitions" in snippet
    print(f"  [{i}] score={m.get('score','?')} has_Definitions={has_def}")
    print(f"    {snippet}")

# Check what executor chunks contain the definitions
chunks = _evidence_chunks(contract)
def_chunks = [(c["evidence_id"], c["snippet"]) for c in chunks if "Midpoint EPS" in c.get("snippet", "")]
print(f"\nExecutor chunks with 'Midpoint EPS': {len(def_chunks)}")
for eid, snip in def_chunks:
    print(f"  {eid}: {snip[:300]}")
