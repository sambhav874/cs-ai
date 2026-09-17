"""Debug exact search results for the deep agent."""
import os, sys, json
from pathlib import Path
sys.path.insert(0, str((Path(__file__).resolve().parents[3] / "apps" / "backend")))

_env_path = Path(__file__).resolve().parents[3] / "apps" / "backend" / ".env"
if _env_path.exists():
    with open(_env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line: continue
            key, _, val = line.partition("=")
            val = val.strip().strip('"').strip("'"); key = key.strip()
            os.environ.setdefault(key, val)
os.environ.setdefault("APP_ENV", "development")

"""Debug the fallback search result ordering."""
import os, sys, json
from pathlib import Path
sys.path.insert(0, str((Path(__file__).resolve().parents[3] / "apps" / "backend")))

_env_path = Path(__file__).resolve().parents[3] / "apps" / "backend" / ".env"
if _env_path.exists():
    with open(_env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line: continue
            key, _, val = line.partition("=")
            val = val.strip().strip('"').strip("'"); key = key.strip()
            os.environ.setdefault(key, val)
os.environ.setdefault("APP_ENV", "development")

from bson import ObjectId
from core.database import collection as contracts_collection
from services.contract_agent.graph.tools.executor import _search_documents

contract = contracts_collection.find_one({"_id": ObjectId("6a2dafc7767185f40434335a")})

# What fallback search returns for "Consulting Term"
matches, backend, trace = _search_documents(
    contracts_collection, [contract], ["Consulting Term"],
    top_k=10, ai_provider="groq",
    intent="Find the Consulting Term clause about independent contractor status for Snyder",
    must_contain=["Snyder", "Consulting Term"],
)
print(f"Backend: {backend}")
print(f"Candidates: {trace.get('candidate_counts', {})}")
for i, m in enumerate(matches):
    snippet = m.get("snippet", "")[:250]
    has_ic = "independent contractor" in snippet.lower()
    has_services = "make himself available" in snippet.lower()
    markers = " [IC]" if has_ic else " [SVC]" if has_services else ""
    print(f"\n[{i}] id={m.get('evidence_id','?')} score={m.get('score','?')}{markers}")
    print(f"    {snippet}")
