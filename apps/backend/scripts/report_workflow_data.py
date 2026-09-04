"""Read-only census of the fields the workflow cleanup depends on.

Answers two questions before anything destructive is decided:

1. Does any contract still hold Q&A draft content? Nothing writes
   ``process.results`` any more, but documents from older releases may carry
   it, and that decides whether the draft subsystem can simply be deleted.
2. Which status values actually exist? Several statuses are read in query
   filters that no code path writes, and stripping one that still exists in
   the data would hide those contracts from every dashboard count.

Writes nothing.
"""

import sys
from collections import Counter
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from core.database import collection  # noqa: E402


def report(message: str = "", *args) -> None:
    """Print, not log: importing the app reconfigures logging and swallows it."""
    print(message % args if args else message, flush=True)


# Read in filters somewhere, written by nothing as of this commit.
SUSPECTED_DEAD_STATUSES = ["Ready to Edit", "Indexed", "Completed", "Pending Your Approval"]


def main() -> int:
    total = collection.count_documents({})
    report("Contracts: %d", total)

    report("\n--- Q&A draft content ---")
    with_results = collection.count_documents({"process.results.0": {"$exists": True}})
    with_last_save = collection.count_documents({"process.lastSave": {"$ne": None}})
    with_dynamic = collection.count_documents({"process.dynamic_results.0": {"$exists": True}})
    report("process.results holding at least one version: %d", with_results)
    report("process.lastSave set:                         %d", with_last_save)
    report("process.dynamic_results holding anything:     %d", with_dynamic)
    if with_results or with_last_save or with_dynamic:
        report(">> Real content exists. Export it before deleting those fields.")
    else:
        report(">> Empty everywhere. The draft subsystem can be deleted outright.")

    report("\n--- Status values in use ---")
    counts = Counter()
    for doc in collection.find({}, {"status": 1}):
        counts[doc.get("status")] += 1
    for status, count in counts.most_common():
        report("%-28s %d", status, count)

    report("\n--- Statuses read in filters but never written ---")
    for status in SUSPECTED_DEAD_STATUSES:
        count = counts.get(status, 0)
        verdict = "still in the data — keep the filter branch" if count else "absent — safe to strip"
        report("%-28s %5d  %s", status, count, verdict)

    report("\n--- Approved-status backfill ---")
    mislabelled = collection.count_documents({
        "status": "Ingested",
        "approvedOrRejectedBy": {"$exists": True, "$ne": None},
        "$or": [{"rejectedReason": None}, {"rejectedReason": {"$exists": False}}],
    })
    report("Contracts at 'Ingested' carrying an approval decision: %d", mislabelled)
    report("(scripts/backfill_approved_status.py --apply would relabel these)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
