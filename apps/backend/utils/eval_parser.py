from __future__ import annotations

import os
import json
import csv
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Locate directories dynamically
REPO_ROOT = Path(__file__).resolve().parents[3]
REPORTS_DIR = REPO_ROOT / "final_evaluation" / "reports"
CONFIG_FILE = REPO_ROOT / "final_evaluation" / "config" / "eval_config.yaml"

# Global in-memory cache for parsed runs and configs
# Key: file_path, Value: (mtime, parsed_data)
_cache: Dict[str, tuple[float, Any]] = {}

def get_cached_data(file_path: Path, parse_fn) -> Any:
    """Helper to load and cache file content based on modification time."""
    if not file_path.exists():
        return None
    
    path_str = str(file_path.resolve())
    mtime = file_path.stat().st_mtime
    
    cached = _cache.get(path_str)
    if cached and cached[0] == mtime:
        return cached[1]
        
    try:
        data = parse_fn(file_path)
        _cache[path_str] = (mtime, data)
        return data
    except Exception as e:
        logger.error(f"Error parsing file {file_path}: {e}")
        return None

def parse_yaml_fallback(content: str) -> dict:
    """Fallback manual YAML parser if pyyaml is not available."""
    import re
    result: Dict[str, Any] = {}
    stack = [result]
    indent_levels = [-1]
    
    lines = content.split('\n')
    for line in lines:
        # Remove comments
        line = re.sub(r'#.*$', '', line)
        if not line.strip():
            continue
            
        indent = len(line) - len(line.lstrip())
        line = line.strip()
        
        # Match list items like "- fetch_documents"
        if line.startswith('- '):
            val = line[2:].strip().strip("'\"")
            current_node = stack[-1]
            if isinstance(current_node, list):
                current_node.append(val)
            continue
        
        if ':' in line:
            parts = line.split(':', 1)
            key = parts[0].strip().strip("'\"")
            val_str = parts[1].strip()
            
            # Determine value type
            if val_str == '':
                # If next lines are list items or indented items, this will be populated
                # We default to a list or dict depending on context, or let indentation handle it
                # For safety, initialize as dict, but if we encounter list items we'll see
                val = {}
            elif val_str.lower() == 'true':
                val = True
            elif val_str.lower() == 'false':
                val = False
            elif val_str.startswith('[') and val_str.endswith(']'):
                val = [item.strip().strip("'\"") for item in val_str[1:-1].split(',') if item.strip()]
            else:
                try:
                    if '.' in val_str:
                        val = float(val_str)
                    else:
                        val = int(val_str)
                except ValueError:
                    val = val_str.strip("'\"")
            
            # Adjust stack based on indentation
            while len(indent_levels) > 1 and indent <= indent_levels[-1]:
                stack.pop()
                indent_levels.pop()
                
            current_node = stack[-1]
            
            if isinstance(current_node, dict):
                if isinstance(val, dict) and val == {}:
                    # Anticipate list or dict structure: if next line is a list item, make this a list instead
                    # Let's peek ahead or set as dict first. If children are lists, it will append correctly.
                    current_node[key] = {}
                    stack.append(current_node[key])
                    indent_levels.append(indent)
                else:
                    current_node[key] = val
                    
    # Helper post-process: convert empty dicts that should have been lists
    # In eval_config.yaml, this applies to tool_inventory items
    def clean_lists(node):
        if isinstance(node, dict):
            for k, v in list(node.items()):
                if isinstance(v, dict):
                    # check if it looks like it was meant to be a list (i.e. has keys but we also want list conversion)
                    # For our specific config, tool_inventory items are lists.
                    clean_lists(v)
    clean_lists(result)
    return result

def load_yaml_config(file_path: Path) -> dict:
    """Reads and parses the YAML config file, using pyyaml or falling back."""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    try:
        import yaml
        return yaml.safe_load(content)
    except ImportError:
        return parse_yaml_fallback(content)

