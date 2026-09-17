#!/usr/bin/env python3
"""Offline memory lifecycle sweep (2.6, F-23): consolidate near-duplicate
agent memories and archive chat sessions idle past their TTL.

Not run on the request path — consolidation writes and full-collection scans
cost more than a single answer should ever spend. Run this from a cron/ops
job on whatever cadence fits (weekly is a reasonable default); it is safe to
run repeatedly, since each pass only merges what is still a duplicate.

Usage:
    poetry run python scripts/memory_maintenance.py [--dry-run] [--ttl-days 180]
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta
from pathlib import Path

backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from core.database import db  # noqa: E402
from services.memory import lifecycle  # noqa: E402


def consolidate_all(*, dry_run: bool) -> int:
    agent_db = db.client["contract_agent_db"]
    memories = agent_db["agent_memories"]

    merged_total = 0
    for contract_id in memories.distinct("contract_id"):
        for user_id in memories.distinct("user_id", {"contract_id": contract_id}):
            records = list(
                memories.find(
                    {"contract_id": contract_id, "user_id": user_id},
                ).sort([("citation_count", -1), ("updated_at", -1)])
            )
            if len(records) < 2:
                continue
            kept = lifecycle.consolidate(records)
            kept_ids = {record.get("memory_id") for record in kept}
            dropped = [r for r in records if r.get("memory_id") not in kept_ids]
            if not dropped:
                continue
            merged_total += len(dropped)
            print(
                f"contract={contract_id} user={user_id}: "
                f"{len(records)} -> {len(kept)} ({len(dropped)} merged)"
            )
            if dry_run:
                continue
            for record in kept:
                if int(record.get("confirmed_count") or 1) >= 2:
                    memories.update_one(
                        {"memory_id": record.get("memory_id")},
                        {"$set": {"confidence": "high", "confirmed_count": record["confirmed_count"]}},
                    )
            memories.delete_many(
                {"memory_id": {"$in": [r.get("memory_id") for r in dropped]}}
            )
    return merged_total


def archive_stale_sessions(*, ttl_days: int, dry_run: bool) -> int:
    agent_db = db.client["contract_agent_db"]
    sessions = agent_db["agent_chat_sessions"]
    cutoff = datetime.utcnow() - timedelta(days=ttl_days)
    query = {"archived_at": {"$exists": False}, "updated_at": {"$lt": cutoff}}
    if dry_run:
        return sessions.count_documents(query)
    result = sessions.update_many(query, {"$set": {"archived_at": datetime.utcnow()}})
    return result.modified_count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Report what would change, write nothing.")
    parser.add_argument("--ttl-days", type=int, default=lifecycle.DEFAULT_TTL_DAYS)
    args = parser.parse_args()

    merged = consolidate_all(dry_run=args.dry_run)
    archived = archive_stale_sessions(ttl_days=args.ttl_days, dry_run=args.dry_run)

    verb = "would merge/archive" if args.dry_run else "merged/archived"
    print(f"\n{verb}: {merged} memories consolidated, {archived} sessions archived.")


if __name__ == "__main__":
    main()
