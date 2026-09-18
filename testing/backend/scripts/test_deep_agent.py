"""Test: query via the deep agent runner (streaming path) for the Consulting Term clause."""
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
content = (contract.get("index", {}) or {}).get("content", "")
cname = contract.get("contract_name", "???")

print(f"Contract: {cname} ({contract_id})")
print(f"Content length: {len(content)}")

from services.contract_agent.graph import AgentContext, AgentRunState, DeepContractAgentRunner
from services.contract_agent.graph.state import AgentSurface

context = AgentContext(
    surface=AgentSurface.CONTRACT,
    contract_id=contract_id,
    selected_document_ids=[contract_id],
    visible_state={
        "scope": "contract",
        "contract_name": cname,
    },
)
state = AgentRunState(
    user_id="test",
    message=(
        "What does the Consulting Term clause state? "
        "Show me the exact text of section (b) Consulting Term."
    ),
    context=context,
    ai_provider=None,
)

idx = contract.get("index", {})
documents = [{
    "_id": contract_id,
    "contract_name": cname,
    "index": {
        "status": "success",
        "content": content,
        "vector_namespace": idx.get("vector_namespace", ""),
        "vector_backend": idx.get("vector_backend", ""),
    },
}]

from services.contract_agent.rag.facade import _in_memory_react_tool_executor

runner = DeepContractAgentRunner(
    tool_executor=_in_memory_react_tool_executor(documents)
)
response = runner.run(state)

print(f"\n=== DEEP AGENT RESPONSE ===")
print(f"Answer: {response.answer}")
print(f"Confidence: {response.confidence}")
print(f"Reason: {response.reason}")
for trace in (response.agent_trace or []):
    print(f"  {json.dumps(trace, default=str)[:250]}")
print(f"Citations: {json.dumps(response.citation_details, default=str)[:800]}")
print(f"React scratchpad items: {len(response.react_scratchpad or [])}")
for item in (response.react_scratchpad or [])[:8]:
    print(f"  {item.get('role')}: {str(item.get('content', ''))[:200]}")