def parse_json_report(file_path: Path) -> dict:
    """Reads and parses a full JSON report file."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def parse_csv_file(file_path: Path) -> List[Dict[str, str]]:
    """Reads and parses a CSV report file into a list of dictionaries."""
    if not file_path.exists():
        return []
    try:
        with open(file_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            return [dict(row) for row in reader if row]
    except Exception as e:
        logger.error(f"Error reading CSV {file_path}: {e}")
        return []

class EvaluationParser:
    """Helper service to retrieve evaluation runs and their associated files."""

    @staticmethod
    def get_global_config() -> dict:
        """Returns the global evaluation config from eval_config.yaml."""
        data = get_cached_data(CONFIG_FILE, load_yaml_config)
        return data or {}

    @classmethod
    def import_run_to_db(cls, run_id: str, celery_task_id: Optional[str] = None) -> bool:
        """Parses a local filesystem run directory and imports all JSON and CSV telemetry into MongoDB."""
        from datetime import datetime, timezone
        
        rel_path = run_id.replace("__", os.sep)
        run_dir = REPORTS_DIR / rel_path
        report_file = run_dir / "final_eval_report.json"
        
        if not report_file.exists():
            logger.error(f"Cannot import run '{run_id}': final_eval_report.json does not exist in {run_dir}")
            return False
            
        try:
            with open(report_file, 'r', encoding='utf-8') as f:
                report_data = json.load(f)
        except Exception as e:
            logger.error(f"Failed to read final_eval_report.json for '{run_id}': {e}")
            return False
            
        summary = report_data.get("summary", {})
        methodology = report_data.get("methodology", {})
        
        # 1. Write run metadata
        run_doc = {
            "run_id": run_id,
            "internal_run_id": report_data.get("run_id", ""),
            "provider": report_data.get("provider", "unknown"),
            "dataset_key": methodology.get("dataset_key", "cuad") if methodology else "cuad",
            "contract_count": report_data.get("contract_count", 0),
            "status": "completed",
            "celery_task_id": celery_task_id,
            "summary": summary,
            "methodology": methodology,
            "created_at": datetime.fromtimestamp(run_dir.stat().st_mtime, tz=timezone.utc)
        }
        
        # Replace if existing or insert new
        from core.database import eval_runs_collection, eval_attempts_collection, eval_csvs_collection
        existing_doc = eval_runs_collection.find_one({"run_id": run_id}, {"account_id": 1})
        if existing_doc and existing_doc.get("account_id"):
            run_doc["account_id"] = existing_doc["account_id"]
        else:
            run_doc["account_id"] = "600c00000000000000000001"
        eval_runs_collection.replace_one({"run_id": run_id}, run_doc, upsert=True)
        
        # 2. Write test attempts
        results = report_data.get("results", [])
        attempt_docs = []
        for item in results:
            case_data = item.get("case", {})
            obs_data = item.get("observation", {})
            attempt_docs.append({
                "run_id": run_id,
                "case_id": case_data.get("case_id"),
                "attempt": obs_data.get("attempt", 1),
                "case_spec": {
                    "layer": case_data.get("layer"),
                    "task_type": case_data.get("task_type"),
                    "contract_title": case_data.get("contract_title"),
                    "prompt": case_data.get("prompt"),
                    "gold_labels": case_data.get("gold_labels", [])
                },
                "observation": {
                    "answer": obs_data.get("answer"),
                    "latency_ms": obs_data.get("latency_ms"),
                    "error": obs_data.get("error"),
                    "trace": obs_data.get("trace", [])
                },
                "score": item.get("score", 0.0),
                "passed": item.get("passed", False),
                "hard_gate_passed": item.get("hard_gate_passed", False),
                "metrics": item.get("metrics", {})
            })
            
        # Clean previous attempts for this run
        eval_attempts_collection.delete_many({"run_id": run_id})
        if attempt_docs:
            eval_attempts_collection.insert_many(attempt_docs)
            
        # 3. Write CSV scorecards
        csv_files = ["tool_coverage", "failure_taxonomy", "parameter_scorecard", "kpi_results"]
        for csv_name in csv_files:
            csv_path = run_dir / f"{csv_name}.csv"
            if csv_path.exists():
                rows = parse_csv_file(csv_path)
                eval_csvs_collection.replace_one(
                    {"run_id": run_id, "csv_name": csv_name},
                    {"run_id": run_id, "csv_name": csv_name, "rows": rows},
                    upsert=True
                )
                
        logger.info(f"Successfully imported run '{run_id}' to MongoDB database collections.")
        return True

    @classmethod
    def list_runs(cls, context_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Returns runs from MongoDB. Backfills from local filesystem if any are missing in the DB."""
        from core.database import eval_runs_collection
        from datetime import datetime
        from typing import Optional
        
        # Migrating legacy/unassigned runs to the dedicated Evaluation Team context
        try:
            eval_runs_collection.update_many(
                {"$or": [{"account_id": {"$exists": False}}, {"account_id": None}, {"account_id": "personal"}]},
                {"$set": {"account_id": "600c00000000000000000001"}}
            )
        except Exception as e:
            logger.error(f"Failed to migrate legacy run account IDs: {e}")
        
        # Scan filesystem for reports
        local_run_folders = []
        if REPORTS_DIR.exists():
            for root, dirs, files in os.walk(str(REPORTS_DIR)):
                if "final_eval_report.json" in files:
                    report_dir = Path(root)
                    try:
                        rel_path = report_dir.relative_to(REPORTS_DIR)
                        if str(rel_path) != ".":
                            run_id = str(rel_path).replace(os.sep, "__").replace("/", "__")
                            local_run_folders.append((run_id, report_dir))
                    except ValueError:
                        continue
                        
        # Check database runs
        try:
            query = {}
            if context_id:
                if context_id == "personal":
                    query = {"$or": [{"account_id": "personal"}, {"account_id": {"$exists": False}}, {"account_id": None}]}
                else:
                    query = {"account_id": context_id}
            db_runs = list(eval_runs_collection.find(query, {"_id": 0}))
        except Exception as e:
            logger.error(f"Failed to query DB runs: {e}")
            db_runs = []
            
        db_run_ids = {r["run_id"] for r in db_runs}
        
        # Backfill missing runs to DB
        for run_id, run_dir in local_run_folders:
            if run_id not in db_run_ids:
                logger.info(f"Backfilling run '{run_id}' from filesystem to MongoDB...")
                try:
                    cls.import_run_to_db(run_id)
                except Exception as e:
                    logger.error(f"Failed backfilling run '{run_id}': {e}")
                
        # Re-fetch everything from DB, sorted by created_at descending
        try:
            query = {}
            if context_id:
                if context_id == "personal":
                    query = {"$or": [{"account_id": "personal"}, {"account_id": {"$exists": False}}, {"account_id": None}]}
                else:
                    query = {"account_id": context_id}
            runs = list(eval_runs_collection.find(query, {"_id": 0}))
        except Exception as e:
            logger.error(f"Failed to re-query DB runs: {e}")
            runs = []
        
        # Sort
        def get_created_at(r):
            val = r.get("created_at")
            if isinstance(val, str):
                try:
                    return datetime.fromisoformat(val.replace("Z", "+00:00"))
                except ValueError:
                    return datetime.min
            elif val:
                return val
            return datetime.min
            
        runs.sort(key=get_created_at, reverse=True)
        
        # Map DB model fields to expected list structure
        result_runs = []
        for r in runs:
            summary = r.get("summary", {})
            latency = summary.get("latency", {}) if isinstance(summary, dict) else {}
            result_runs.append({
                "run_id": r.get("run_id"),
                "internal_run_id": r.get("internal_run_id", ""),
                "provider": r.get("provider", "unknown"),
                "dataset": r.get("dataset_key", "cuad"),
                "contract_count": r.get("contract_count", 0),
                "overall_score": summary.get("overall_score", 0.0) if isinstance(summary, dict) else 0.0,
                "passed_attempts": summary.get("passed_attempts", 0) if isinstance(summary, dict) else 0,
                "total_attempts": summary.get("attempts", 0) if isinstance(summary, dict) else 0,
                "hard_gate_passed": r.get("hard_gate_passed", False) or summary.get("hard_gate_passed", False),
                "latency_p50_ms": latency.get("p50_ms"),
                "latency_p95_ms": latency.get("p95_ms"),
                "is_dry_run": r.get("methodology", {}).get("dry_run", True) if r.get("methodology") else True,
                "status": r.get("status", "completed"),
                "celery_task_id": r.get("celery_task_id"),
                "mtime": 0
            })
        return result_runs

    @classmethod
    def get_run_details(
        cls, 
        run_id: str, 
        layer: Optional[str] = None, 
        status: Optional[str] = None, 
        search: Optional[str] = None,
        page: int = 1, 
        limit: int = 50
    ) -> Optional[Dict[str, Any]]:
        """Retrieves details of a single run, querying from MongoDB collections with filters and pagination."""
        from core.database import eval_runs_collection, eval_attempts_collection
        
        # Load run metadata
        run_doc = eval_runs_collection.find_one({"run_id": run_id}, {"_id": 0})
        if not run_doc:
            # Fall back to import if exists locally
            cls.import_run_to_db(run_id)
            run_doc = eval_runs_collection.find_one({"run_id": run_id}, {"_id": 0})
            if not run_doc:
                return None
                
        # Query attempts with filter
        query = {"run_id": run_id}
        if layer:
            query["case_spec.layer"] = layer
        if status:
            if status == "passed":
                query["passed"] = True
            elif status == "failed":
                query["passed"] = False
        if search:
            query["$or"] = [
                {"case_spec.prompt": {"$regex": search, "$options": "i"}},
                {"case_spec.contract_title": {"$regex": search, "$options": "i"}},
                {"case_id": {"$regex": search, "$options": "i"}}
            ]
            
        total_cases = eval_attempts_collection.count_documents(query)
        
        # Apply pagination in Mongo query
        cursor = eval_attempts_collection.find(query, {"_id": 0}).skip((page - 1) * limit).limit(limit)
        attempts = list(cursor)
        
        # Format attempts back to expected results structure
        results = []
        for att in attempts:
            results.append({
                "case": {
                    "case_id": att.get("case_id"),
                    "layer": att.get("case_spec", {}).get("layer"),
                    "task_type": att.get("case_spec", {}).get("task_type"),
                    "contract_title": att.get("case_spec", {}).get("contract_title"),
                    "prompt": att.get("case_spec", {}).get("prompt"),
                    "gold_labels": att.get("case_spec", {}).get("gold_labels", [])
                },
                "observation": att.get("observation", {}),
                "score": att.get("score", 0.0),
                "passed": att.get("passed", False),
                "hard_gate_passed": att.get("hard_gate_passed", False),
                "metrics": att.get("metrics", {})
            })
            
        res = {
            "run_id": run_id,
            "internal_run_id": run_doc.get("internal_run_id", ""),
            "provider": run_doc.get("provider", ""),
            "contract_count": run_doc.get("contract_count", 0),
            "summary": run_doc.get("summary", {}),
            "methodology": run_doc.get("methodology", {}),
            "status": run_doc.get("status", "completed"),
            "celery_task_id": run_doc.get("celery_task_id"),
            "results_summary": {
                "total_filtered": total_cases,
                "page": page,
                "limit": limit,
                "total_pages": (total_cases + limit - 1) // limit if limit > 0 else 1
            },
            "results": results
        }
        return res

    @classmethod
    def get_run_csv(cls, run_id: str, csv_name: str) -> List[Dict[str, str]]:
        """Parses and returns a specific CSV file, querying from MongoDB evaluation_csvs collection."""
        from core.database import eval_csvs_collection
        
        doc = eval_csvs_collection.find_one({"run_id": run_id, "csv_name": csv_name}, {"_id": 0})
        if doc and "rows" in doc:
            return doc["rows"]
            
        # Fall back to import if exists locally
        cls.import_run_to_db(run_id)
        doc = eval_csvs_collection.find_one({"run_id": run_id, "csv_name": csv_name}, {"_id": 0})
        if doc and "rows" in doc:
            return doc["rows"]
            
        return []

    @classmethod
    def list_local_cases(cls, dataset_key: str, search: Optional[str] = None, page: int = 1, limit: int = 25) -> Dict[str, Any]:
        """Loads dataset manifests from local repository, generates EvalCases, and returns a paginated list of cases."""
        import sys
        
        # 1. Add final_evaluation to python path to load modules correctly
        if str(REPO_ROOT) not in sys.path:
            sys.path.insert(0, str(REPO_ROOT))
            
        from final_evaluation.scripts.run_final_eval import load_config, load_manifest, generate_cases
        
        # Load config to get defaults
        config_path = REPO_ROOT / "final_evaluation/config/eval_config.yaml"
        config = load_config(config_path) if config_path.exists() else {}
        
        # Determine manifest file path
        if dataset_key == "kpi":
            manifest_path = REPO_ROOT / "final_evaluation/datasets/kpi_contracts/manifest.json"
        elif dataset_key == "acord":
            manifest_path = REPO_ROOT / "final_evaluation/datasets/acord_manifest.jsonl"
        else:
            manifest_path = REPO_ROOT / "final_evaluation/datasets/cuad_manifest.jsonl"
            
        if not manifest_path.exists():
            return {"cases": [], "total": 0, "page": page, "limit": limit, "total_pages": 1}
            
        # Load maximum 100 contracts to generate case set
        records = load_manifest(manifest_path, contract_count=100)
        
        all_cases = []
        for r in records:
            cases = generate_cases(r, config, dataset_key)
            all_cases.extend(cases)
            
        # Deduplicate cases by case_id
        seen = set()
        deduped_cases = []
        for c in all_cases:
            if c.case_id not in seen:
                seen.add(c.case_id)
                deduped_cases.append(c)
                
        # Apply search filter
        if search:
            search_lower = search.lower()
            filtered = []
            for c in deduped_cases:
                if (search_lower in c.case_id.lower() or 
                    search_lower in c.prompt.lower() or 
                    search_lower in c.contract_title.lower() or 
                    search_lower in c.layer.lower() or 
                    search_lower in c.task_type.lower()):
                    filtered.append(c)
        else:
            filtered = deduped_cases
            
        total = len(filtered)
        
        # Paginate
        start = (page - 1) * limit
        end = start + limit
        paginated = filtered[start:end]
        
        cases_list = [c.to_dict() for c in paginated]
        
        return {
            "cases": cases_list,
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": (total + limit - 1) // limit if limit > 0 else 1
        }

