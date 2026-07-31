import sys
import logging
from pathlib import Path

# Setup paths
BACKEND_ROOT = Path(__file__).resolve().parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("verify_runner")

def verify_endpoints():
    from utils.eval_parser import EvaluationParser
    
    # 1. Test local manifest parser
    logger.info("Testing local manifest parsing for CUAD dataset split...")
    try:
        res = EvaluationParser.list_local_cases(dataset_key="cuad", page=1, limit=5)
        cases = res.get("cases", [])
        total = res.get("total", 0)
        logger.info(f"Successfully parsed CUAD manifest. Total cases generated: {total}")
        assert total > 0, "No cases generated from CUAD manifest!"
        assert len(cases) <= 5, f"Expected at most 5 cases, got {len(cases)}"
        
        # Log first case details
        first = cases[0]
        logger.info(f"First Case ID: {first.get('case_id')}")
        logger.info(f"Layer: {first.get('layer')}, Task Type: {first.get('task_type')}")
        logger.info(f"Prompt: {first.get('prompt')[:60]}...")
        logger.info(f"Contract: {first.get('contract_title')}")
        logger.info(f"Gold Labels Count: {len(first.get('gold_labels', []))}")
    except Exception as e:
        logger.error(f"Failed local CUAD manifest verification: {e}")
        return False
        
    logger.info("Testing local manifest parsing for KPI dataset split...")
    try:
        res = EvaluationParser.list_local_cases(dataset_key="kpi", page=1, limit=5)
        cases = res.get("cases", [])
        total = res.get("total", 0)
        logger.info(f"Successfully parsed KPI manifest. Total cases generated: {total}")
        assert total > 0, "No cases generated from KPI manifest!"
        
        # Log first case details
        first = cases[0]
        logger.info(f"First Case ID: {first.get('case_id')}")
        logger.info(f"Prompt: {first.get('prompt')[:60]}...")
    except Exception as e:
        logger.error(f"Failed local KPI manifest verification: {e}")
        return False

    # 2. Test database runs query
    logger.info("Testing runs list from MongoDB...")
    try:
        runs = EvaluationParser.list_runs()
        logger.info(f"Found {len(runs)} runs in the database.")
        if len(runs) > 0:
            first_run = runs[0]
            logger.info(f"Latest Run ID in DB: {first_run.get('run_id')}")
            logger.info(f"Provider: {first_run.get('provider')}, Score: {first_run.get('overall_score')}")
    except Exception as e:
        logger.error(f"Failed database runs query verification: {e}")
        return False

    logger.info("All backend evaluations runner logic tests PASSED successfully!")
    return True

if __name__ == "__main__":
    if verify_endpoints():
        sys.exit(0)
    else:
        sys.exit(1)
