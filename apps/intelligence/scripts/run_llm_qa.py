#!/usr/bin/env python3
"""CLI tool to run ContractSense LLM Q/A directly in the terminal."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

# Add backend directory to sys.path to enable correct module imports
backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from core.config import settings
from services.contract_agent.rag.facade import ContractRAGSystem


def log(*args: Any, **kwargs: Any) -> None:
    """Print diagnostic messages to stderr."""
    kwargs.setdefault("file", sys.stderr)
    print(*args, **kwargs)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run LLM Q/A on a contract using ContractSense RAG systems."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--contract-id",
        type=str,
        help="ID of the contract in MongoDB to query.",
    )
    group.add_argument(
        "--contract-name",
        type=str,
        help="Name of the contract in MongoDB to search for and query.",
    )
    group.add_argument(
        "--file",
        type=str,
        help="Path to a local text/markdown file to run Q/A on directly (in-memory mode).",
    )
    parser.add_argument(
        "-q",
        "--question",
        type=str,
        help="Question to ask. If omitted, you will be prompted interactively.",
    )
    parser.add_argument(
        "--provider",
        type=str,
        choices=["groq", "openai", "gemini", "claude"],
        help="AI provider to use (default: configured in eval/app settings).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output the structured result in clean JSON format (answer, citations, confidence) to stdout.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print verbose logs and full citation details (ignored in --json mode).",
    )

    args = parser.parse_args()

    # Determine AI Provider
    provider = args.provider or getattr(settings, "ai_provider", "groq")
    log(f"[*] Initializing ContractRAGSystem using provider: {provider.upper()}")
    rag = ContractRAGSystem(ai_provider=provider)

    contract_text = ""
    contract_name = "Local Contract"
    contract_id = "temp-local-id"

    # Load contract content based on inputs
    if args.file:
        file_path = Path(args.file)
        if not file_path.exists():
            log(f"[!] Error: File '{file_path}' does not exist.")
            sys.exit(1)
        try:
            contract_text = file_path.read_text(encoding="utf-8")
            contract_name = file_path.name
            log(f"[*] Loaded raw file: {contract_name} ({len(contract_text)} chars)")
        except Exception as exc:
            log(f"[!] Failed to read file: {exc}")
            sys.exit(1)
    else:
        # Load from MongoDB
        try:
            from core.database import db, collection
            from bson import ObjectId
        except ImportError as exc:
            log(f"[!] Error importing DB client: {exc}")
            log("[!] Please run the script in the poetry environment where backend dependencies are installed.")
            sys.exit(1)

        doc = None
        if args.contract_id:
            try:
                oid = ObjectId(args.contract_id) if ObjectId.is_valid(args.contract_id) else args.contract_id
                doc = collection.find_one({"_id": oid})
            except Exception as exc:
                log(f"[!] DB find error: {exc}")
            if not doc:
                # Fallback to string matching
                doc = collection.find_one({"_id": args.contract_id})
        elif args.contract_name:
            doc = collection.find_one({"contract_name": args.contract_name})
            if not doc:
                # Case-insensitive fuzzy search fallback
                doc = collection.find_one({"contract_name": {"$regex": args.contract_name, "$options": "i"}})

        if not doc:
            log(f"[!] Error: Could not find contract matching criteria in MongoDB.")
            sys.exit(1)

        contract_id = str(doc["_id"])
        contract_name = doc.get("contract_name") or doc.get("filename") or "DB Contract"
        index_data = doc.get("index") or {}
        contract_text = index_data.get("content") or doc.get("content") or ""

        log(f"[*] Found contract in DB: {contract_name}")
        log(f"    ID: {contract_id}")
        log(f"    Length: {len(contract_text)} characters")

    # Get question from prompt or stdin
    question = args.question
    if not question:
        try:
            question = input("\nEnter your contract question: ").strip()
        except (KeyboardInterrupt, EOFError):
            log("\nExiting.")
            sys.exit(0)

    if not question:
        log("[!] Error: No question provided.")
        sys.exit(1)

    log(f"\n[*] Querying: '{question}'")
    log("[*] Processing RAG pipeline (retrieval + tool planning + verification)...")

    current_step = None

    def handle_event(event_type: str, data: Dict[str, Any]) -> None:
        nonlocal current_step
        if event_type == "thinking":
            iteration = data.get("iteration", 1)
            msg = data.get("message") or ""
            if current_step != iteration:
                if current_step is not None:
                    sys.stderr.write("\n")
                sys.stderr.write(f"[*] [Thinking Step {iteration}]: ")
                current_step = iteration
            sys.stderr.write(msg)
            sys.stderr.flush()
        elif event_type == "tool_call":
            if current_step is not None:
                sys.stderr.write("\n")
                current_step = None
            log(f"[*] [Tool Call Step {data.get('iteration', 1)}]: Calling {data.get('name')} with args: {data.get('args')}")
        elif event_type == "tool_result":
            if current_step is not None:
                sys.stderr.write("\n")
                current_step = None
            log(f"[*] [Tool Result Step {data.get('iteration', 1)}]: {data.get('name')} status: {data.get('status')}")

    try:
        qa = rag.answer_agent_question(
            contract_text=contract_text,
            contract_name=contract_name,
            contract_id=contract_id,
            question=question,
            on_event=handle_event,
        )
        if current_step is not None:
            sys.stderr.write("\n")

        if args.json:
            # Format citations to show the actual chunks/quotes that were cited
            citations_list = []
            citation_details = getattr(qa, "citation_details", None) or {}
            annotations = citation_details.get("annotations") or []
            for ann in annotations:
                citations_list.append({
                    "ref": ann.get("ref"),
                    "quote": ann.get("quote") or ann.get("text") or "",
                    "page": ann.get("page") or ann.get("page_number"),
                })
            
            # If annotations is empty but cited_segments exists:
            if not citations_list and citation_details.get("cited_segments"):
                for index, seg in enumerate(citation_details["cited_segments"], start=1):
                    citations_list.append({
                        "ref": index,
                        "quote": seg.get("quote") or seg.get("text") or "",
                        "page": seg.get("page") or seg.get("page_number"),
                    })

            tools_called = list(dict.fromkeys(rag.last_agent_trace.get("tools", []))) if rag.last_agent_trace else []
            out_dict = {
                "answer": qa.answer,
                "citations": citations_list,
                "confidence": qa.confidence,
                "tools_called": tools_called,
            }
            print(json.dumps(out_dict, indent=2))
        else:
            # Human-readable stdout output
            print("\n" + "=" * 60)
            print("ANSWER:")
            print("=" * 60)
            print(qa.answer)
            print("-" * 60)
            print(f"CONFIDENCE: {qa.confidence.upper()}")
            if qa.citation:
                print(f"CITATIONS (Pages): {qa.citation}")
            if rag.last_agent_trace and rag.last_agent_trace.get("tools"):
                tools_called = list(dict.fromkeys(rag.last_agent_trace["tools"]))
                print(f"TOOLS CALLED: {', '.join(tools_called)}")
            if qa.reason:
                print(f"REASON / RATIONALE: {qa.reason}")
            print("=" * 60)

            if args.verbose and hasattr(qa, "citation_details"):
                print("\nCITATION DETAILS (JSON):")
                print(json.dumps(qa.citation_details, indent=2, default=str))

    except Exception as exc:
        log(f"\n[!] Error running Q/A: {exc}")
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
