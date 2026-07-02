"""Single-file tool definitions with OpenAI function-calling schemas.

All tools are defined as plain dict schemas (matching Mike's style) with
clean handler functions. No decorator magic, no Pydantic-LangChain coupling
in the definitions — just schemas + handlers, wired by name at runtime.

Approval-required tools raise ApprovalRequiredError; read-only tools execute
directly via handler_map.
"""

from __future__ import annotations

import ast
import operator
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple
from uuid import uuid4

from services.docx_engine import (
    DocxSection,
    DocxTable,
    EditInput,
    TrackedEditApplyResult,
    TrackedEditAnnotation,
    apply_tracked_edits,
    extract_docx_text,
    extract_tracked_change_ids,
    generate_docx,
    resolve_tracked_changes,
)
from utils.text_cleanup import clean_text_encoding


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class ToolError(Exception):
    """Base error for tool execution."""


class ApprovalRequiredError(ToolError):
    """Raised when a tool requires user approval before execution."""


# ---------------------------------------------------------------------------
# Tool Schema Definition
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ToolDef:
    """A single tool definition with OpenAI function-calling schema."""
    name: str
    description: str
    parameters: Dict[str, Any]  # JSON Schema object
    handler: Callable[..., Any]
    requires_approval: bool = False


def _str_prop(description: str) -> Dict[str, str]:
    return {"type": "string", "description": description}


def _int_prop(description: str) -> Dict[str, str]:
    return {"type": "integer", "description": description}


def _bool_prop(description: str) -> Dict[str, str]:
    return {"type": "boolean", "description": description}


def _arr_prop(items: Dict[str, str], description: str) -> Dict[str, Any]:
    return {"type": "array", "items": items, "description": description}


def _schema(
    properties: Dict[str, Any],
    required: List[str],
) -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }


# ---------------------------------------------------------------------------
# Handler: read-only tools
# ---------------------------------------------------------------------------

# These handlers receive a context object with access to MongoDB, vector store,
# evidence service, etc. They're defined as closures in build_tools() so they
# can capture the context at construction time.
#
# For now, define the function signatures and let build_tools() wire the
# actual implementations.

# ---------------------------------------------------------------------------
# Handler implementation
# ---------------------------------------------------------------------------

def _build_read_handler(
    fn_name: str,
    context: Any,
) -> Callable[..., Any]:
    """Build a read-only handler that delegates to the context executor."""
    def handler(**kwargs: Any) -> Any:
        return context.execute_tool(fn_name, kwargs)
    return handler





# ---------------------------------------------------------------------------
# Tools — Full Definition List
# ---------------------------------------------------------------------------

