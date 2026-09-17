#!/usr/bin/env python3
"""Interactive CLI wrapper to easily run ContractSense evaluation suites."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from core.config import settings
from core.security import create_access_token


def prompt_choice(question: str, options: list[str], default: int = 1) -> str:
    print(f"\n{question}")
    for idx, opt in enumerate(options, 1):
        indicator = "*" if idx == default else " "
        print(f"  [{idx}] {opt} {indicator if idx == default else ''}")
    
    while True:
        try:
            choice = input(f"Select choice [1-{len(options)}] (Default {default}): ").strip()
            if not choice:
                return options[default - 1].split()[0].lower()
            val = int(choice)
            if 1 <= val <= len(options):
                return options[val - 1].split()[0].lower()
        except ValueError:
            pass
        print(f"[!] Invalid input. Please select a number between 1 and {len(options)}.")


def prompt_input(question: str, default: str) -> str:
    val = input(f"\n{question} (Default: {default}): ").strip()
    return val if val else default


def get_auto_token() -> str:
    """Import and run core database check to retrieve or generate the token for demouser."""
    from datetime import timedelta
    from core.database import users_collection, accounts_collection
    from core.security import get_password_hash
    from datetime import datetime
    from bson import ObjectId

    user = users_collection.find_one({"username": "demouser"})
    eval_team_id_str = "600c00000000000000000001"
    eval_team_oid = ObjectId(eval_team_id_str)

    if not user:
        hashed_password = get_password_hash("DemoPassword123!")
        new_user = {
            "username": "demouser",
            "email": "demouser@contractsense.com",
            "hashed_password": hashed_password,
            "tokens": 0,
            "teamIds": [eval_team_id_str],
            "disabled": False
        }
        insert_result = users_collection.insert_one(new_user)
        user_id = insert_result.inserted_id
        
        # Add demouser to Evaluation Team members
        from core.database import db
        teams_collection = db["teams"]
        teams_collection.update_one(
            {"_id": eval_team_oid},
            {
                "$push": {
                    "members": {
                        "userId": user_id,
                        "team_role": "member",
                        "addedBy": user_id,
                        "addedAt": datetime.utcnow()
                    }
                }
            }
        )

        account_data = {
            "user_id": user_id,
            "page_credits": 10000,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }
        accounts_collection.insert_one(account_data)
    else:
        user_id = user["_id"]
        # Ensure they are in the teamIds list
        if eval_team_id_str not in user.get("teamIds", []):
            users_collection.update_one(
                {"_id": user_id},
                {"$addToSet": {"teamIds": eval_team_id_str}}
            )
            # Add to teams members list
            from core.database import db
            teams_collection = db["teams"]
            team = teams_collection.find_one({"_id": eval_team_oid, "members.userId": user_id})
            if not team:
                teams_collection.update_one(
                    {"_id": eval_team_oid},
                    {
                        "$push": {
                            "members": {
                                "userId": user_id,
                                "team_role": "member",
                                "addedBy": user_id,
                                "addedAt": datetime.utcnow()
                            }
                        }
                    }
                )
        # Ensure credits are topped up
        accounts_collection.update_one(
            {"user_id": user_id},
            {"$set": {"page_credits": 10000, "updated_at": datetime.utcnow()}},
            upsert=True
        )
    
    from core.security import create_access_token
    return create_access_token(data={"sub": "demouser"}, expires_delta=timedelta(days=7))


def main():
    print("=" * 70)
    print(" CONTRACTSENSE EVALUATION RUNNER ")
    print("=" * 70)

    # 1. Select Dataset
    dataset = prompt_choice(
        "Which dataset do you want to evaluate?",
        ["CUAD (Standard Atticus contracts)", "ACORD (Clause retrieval precision)", "KPI (High-density KPI contracts)", "ALL (KPI, CUAD, and ACORD split)"],
        default=3  # Recommend KPI
    )

    # 2. Select Mode
    mode = prompt_choice(
        "Select run execution mode:",
        ["Dry (Simulation mode, scores generated cases locally without API calls)", "Live (Runs cases against live API server)"],
        default=1
    )

    # 2b. Select Provider
    provider = prompt_choice(
        "Select AI Provider:",
        ["Groq (Official)", "Gemini", "OpenAI", "Claude"],
        default=1
    )

    # 3. Choose count
    if dataset == "all":
        default_count = "3"
        count = prompt_input("Total contracts/query records to evaluate? (Will be divided evenly, e.g. 1 per dataset)", default_count)
    else:
        default_count = "5" if dataset == "kpi" else "10"
        count = prompt_input("How many contracts/query records to evaluate?", default_count)

    # 4. Optional parameters
    keep_fixtures = "false"
    if mode == "live":
        keep = prompt_choice("Keep temporary database projects/fixtures after run?", ["No (Clean up afterward)", "Yes (Keep for debugging)"], default=1)
        if keep == "yes":
            keep_fixtures = "true"

    # 4b. Citation gate option
    skip_citation = prompt_choice("Bypass the citation hard-gate in scoring?", ["No (Keep strict citation scoring)", "Yes (Bypass citation hard-gate)"], default=1)

    # 5. Handle auth token for live run
    auth_token = ""
    if mode == "live":
        auth_token = input("\nEnter Auth Token (Or press Enter to auto-generate one for demouser): ").strip()
        if not auth_token:
            print("[*] Auto-generating demo account token...")
            try:
                auth_token = get_auto_token()
                print("[+] Successfully generated token.")
            except Exception as e:
                print(f"[!] Failed to auto-generate token: {e}")
                auth_token = input("Please enter auth token manually: ").strip()

    # 6. Construct and confirm CLI command(s)
    runs_to_execute = []
    if dataset == "all":
        try:
            total_count = int(count)
        except ValueError:
            total_count = 3
        # Divide count evenly (at least 1 per dataset)
        per_dataset = max(1, total_count // 3)
        for ds in ["kpi", "cuad", "acord"]:
            runs_to_execute.append((ds, str(per_dataset)))
    else:
        runs_to_execute.append((dataset, count))

    commands = []
    root_dir = Path(__file__).resolve().parents[3]  # extractor root directory
    script_path = root_dir / "final_evaluation/scripts/run_final_eval.py"
    for ds, ds_count in runs_to_execute:
        output_dir = root_dir / f"final_evaluation/reports/{ds}_{mode}"
        cmd = [
            sys.executable,
            str(script_path),
            "--dataset", ds,
            "--contract-count", ds_count,
            "--provider", provider,
            "--output-dir", str(output_dir)
        ]
        if ds == "kpi":
            manifest_path = root_dir / "final_evaluation/datasets/kpi_contracts/manifest.json"
            cmd.extend(["--manifest", str(manifest_path)])
        if skip_citation == "yes":
            cmd.append("--skip-citation-gate")
        if mode == "dry":
            cmd.append("--dry-run")
        else:
            cmd.extend([
                "--api-base-url", "http://127.0.0.1:8000/api/v1",
                "--smoke-profile", "balanced"
            ])
            if keep_fixtures == "true":
                cmd.append("--keep-fixtures")
        commands.append((ds, cmd))

    # Set up environment variables
    env = os.environ.copy()
    env["PYTHONPATH"] = "../.."
    if auth_token:
        env["CONTRACTSENSE_FINAL_EVAL_AUTH_TOKEN"] = auth_token

    print("\n" + "=" * 70)
    print("CONSTRUCTED COMMAND(S) TO RUN")
    print("=" * 70)
    for ds, cmd in commands:
        print(f"[{ds.upper()}] " + " ".join(cmd))
    print("=" * 70)

    confirm = input("\nDo you want to run these commands now? [Y/n]: ").strip().lower()
    if confirm in ("", "y", "yes"):
        for ds, cmd in commands:
            print(f"\n[*] Starting {ds.upper()} evaluation run...\n")
            try:
                subprocess.run(cmd, env=env, cwd=str(root_dir), check=True)
            except KeyboardInterrupt:
                print("\n[!] Evaluation run interrupted by user.")
                break
            except subprocess.CalledProcessError as e:
                print(f"\n[!] Evaluation runner for {ds.upper()} exited with error code {e.returncode}")
                break
    else:
        print("\n[x] Cancelled.")


if __name__ == "__main__":
    main()
