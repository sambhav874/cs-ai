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


def _build_draft_handler(context: Any) -> Callable[..., Any]:
    """Build a handler for create_draft_artifact using docx_engine."""
    def handler(**kwargs: Any) -> Any:
        document_id = kwargs.get("document_id", "")
        draft_type = kwargs.get("draft_type", "")
        instructions = kwargs.get("instructions", "")

        # Get document content from context
        doc_content = context.get_document_content(document_id)
        if not doc_content:
            raise ToolError(f"Document {document_id} not found or empty")

        # Build sections from instructions + document content
        sections = _build_draft_sections(draft_type, doc_content, instructions)

        # Generate DOCX
        title = f"{draft_type.replace('_', ' ').title()} - {document_id}"
        docx_bytes = generate_docx(title, sections)

        # Store in GridFS via context
        file_id = context.store_document(
            docx_bytes,
            filename=f"{draft_type}_{document_id}_{uuid4().hex[:8]}.docx",
            metadata={
                "type": "draft",
                "draft_type": draft_type,
                "source_document_id": document_id,
                "instructions": instructions,
            },
        )

        return {
            "file_id": str(file_id),
            "document_type": draft_type,
            "message": f"Draft {draft_type.replace('_', ' ')} created successfully.",
            "can_download": True,
        }
    return handler


def _build_redline_handler(context: Any) -> Callable[..., Any]:
    """Build a handler for create_redline_artifact using docx_engine."""
    def handler(**kwargs: Any) -> Any:
        source_id = kwargs.get("document_id", "")
        target_id = kwargs.get("target_document_id", "")
        instructions = kwargs.get("instructions", "")

        # Get source document bytes from context
        source_bytes = context.get_document_bytes(source_id)
        if not source_bytes:
            raise ToolError(f"Source document {source_id} not found")

        # Get target document content for comparison
        target_content = context.get_document_content(target_id) if target_id else ""

        # Parse instructions to extract edits
        edits = _parse_redline_instructions(instructions, target_content)

        # Apply tracked edits
        result = apply_tracked_edits(source_bytes, edits)

        # Store result in GridFS
        file_id = context.store_document(
            result.docx_bytes,
            filename=f"redline_{source_id}_{uuid4().hex[:8]}.docx",
            metadata={
                "type": "redline",
                "source_document_id": source_id,
                "target_document_id": target_id or None,
                "instructions": instructions,
                "changes": [a.to_payload() for a in result.annotations],
                "errors": result.errors,
            },
        )

        return {
            "file_id": str(file_id),
            "changes": [a.to_payload() for a in result.annotations],
            "errors": result.errors,
            "change_count": len(result.annotations),
            "message": f"Redline created with {len(result.annotations)} changes.",
        }
    return handler


def _build_docx_generation_handler(context: Any) -> Callable[..., Any]:
    """Build a handler for generate_docx tool."""
    def handler(**kwargs: Any) -> Any:
        content = kwargs.get("content", "")
        filename = kwargs.get("filename", "document.docx")

        # Parse content into sections
        sections = _parse_content_to_sections(content)

        docx_bytes = generate_docx(filename.replace(".docx", ""), sections)

        file_id = context.store_document(
            docx_bytes,
            filename=filename,
            metadata={"type": "generated_docx"},
        )

        return {
            "file_id": str(file_id),
            "filename": filename,
            "message": "Document generated successfully.",
        }
    return handler


def _build_edit_document_handler(context: Any) -> Callable[..., Any]:
    """Build a handler for edit_document that applies tracked edits."""
    def handler(**kwargs: Any) -> Any:
        document_id = kwargs.get("document_id", "")
        section_id = kwargs.get("section_id", "")
        new_text = kwargs.get("new_text", "")

        # Get document bytes from context
        doc_bytes = context.get_document_bytes(document_id)
        if not doc_bytes:
            raise ToolError(f"Document {document_id} not found")

        # Get current text of the target section
        current_text = context.get_section_text(document_id, section_id)
        if not current_text:
            raise ToolError(f"Section {section_id} not found in document {document_id}")

        # Create an edit for the section
        edit = EditInput(
            find=current_text,
            replace=new_text,
            context_before="",
            context_after="",
            reason=f"Edit section {section_id}",
        )

        result = apply_tracked_edits(doc_bytes, [edit])

        # Store updated document (NEW version, never delete old)
        file_id = context.store_document(
            result.docx_bytes,
            filename=f"edited_{document_id}_{uuid4().hex[:8]}.docx",
            metadata={
                "type": "edited",
                "source_document_id": document_id,
                "section_id": section_id,
            },
        )

        return {
            "file_id": str(file_id),
            "changes": [a.to_payload() for a in result.annotations],
            "errors": result.errors,
            "change_count": len(result.annotations),
            "message": f"Document edited with {len(result.annotations)} tracked change(s).",
        }
    return handler