def build_all_tools(context: Any) -> Dict[str, ToolDef]:
    """Build all tool definitions, wiring handler closures to the given context.

    The context object must provide:
      - execute_tool(name, kwargs)  — for read-only tools
      - get_document_content(id)    → str
      - get_document_bytes(id)      → bytes
      - get_section_text(doc_id, section_id) → str
      - store_document(bytes, filename, metadata) → file_id
      + any other methods needed by approval-only tool handlers
    """
    return {
        # ── Read-only tools ──────────────────────────────────────────
        "list_documents": ToolDef(
            name="list_documents",
            description="Lists scoped documents with IDs, filenames, indexing metadata.",
            parameters=_schema(
                properties={"project_id": _str_prop("Optional project ID to scope documents.")},
                required=[],
            ),
            handler=_build_read_handler("list_documents", context),
        ),
        "read_document": ToolDef(
            name="read_document",
            description="Reads an excerpt from the current/requested document.",
            parameters=_schema(
                properties={
                    "document_id": _str_prop("The document ID to read from."),
                },
                required=["document_id"],
            ),
            handler=_build_read_handler("read_document", context),
        ),
        "outline_document": ToolDef(
            name="outline_document",
            description="Returns document outline with section headings.",
            parameters=_schema(
                properties={
                    "document_id": _str_prop("The document ID to outline."),
                },
                required=["document_id"],
            ),
            handler=_build_read_handler("outline_document", context),
        ),
        "fetch_documents": ToolDef(
            name="fetch_documents",
            description="Fetches metadata for scoped indexed documents.",
            parameters=_schema(
                properties={
                    "document_ids": _arr_prop(
                        {"type": "string"},
                        "Array of document IDs to fetch metadata for.",
                    ),
                },
                required=[],
            ),
            handler=_build_read_handler("fetch_documents", context),
        ),
        "search_evidence": ToolDef(
            name="search_evidence",
            description="Search contracts and return clause text with citations.",
            parameters=_schema(
                properties={
                    "query": _str_prop("Natural language search query."),
                    "queries": _arr_prop(
                        {"type": "string"},
                        "Multiple search queries to run in parallel.",
                    ),
                    "document_ids": _arr_prop(
                        {"type": "string"},
                        "Optional document IDs to scope the search.",
                    ),
                    "top_k": _int_prop("Number of top results to return (default: 5)."),
                    "intent": _str_prop("Search intent: 'clause', 'definition', 'obligation', 'exhibit'."),
                    "must_contain": _str_prop("Terms that must appear in results."),
                    "section_ref": _str_prop("Section reference to search within."),
                },
                required=["query"],
            ),
            handler=_build_read_handler("search_evidence", context),
        ),
        "find_in_document": ToolDef(
            name="find_in_document",
            description="Find a term, phrase, or clause inside a document.",
            parameters=_schema(
                properties={
                    "document_id": _str_prop("Document ID to search in."),
                    "term": _str_prop("Term or phrase to find."),
                    "query": _str_prop("Alternative natural language query for the term."),
                },
                required=["document_id"],
            ),
            handler=_build_read_handler("find_in_document", context),
        ),
        "get_kpi_context": ToolDef(
            name="get_kpi_context",
            description="Retrieve KPI/SLA targets, actuals, and breach state.",
            parameters=_schema(
                properties={
                    "contract_id": _str_prop("Contract/Project ID to get KPIs for."),
                    "metric_name": _str_prop("Optional specific metric name."),
                    "query": _str_prop("Optional natural language query about KPI."),
                },
                required=["contract_id"],
            ),
            handler=_build_read_handler("get_kpi_context", context),
        ),
        "calculate_from_evidence": ToolDef(
            name="calculate_from_evidence",
            description="Evaluate an arithmetic expression using evidence-sourced values.",
            parameters=_schema(
                properties={
                    "expression": _str_prop("Arithmetic expression. Use numbers or 'evidence_value(x)'."),
                    "context": _str_prop("Explanation of what the expression represents."),
                },
                required=["expression"],
            ),
            handler=_safe_eval_handler,
        ),

        # ── Approval-required tools ──────────────────────────────────

        "extract_kpis": ToolDef(
            name="extract_kpis",
            description="Extract draft KPIs from a contract. Requires approval.",
            parameters=_schema(
                properties={
                    "contract_id": _str_prop("Contract ID to extract KPIs from."),
                    "replace_drafts": _bool_prop("Whether to replace existing draft KPIs."),
                    "ai_provider": _str_prop("Optional AI provider override."),
                },
                required=["contract_id"],
            ),
            handler=_build_read_handler("extract_kpis", context),
            requires_approval=True,
        ),

        "duplicate_document_copy": ToolDef(
            name="duplicate_document_copy",
            description="Duplicate an existing document copy. Requires approval.",
            parameters=_schema(
                properties={
                    "document_id": _str_prop("Document ID to duplicate."),
                    "new_name": _str_prop("Name for the duplicated copy."),
                },
                required=["document_id"],
            ),
            handler=_build_read_handler("duplicate_document_copy", context),
            requires_approval=True,
        ),
        "create_tabular_review": ToolDef(
            name="create_tabular_review",
            description="Create a structured tabular review of documents. Requires approval.",
            parameters=_schema(
                properties={
                    "name": _str_prop("Name of the tabular review."),
                    "document_ids": _arr_prop(
                        {"type": "string"},
                        "Document IDs to include in the review.",
                    ),
                    "columns": _arr_prop(
                        {"type": "string"},
                        "Column names for the review table.",
                    ),
                },
                required=["name", "document_ids", "columns"],
            ),
            handler=_build_read_handler("create_tabular_review", context),
            requires_approval=True,
        ),
        "generate_tabular_review": ToolDef(
            name="generate_tabular_review",
            description="Generate cells for a tabular review by analyzing documents. Requires approval.",
            parameters=_schema(
                properties={
                    "review_id": _str_prop("Tabular review ID to generate."),
                    "instructions": _str_prop("Instructions for how to generate the review cells."),
                },
                required=["review_id"],
            ),
            handler=_build_read_handler("generate_tabular_review", context),
            requires_approval=True,
        ),
        "replicate_document": ToolDef(
            name="replicate_document",
            description="Replicate a document to another project. Requires approval.",
            parameters=_schema(
                properties={
                    "document_id": _str_prop("Document ID to replicate."),
                    "target_project_id": _str_prop("Target project ID."),
                },
                required=["document_id", "target_project_id"],
            ),
            handler=_build_read_handler("replicate_document", context),
            requires_approval=True,
        ),
        "suggest_tabular_review": ToolDef(
            name="suggest_tabular_review",
            description="Suggest column configuration for a tabular review. Requires approval.",
            parameters=_schema(
                properties={
                    "name": _str_prop("Name of the tabular review."),
                    "document_ids": _arr_prop(
                        {"type": "string"},
                        "Document IDs to review.",
                    ),
                    "columns": _arr_prop(
                        {"type": "string"},
                        "Suggested column names.",
                    ),
                },
                required=["name", "document_ids", "columns"],
            ),
            handler=_build_read_handler("suggest_tabular_review", context),
            requires_approval=True,
        ),
    }


