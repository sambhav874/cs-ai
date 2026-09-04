import os
import sys
import logging
from pathlib import Path

# Setup paths
BACKEND_ROOT = Path(__file__).resolve().parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Setup logger
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("import_reports")

def main():
    from utils.eval_parser import EvaluationParser, REPORTS_DIR
    
    logger.info(f"Scanning reports directory: {REPORTS_DIR}")
    if not REPORTS_DIR.exists():
        logger.warning(f"Reports directory {REPORTS_DIR} does not exist.")
        return 0
        
    local_run_ids = []
    for root, dirs, files in os.walk(str(REPORTS_DIR)):
        if "final_eval_report.json" in files:
            report_dir = Path(root)
            try:
                rel_path = report_dir.relative_to(REPORTS_DIR)
                if str(rel_path) != ".":
                    run_id = str(rel_path).replace(os.sep, "__").replace("/", "__")
                    local_run_ids.append(run_id)
            except ValueError:
                continue
                
    logger.info(f"Found {len(local_run_ids)} local runs to import.")
    
    success_count = 0
    for run_id in local_run_ids:
        logger.info(f"Importing run '{run_id}'...")
        try:
            success = EvaluationParser.import_run_to_db(run_id)
            if success:
                success_count += 1
                logger.info(f"Successfully imported '{run_id}'")
            else:
                logger.error(f"Failed to import '{run_id}'")
        except Exception as e:
            logger.error(f"Error importing '{run_id}': {e}")
            
    logger.info(f"Import complete: {success_count}/{len(local_run_ids)} runs successfully written to MongoDB.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