def _build_modified_copy_handler(context: Any) -> Callable[..., Any]:
    """Build a handler that creates a new document copy with find/replace edits applied as tracked changes.

    Maps directly to user intents like "change contract sum from 5% to 15%"
    or "change the supplier name to Sam Tully".
    """
    def handler(**kwargs: Any) -> Any:
        document_id = kwargs.get("document_id", "")
        edits_raw = kwargs.get("edits", [])
        reason = kwargs.get("reason", "")

        if not document_id:
            raise ToolError("document_id is required")
        if not edits_raw or not isinstance(edits_raw, list):
            raise ToolError("edits must be a non-empty list of {find, replace} objects")

        # Get document bytes from context
        doc_bytes = context.get_document_bytes(document_id)
        if not doc_bytes:
            raise ToolError(f"Document {document_id} not found")

        # Build EditInput objects from the find/replace pairs
        edit_inputs: List[EditInput] = []
        for idx, edit in enumerate(edits_raw):
            if not isinstance(edit, dict):
                raise ToolError(f"edit[{idx}] must be a dict with 'find' and 'replace' keys")
            find = edit.get("find", "")
            replace = edit.get("replace", "")
            if not find:
                raise ToolError(f"edit[{idx}] is missing required 'find' field")
            edit_inputs.append(EditInput(
                find=find,
                replace=replace,
                context_before=edit.get("context_before", ""),
                context_after=edit.get("context_after", ""),
                reason=edit.get("reason", reason or f"Modified copy edit {idx + 1}"),
            ))

        # Apply tracked edits
        result = apply_tracked_edits(doc_bytes, edit_inputs)

        if not result.annotations:
            raise ToolError(
                f"Could not apply edits: {result.errors[0]['reason'] if result.errors else 'no matches found'}"
            )

        # Store as new document version (never delete old)
        filename = f"modified_{document_id}_{uuid4().hex[:8]}.docx"
        file_id = context.store_document(
            result.docx_bytes,
            filename=filename,
            metadata={
                "type": "modified_copy",
                "source_document_id": document_id,
                "edits": edits_raw,
                "change_count": len(result.annotations),
            },
        )

        return {
            "file_id": str(file_id),
            "filename": filename,
            "changes": [a.to_payload() for a in result.annotations],
            "errors": result.errors,
            "change_count": len(result.annotations),
            "message": f"Modified copy created with {len(result.annotations)} tracked change(s).",
        }
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
        "create_draft_artifact": ToolDef(
            name="create_draft_artifact",
            description="Create a draft document artifact (notice, memo, letter, status report, contract summary, etc.). Requires approval.",
            parameters=_schema(
                properties={
                    "document_id": _str_prop("Source document ID to base the draft on."),
                    "draft_type": _str_prop(
                        "Type of draft to create. One of: notice, memo, letter, status_report, contract_summary, amendment, exhibit."
                    ),
                    "instructions": _str_prop("Detailed instructions for what the draft should contain."),
                },
                required=["document_id", "draft_type", "instructions"],
            ),
            handler=_build_draft_handler(context),
            requires_approval=True,
        ),
        "create_redline_artifact": ToolDef(
            name="create_redline_artifact",
            description="Create a redline (tracked changes) document between two versions. Requires approval.",
            parameters=_schema(
                properties={
                    "document_id": _str_prop("Source document ID (the base document)."),
                    "target_document_id": _str_prop("Optional target document ID with proposed changes."),
                    "instructions": _str_prop("Instructions describing the changes to redline."),
                },
                required=["document_id", "instructions"],
            ),
            handler=_build_redline_handler(context),
            requires_approval=True,
        ),
        "generate_docx": ToolDef(
            name="generate_docx",
            description="Export structured content as a formatted DOCX file. Requires approval.",
            parameters=_schema(
                properties={
                    "content": _str_prop(
                        "Markdown content to convert to DOCX. Supports headings, paragraphs, lists, and tables."
                    ),
                    "filename": _str_prop("Output filename ending in .docx."),
                },
                required=["content"],
            ),
            handler=_build_docx_generation_handler(context),
            requires_approval=True,
        ),
        "edit_document": ToolDef(
            name="edit_document",
            description="Apply tracked edits to a specific section of a document. Requires approval.",
            parameters=_schema(
                properties={
                    "document_id": _str_prop("Document ID to edit."),
                    "section_id": _str_prop("Section ID or heading text to identify the section to edit."),
                    "new_text": _str_prop("The replacement text for the identified section."),
                },
                required=["document_id", "section_id", "new_text"],
            ),
            handler=_build_edit_document_handler(context),
            requires_approval=True,
        ),
        "create_modified_copy": ToolDef(
            name="create_modified_copy",
            description="Create a new document copy with find/replace edits applied as tracked changes. "
                        "Provide edits as a list of {find, replace} pairs. "
                        "Use find_in_document first to verify the text exists. "
                        "Requires approval.",
            parameters=_schema(
                properties={
                    "document_id": _str_prop("Source document ID to base the copy on."),
                    "edits": _arr_prop(
                        {"type": "object", "properties": {
                            "find": {"type": "string", "description": "Text to find in the document."},
                            "replace": {"type": "string", "description": "Replacement text."},
                            "context_before": {"type": "string", "description": "Optional text that must appear before the find text to disambiguate."},
                            "context_after": {"type": "string", "description": "Optional text that must appear after the find text to disambiguate."},
                            "reason": {"type": "string", "description": "Optional reason for this specific edit."},
                        }, "required": ["find", "replace"]},
                        "List of {find, replace} edits to apply as tracked changes.",
                    ),
                    "reason": _str_prop("Optional overall reason for creating the modified copy."),
                },
                required=["document_id", "edits"],
            ),
            handler=_build_modified_copy_handler(context),
            requires_approval=True,
        ),
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
        "create_editable_copy": ToolDef(
            name="create_editable_copy",
            description="Create an editable copy of a document. Requires approval.",
            parameters=_schema(
                properties={
                    "document_id": _str_prop("Document ID to copy."),
                    "copy_name": _str_prop("Name for the copy."),
                },
                required=["document_id"],
            ),
            handler=_build_read_handler("create_editable_copy", context),
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