def to_openai_schemas(tools: Dict[str, ToolDef]) -> List[Dict[str, Any]]:
    """Convert ToolDef dict to OpenAI tool-calling schema list.

    Same as Mike's approach of building the schema list dynamically rather
    than relying on LangChain's automatic schema generation.
    """
    result = []
    for name, tdef in tools.items():
        result.append({
            "type": "function",
            "function": {
                "name": name,
                "description": tdef.description,
                "parameters": tdef.parameters,
            },
        })
    return result


def get_tool_names(tools: Dict[str, ToolDef]) -> List[str]:
    return list(tools.keys())


# ---------------------------------------------------------------------------
# Safe arithmetic evaluator (replaces eval())
# ---------------------------------------------------------------------------

_SAFE_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Pow: operator.pow,
    ast.Mod: operator.mod,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}


def _safe_eval_handler(**kwargs: Any) -> Any:
    """Evaluate a safe arithmetic expression. Replaces the old eval() usage."""
    expression = kwargs.get("expression", "")
    context_str = kwargs.get("context", "")

    if not expression:
        raise ToolError("Expression is required")

    # Handle evidence_value() placeholders
    def _resolve_evidence(match: re.Match) -> str:
        return match.group(1)

    cleaned = re.sub(r'evidence_value\(([^)]+)\)', _resolve_evidence, expression)

    try:
        tree = ast.parse(cleaned, mode="eval")
        if not isinstance(tree, ast.Expression):
            raise ToolError("Invalid expression")

        result = _eval_safe_node(tree.body)
        return {
            "expression": expression,
            "result": result,
            "context": context_str,
        }
    except (SyntaxError, ValueError) as e:
        raise ToolError(f"Invalid expression: {e}") from e


def _eval_safe_node(node: ast.AST) -> float:
    """Recursively evaluate an AST node using only safe operators."""
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            return float(node.value)
        raise ToolError(f"Unsupported constant type: {type(node.value).__name__}")
    elif isinstance(node, ast.BinOp):
        op_cls = type(node.op)
        op_fn = _SAFE_OPERATORS.get(op_cls)
        if op_fn is None:
            raise ToolError(f"Unsupported operator: {op_cls.__name__}")
        return op_fn(_eval_safe_node(node.left), _eval_safe_node(node.right))
    elif isinstance(node, ast.UnaryOp):
        op_cls = type(node.op)
        op_fn = _SAFE_OPERATORS.get(op_cls)
        if op_fn is None:
            raise ToolError(f"Unsupported unary operator: {op_cls.__name__}")
        return op_fn(_eval_safe_node(node.operand))
    raise ToolError(f"Unsupported expression node: {type(node).__name__}")


