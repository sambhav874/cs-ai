"""Quick test to verify chunk fix."""
import os, sys
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

contract = contracts_collection.find_one({"_id": ObjectId("6a2dafc7767185f40434335a")})
content = (contract.get("index") or {}).get("content", "")

# Test chunk_text with new 3000-char size
from services.contract_agent.graph.tools.executor import _chunk_text
chunks = _chunk_text(content)
print(f"Total chunks with new sizing: {len(chunks)}")

for start, end, snippet in chunks:
    if "Consulting Term" in snippet:
        has_independent = "independent contractor" in snippet
        markers = ""
        if "(b) Consulting Term: At all times" in snippet:
            markers += " [HAS THE RIGHT CLAUSE]"
        if "(b) Consulting Term: During the Consulting Term, Snyder shall make himself" in snippet:
            markers += " [SECTION 4 - services clause]"
        print(f"  chunk {start}-{end} ({end-start} chars): has_independent={has_independent}{markers}")
        print(f"    first 150: {snippet[:150].strip()}")
