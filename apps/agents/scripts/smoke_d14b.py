"""
D.1.4b Python-side tool smoke — invokes each read tool directly against
the Node internal endpoints (no LLM in the loop) and asserts the response
shapes + content. Pairs with scripts/d14b-verify.mjs which then exercises
the agent-selects-the-right-tool path end-to-end through the UI.

Why a Python-side smoke for tools:
  - Tests the *plumbing* deterministically (no model nondeterminism)
  - Runs in ~2s against the seeded fixtures
  - Catches schema/param-name breakage before the LLM ever sees the tool
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

REPO_ROOT = Path(__file__).resolve().parents[3]

from app.tools import get_read_tools  # noqa: E402

fail = 0


def check(cond: bool, msg: str) -> None:
    global fail
    print(f"  {'✓' if cond else '✗'} {msg}")
    if not cond:
        fail += 1


async def main() -> None:
    # Find admin's org id for scoping. We hit the same seeded dataset the
    # d14a smoke uses, so rerun seed-ai-demo first (or trust a prior run).
    from sqlalchemy import text  # noqa: F401  (only for error clarity if psycopg2 missing)

    # Easier + more reliable: pull org_id via HTTP using the internal secret +
    # the contract_search tool itself (no query → returns everything).
    # But that's what we're *testing*. Use the seed's known org id via env.

    # Use the admin@demo.com org — looked up via Prisma in Node. We'll just
    # use a direct SQL probe via psycopg-free DATABASE_URL parsing if easier.
    # Simpler: call contract_search with no filters and read the first hit
    # to confirm the seed is in place and to grab a contract id for the
    # subsequent tool calls.
    from app.config import settings

    # Get orgId from the admin user row via a tiny HTTP probe. The Fastify
    # API exposes /health which doesn't need auth; for orgId we'll shell out.
    import subprocess
    bootstrap = subprocess.run(
        ["pnpm", "tsx", "--env-file=.env", "scripts/_demo-org-id.ts"],
        cwd=str(REPO_ROOT / "apps" / "api"),
        capture_output=True, text=True, timeout=30,
    )
    org_id = (bootstrap.stdout or "").strip().splitlines()[-1] if bootstrap.stdout else ""
    if not org_id or bootstrap.returncode != 0:
        print(f"  ✗ could not resolve demo org id (stderr: {bootstrap.stderr[:200]})")
        sys.exit(1)
    print(f"  using org_id={org_id}")

    tools = {t.name: t for t in get_read_tools(org_id)}
    check(set(tools.keys()) == {"contract_get", "contract_search", "contract_summarize", "clause_search"},
          f"registry has 4 read tools (got {sorted(tools.keys())})")

    # ── contract_search — no filters should return all 4 AI-demo contracts ──
    raw = await tools["contract_search"].ainvoke({})
    resp = json.loads(raw)
    check(resp.get("total", 0) >= 4, f"contract_search returned >= 4 rows (got {resp.get('total')})")
    titles = [r["title"] for r in resp.get("results", [])]
    has_msa = any("Acme" in t and "Master Services" in t for t in titles)
    has_nda = any("Globex" in t and "NDA" in t for t in titles)
    has_sla = any("Umbrella" in t and "SLA" in t for t in titles)
    has_sow = any("Stark" in t and "SOW" in t for t in titles)
    check(has_msa and has_nda and has_sla and has_sow,
          f"contract_search returns all four fixtures (got: {titles[:6]})")

    # Filter by type=MSA
    raw = await tools["contract_search"].ainvoke({"type": "MSA"})
    resp = json.loads(raw)
    check(all(r["type"] == "MSA" for r in resp.get("results", [])),
          "contract_search type=MSA returns only MSA rows")
    check(any("Acme" in r["title"] for r in resp.get("results", [])),
          "contract_search type=MSA includes Acme")

    # Query match
    raw = await tools["contract_search"].ainvoke({"query": "Umbrella"})
    resp = json.loads(raw)
    check(any("Umbrella" in r["title"] for r in resp.get("results", [])),
          "contract_search query='Umbrella' includes the SLA")

    # Stash the MSA id for the next steps
    msa = next((r for r in resp.get("results", []) if False), None)
    raw = await tools["contract_search"].ainvoke({"query": "Acme"})
    resp = json.loads(raw)
    msa = next((r for r in resp.get("results", []) if "Master Services" in r["title"]), None)
    check(msa is not None, "found MSA contract id via search")
    msa_id = msa["id"] if msa else None

    # ── contract_summarize — Umbrella SLA ─────────────────────────────────
    raw = await tools["contract_search"].ainvoke({"query": "Umbrella"})
    umbrella = next(r for r in json.loads(raw)["results"] if "Umbrella" in r["title"])
    raw = await tools["contract_summarize"].ainvoke({"contract_id": umbrella["id"]})
    resp = json.loads(raw)
    check(resp.get("type") == "SLA", f"summarize returns type=SLA (got {resp.get('type')})")
    check(resp.get("counterpartyName") == "Umbrella Corporation", "summarize returns correct counterparty")
    check(isinstance(resp.get("summary"), str) and "99.9" in resp["summary"], "summarize includes cached 99.9% figure")
    check(isinstance(resp.get("plainTextSnippet"), str) and "SERVICE LEVEL AGREEMENT" in resp["plainTextSnippet"],
          "summarize returns opening plainText snippet")

    # ── clause_search — the MSA's cap-on-damages clause ───────────────────
    # The fixture body says "CAP ON DAMAGES" (Section 9.2) + "LIMITATION OF
    # LIABILITY" (Section 9). Search for the heading we know exists; the
    # surrounding window should include the $500,000 figure.
    raw = await tools["clause_search"].ainvoke({
        "contract_id": msa_id, "query": "CAP ON DAMAGES", "limit": 5,
    })
    resp = json.loads(raw)
    check(resp.get("totalMatches", 0) >= 1, f"clause_search 'CAP ON DAMAGES' in MSA → >=1 match (got {resp.get('totalMatches')})")
    first = resp.get("matches", [{}])[0] if resp.get("matches") else {}
    window = (first.get("beforeContext", "") + first.get("match", "") + first.get("afterContext", "")).lower()
    check("500,000" in window or "five hundred thousand" in window,
          "first match's window contains the $500,000 figure (grounded to section 9.2)")
    check(isinstance(first.get("sectionHint"), (str, type(None))),
          "sectionHint is string|null (best-effort heading detection)")

    # Query that should NOT match (control) — avoids false confidence
    raw = await tools["clause_search"].ainvoke({
        "contract_id": msa_id, "query": "zzznever-matches-xyz", "limit": 5,
    })
    resp = json.loads(raw)
    check(resp.get("totalMatches", 0) == 0, "clause_search empty query returns 0 matches")

    # ── contract_get still works (regression) ─────────────────────────────
    raw = await tools["contract_get"].ainvoke({"contract_id": msa_id})
    resp = json.loads(raw)
    check(resp.get("type") == "MSA" and "plainText" in resp, "contract_get regression still passes")

    # Cross-tenant probe — bogus contract id should surface as error JSON
    raw = await tools["contract_get"].ainvoke({"contract_id": "does-not-exist-xyz"})
    resp = json.loads(raw)
    check(resp.get("error") == "contract_not_found", "contract_get surfaces not_found as structured error")

    print()
    if fail:
        print(f"✗ {fail} check(s) failed")
        sys.exit(1)
    print("✓ All D.1.4b tool-layer checks pass")


if __name__ == "__main__":
    asyncio.run(main())