# ---------------------------------------------------------------------------
# Internal helpers for draft/redline parsing
# ---------------------------------------------------------------------------

def _build_draft_sections(
    draft_type: str,
    doc_content: str,
    instructions: str,
) -> List[DocxSection]:
    """Build DocxSections from draft type, document content, and instructions.

    This is a simple default builder. In production, context.get_draft_builder()
    would be used for more sophisticated draft generation.
    """
    sections: List[DocxSection] = []

    # Source document summary
    sections.append(DocxSection(
        heading="Source Document",
        level=1,
        content=_truncate_text(doc_content, 2000),
        page_break=False,
    ))

    # Instructions
    sections.append(DocxSection(
        heading="Draft Instructions",
        level=1,
        content=instructions,
        page_break=False,
    ))

    # Draft body placeholder
    sections.append(DocxSection(
        heading="Draft",
        level=1,
        content=f"[This is a {draft_type.replace('_', ' ')} draft document based on the source document and instructions above.]",
        page_break=True,
    ))

    return sections


def _parse_redline_instructions(
    instructions: str,
    target_content: str,
) -> List[EditInput]:
    """Parse redline instructions into a list of EditInputs.

    Expects instructions with clear find/replace directives or uses a diff-based
    approach when target content is provided.
    """
    edits: List[EditInput] = []

    if not instructions:
        return edits

    # Try to parse structured find/replace directives
    find_replace_pattern = re.compile(
        r'(?:FIND|find|Find):\s*(.+?)\s*(?:REPLACE|replace|Replace):\s*(.+?)(?:\s*(?:BECAUSE|because|Because):\s*(.+?))?(?=\s*(?:FIND|find|Find)|\s*$)',
        re.DOTALL,
    )

    matches = list(find_replace_pattern.finditer(instructions))
    if matches:
        for m in matches:
            find_text = m.group(1).strip()
            replace_text = m.group(2).strip()
            reason = (m.group(3) or "").strip()
            if find_text:
                edits.append(EditInput(
                    find=find_text,
                    replace=replace_text,
                    reason=reason or "Redline edit",
                ))
    elif target_content:
        # Fallback: create a single edit replacing entire content
        edits.append(EditInput(
            find=target_content[:500],  # Use first 500 chars as anchor
            replace=target_content,
            reason="Redline edit from instructions",
        ))

    return edits


def _parse_content_to_sections(content: str) -> List[DocxSection]:
    """Parse markdown-like content into DocxSections.

    Supports:
      # Heading → DocxSection with heading
      ## Subheading → DocxSection level 2
      - List item → Paragraph in current section
      1. Numbered → Paragraph in current section
      | Table | → DocxTable
      [pagebreak] → Page break
    """
    sections: List[DocxSection] = []
    lines = content.split("\n")
    current_heading = None
    current_level = 1
    current_content: List[str] = []
    current_table: Optional[DocxTable] = None
    page_break = False

    def _flush_section() -> None:
        nonlocal current_table
        if current_table or current_content or current_heading or page_break:
            sections.append(DocxSection(
                heading=current_heading,
                level=current_level,
                content="\n".join(current_content).strip() if current_content else None,
                page_break=page_break,
                table=current_table,
            ))
            current_content.clear()
            current_table = None

    for line in lines:
        stripped = line.strip()

        # Page break marker
        if stripped.lower() in ("[pagebreak]", "[page_break]", "---"):
            page_break = True
            continue

        # Table detection
        if stripped.startswith("|") and stripped.endswith("|"):
            cells = [c.strip() for c in stripped.split("|")[1:-1]]
            if current_table is None:
                current_table = DocxTable(headers=cells, rows=[])
            else:
                current_table.rows.append(cells)
            continue

        # Heading detection
        heading_match = re.match(r"^(#{1,3})\s+(.+)$", stripped)
        if heading_match:
            _flush_section()
            page_break = False
            current_level = len(heading_match.group(1))
            current_heading = heading_match.group(2)
            continue

        if stripped:
            current_content.append(stripped)

    _flush_section()
    return sections


def _truncate_text(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n\n[... truncated ...]"
