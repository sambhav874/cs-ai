"""Give already-approved contracts the terminal status they never got.

Approval used to write "Ingested" — the same status the OCR worker writes — so
every contract approved before that changed is indistinguishable from one that
was merely parsed. Those documents carry ``approvedOrRejectedBy`` and no
rejection reason, which is what tells them apart.

Runs read-only by default. Nothing is written until you pass --apply.

    python scripts/backfill_approved_status.py            # report only
    python scripts/backfill_approved_status.py --apply    # write
"""

import argparse
import logging
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from core.database import collection  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("backfill_approved_status")

# Approved, not merely ingested: someone recorded a decision and it was not a
# rejection. A contract the worker finished has neither field.
APPROVED_BUT_MISLABELLED = {
    "status": "Ingested",
    "approvedOrRejectedBy": {"$exists": True, "$ne": None},
    "$or": [{"rejectedReason": None}, {"rejectedReason": {"$exists": False}}],
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write the change. Without it, report only.")
    args = parser.parse_args()

    total_ingested = collection.count_documents({"status": "Ingested"})
    candidates = collection.count_documents(APPROVED_BUT_MISLABELLED)

    logger.info("Contracts sitting at 'Ingested': %d", total_ingested)
    logger.info("Of those, carrying an approval decision: %d", candidates)
    logger.info(
        "Left alone: %d — no recorded decision, so they really were only ingested.",
        total_ingested - candidates,
    )

    if not candidates:
        logger.info("Nothing to backfill.")
        return 0

    if not args.apply:
        logger.info("Dry run. Re-run with --apply to write 'Approved' to those %d contracts.", candidates)
        for doc in collection.find(APPROVED_BUT_MISLABELLED, {"contract_name": 1}).limit(10):
            logger.info("  would update: %s (%s)", doc.get("contract_name"), doc["_id"])
        return 0

    result = collection.update_many(APPROVED_BUT_MISLABELLED, {"$set": {"status": "Approved"}})
    logger.info("Updated %d contracts to 'Approved'.", result.modified_count)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
