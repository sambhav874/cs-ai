import os
import sys
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from utils.eval_parser import EvaluationParser

def test():
    print("=" * 60)
    print(" EVALUATION PARSER VERIFICATION ")
    print("=" * 60)
    
    # 1. Test Config Loading
    print("[*] Loading global config...")
    config = EvaluationParser.get_global_config()
    if config:
        print(f"[+] Config loaded successfully. Keys: {list(config.keys())}")
        print(f"    Default AI Provider: {config.get('provider')}")
        print(f"    Weights configured: {config.get('weights')}")
    else:
        print("[!] Config failed to load.")

    # 2. Test Runs Directory Scanning
    print("\n[*] Scanning historical runs...")
    runs = EvaluationParser.list_runs()
    print(f"[+] Found {len(runs)} evaluation runs in directory.")
    for idx, run in enumerate(runs[:5], 1):
        print(f"    [{idx}] Run ID: {run['run_id']}")
        print(f"        Provider: {run['provider']} | Dataset: {run['dataset']} | Score: {run['overall_score']}")
        print(f"        Attempts: {run['passed_attempts']}/{run['total_attempts']} | Hard Gates Passed: {run['hard_gate_passed']}")

    # 3. Test Details Fetching & Case Pagination
    if runs:
        target_run_id = runs[0]['run_id']
        print(f"\n[*] Fetching details for run: {target_run_id}")
        details = EvaluationParser.get_run_details(target_run_id, page=1, limit=3)
        if details:
            print("[+] Run details fetched successfully.")
            print(f"    Keys: {list(details.keys())}")
            print(f"    Results paginated summary: {details.get('results_summary')}")
            print(f"    Returned attempts count: {len(details.get('results', []))}")
            if details.get('results'):
                first_case = details['results'][0]
                print(f"    First Case ID: {first_case.get('case', {}).get('case_id')}")
                print(f"    First Case Score: {first_case.get('score')}")
        else:
            print(f"[!] Details failed to load for run {target_run_id}")

        # 4. Test CSV Loading
        print(f"\n[*] Testing CSV logs loading for run: {target_run_id}")
        for csv_name in ["failure_taxonomy", "tool_coverage", "parameter_scorecard"]:
            csv_data = EvaluationParser.get_run_csv(target_run_id, csv_name)
            print(f"    - {csv_name}.csv: loaded {len(csv_data)} rows.")
            if csv_data:
                print(f"      First row: {csv_data[0]}")
    else:
        print("[!] No runs found to inspect details.")

if __name__ == "__main__":
    test()
