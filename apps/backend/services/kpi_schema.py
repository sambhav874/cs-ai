"""KPI Schema V2 - Layered FlexField Rule Model.

Provides schema versioning, typed rule specification validation,
safe AST arithmetic expression evaluation, DAG cycle detection for composite KPIs,
V1 to V2 migration logic, and a backward-compatibility translation shim.
"""

from __future__ import annotations

import ast
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Union

logger = logging.getLogger(__name__)

KPI_SCHEMA_VERSION = 2

# Recognized Rule Types
RULE_TYPES = {
    "threshold",
    "range",
    "tiered",
    "deadline",
    "composite",
    "error_budget",
    "evidence",
    "qualitative",
}


# ============================================================================
# FlexField Helpers
# ============================================================================

def get_flex_attribute(doc: Dict[str, Any], key: str, default: Any = None) -> Any:
    """Safely retrieves a custom attribute from a V2 document's custom_attributes bag or top-level V1 fallback."""
    if not isinstance(doc, dict):
        return default
    custom_attrs = doc.get("custom_attributes")
    if isinstance(custom_attrs, dict) and key in custom_attrs:
        return custom_attrs[key]
    return doc.get(key, default)


def set_flex_attribute(doc: Dict[str, Any], key: str, value: Any) -> Dict[str, Any]:
    """Safely sets a custom attribute inside a V2 document's custom_attributes bag."""
    if "custom_attributes" not in doc or not isinstance(doc["custom_attributes"], dict):
        doc["custom_attributes"] = {}
    doc["custom_attributes"][key] = value
    return doc


# ============================================================================
# Rule Spec Validation (Write Time)
# ============================================================================

def validate_rule_spec(
    rule_type: str,
    spec: Dict[str, Any],
    kpis_in_contract: Optional[List[Dict[str, Any]]] = None,
) -> List[str]:
    """Validates a rule specification object for the given rule_type.

    Returns a list of error message strings. An empty list indicates valid spec.
    """
    errors: List[str] = []
    if not rule_type or rule_type not in RULE_TYPES:
        if not isinstance(spec, dict):
            return [f"Rule spec must be a dictionary, got {type(spec).__name__}"]
        return []

    if not isinstance(spec, dict):
        return [f"Spec for rule_type '{rule_type}' must be a dictionary."]

    if rule_type == "threshold":
        target = spec.get("target")
        if target is None and "value" not in spec and "target_value" not in spec:
            errors.append("threshold rule spec must contain a numeric 'target'.")
        elif target is not None and not isinstance(target, (int, float)):
            errors.append(f"threshold 'target' must be numeric, got {type(target).__name__}.")

    elif rule_type == "range":
        min_val = spec.get("min")
        max_val = spec.get("max")
        if min_val is None or max_val is None:
            errors.append("range rule spec must contain both 'min' and 'max' numbers.")
        elif not isinstance(min_val, (int, float)) or not isinstance(max_val, (int, float)):
            errors.append("range 'min' and 'max' must be numeric.")
        elif min_val >= max_val:
            errors.append(f"range 'min' ({min_val}) must be strictly less than 'max' ({max_val}).")

    elif rule_type == "tiered":
        tiers = spec.get("tiers")
        if not tiers or not isinstance(tiers, list):
            errors.append("tiered rule spec must contain a non-empty 'tiers' list.")
        else:
            prev_val = None
            for idx, tier in enumerate(tiers):
                if not isinstance(tier, dict):
                    errors.append(f"Tier at index {idx} must be a dictionary.")
                    continue
                val = tier.get("value")
                if val is None or not isinstance(val, (int, float)):
                    errors.append(f"Tier at index {idx} missing numeric 'value'.")
                    continue
                if prev_val is not None and val <= prev_val:
                    errors.append(
                        f"Tiers must be sorted ascending by value without overlapping ranges. "
                        f"Tier at index {idx} ({val}) is <= previous tier ({prev_val})."
                    )
                prev_val = val

        interpolation = spec.get("interpolation", "step")
        if interpolation not in ("linear", "step"):
            errors.append(f"tiered 'interpolation' must be 'linear' or 'step', got '{interpolation}'.")

    elif rule_type == "deadline":
        grace_days = spec.get("grace_days", 0)
        if not isinstance(grace_days, int) or grace_days < 0:
            errors.append("deadline 'grace_days' must be a non-negative integer.")

    elif rule_type == "composite":
        formula = spec.get("formula")
        ref_kpi_ids = spec.get("ref_kpi_ids", [])
        if not formula or not isinstance(formula, str) or not formula.strip():
            errors.append("composite rule spec must contain a non-empty 'formula' string.")
        else:
            try:
                evaluate_safe_formula(formula, context={k: 1.0 for k in ref_kpi_ids})
            except Exception as exc:
                errors.append(f"composite formula validation failed: {exc}")

        if not isinstance(ref_kpi_ids, list):
            errors.append("composite 'ref_kpi_ids' must be a list of string KPI IDs.")

        if kpis_in_contract is not None and not spec.get("cross_contract", False):
            known_ids = {
                (k.get("kpi_id") or (k.get("identity", {}).get("canonical_metric_key") if isinstance(k.get("identity"), dict) else None))
                for k in kpis_in_contract
            }
            known_ids.discard(None)
            for ref_id in ref_kpi_ids:
                if ref_id not in known_ids:
                    errors.append(f"composite ref_kpi_id '{ref_id}' does not exist in this contract.")

    elif rule_type == "error_budget":
        budget = spec.get("budget")
        if budget is None or not isinstance(budget, (int, float)):
            errors.append("error_budget rule spec must contain a numeric 'budget'.")
        elif budget == 0:
            errors.append("error_budget 'budget' cannot be zero.")

    elif rule_type == "evidence":
        expected = spec.get("expected")
        if expected is None:
            errors.append("evidence rule spec must contain an 'expected' boolean or string value.")

    elif rule_type == "qualitative":
        description = spec.get("description")
        if not description or not isinstance(description, str) or not description.strip():
            errors.append("qualitative rule spec must contain a non-empty 'description' string.")

    return errors


# ============================================================================
# Safe Restricted AST Expression Evaluator (Security Vulnerability Fix)
# ============================================================================

class SafeASTEvaluator(ast.NodeVisitor):
    """Restricted AST visitor for safe mathematical expression evaluation.

    Supports arithmetic operators (+, -, *, /), unary ops (+, -), numbers,
    parentheses, and identifier lookups in context. Blocks arbitrary code execution.
    """

    ALLOWED_NODES = (
        ast.Expression,
        ast.BinOp,
        ast.UnaryOp,
        ast.Num,
        ast.Constant,
        ast.Name,
        ast.Load,
        ast.Add,
        ast.Sub,
        ast.Mult,
        ast.Div,
        ast.USub,
        ast.UAdd,
    )

    def __init__(self, context: Optional[Dict[str, float]] = None):
        self.context = context or {}

    def visit(self, node: ast.AST) -> float:
        if not isinstance(node, self.ALLOWED_NODES):
            raise ValueError(f"Disallowed expression node type: {type(node).__name__}")
        return super().visit(node)

    def visit_Expression(self, node: ast.Expression) -> float:
        return self.visit(node.body)

    def visit_Constant(self, node: ast.Constant) -> float:
        if not isinstance(node.value, (int, float)):
            raise ValueError(f"Only numeric constants allowed, got {type(node.value).__name__}")
        return float(node.value)

    def visit_Num(self, node: ast.Num) -> float:
        return float(node.n)

    def visit_Name(self, node: ast.Name) -> float:
        var_name = node.id
        if var_name in self.context:
            val = self.context[var_name]
            if val is None:
                raise ValueError(f"Referenced variable '{var_name}' is None/null.")
            return float(val)
        raise ValueError(f"Undefined variable in formula: '{var_name}'")

    def visit_UnaryOp(self, node: ast.UnaryOp) -> float:
        operand = self.visit(node.operand)
        if isinstance(node.op, ast.USub):
            return -operand
        if isinstance(node.op, ast.UAdd):
            return +operand
        raise ValueError(f"Unsupported unary operator: {type(node.op).__name__}")

    def visit_BinOp(self, node: ast.BinOp) -> float:
        left = self.visit(node.left)
        right = self.visit(node.right)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            if right == 0:
                raise ZeroDivisionError("Division by zero in formula")
            return left / right
        raise ValueError(f"Unsupported binary operator: {type(node.op).__name__}")


def evaluate_safe_formula(formula: str, context: Optional[Dict[str, float]] = None) -> float:
    """Evaluates an arithmetic expression string safely using AST parsing.

    Replaces unsafe raw `eval()`.
    """
    if not formula or not isinstance(formula, str):
        raise ValueError("Formula must be a non-empty string.")

    cleaned = formula.strip()
    try:
        parsed_ast = ast.parse(cleaned, mode="eval")
    except SyntaxError as err:
        raise ValueError(f"Invalid arithmetic syntax in formula '{cleaned}': {err}") from err

    evaluator = SafeASTEvaluator(context=context)
    return evaluator.visit(parsed_ast)


# ============================================================================
# DAG Cycle Detector
# ============================================================================

def detect_composite_cycle(
    kpi_id: str,
    ref_kpi_ids: List[str],
    contract_kpis: List[Dict[str, Any]],
) -> Optional[List[str]]:
    """Detects if adding or updating a composite KPI creates a cycle in ref_kpi_ids.

    Returns the cycle path list [node1, node2, ..., node1] if a cycle exists, or None if DAG is valid.
    """
    if kpi_id in ref_kpi_ids:
        return [kpi_id, kpi_id]

    adjacency: Dict[str, List[str]] = {kpi_id: list(ref_kpi_ids)}
    for doc in contract_kpis:
        cur_id = doc.get("kpi_id")
        if not cur_id or cur_id == kpi_id:
            continue

        refs: List[str] = []
        if doc.get("schema_version") == 2:
            spec = doc.get("rule", {}).get("spec", {})
            refs = spec.get("ref_kpi_ids", [])
        else:
            refs = doc.get("ref_kpi_ids") or doc.get("evaluation_rule", {}).get("ref_kpi_ids", [])
        adjacency[cur_id] = list(refs or [])

    visited: set[str] = set()
    rec_stack: set[str] = set()
    path: List[str] = []

    def dfs(node: str) -> bool:
        visited.add(node)
        rec_stack.add(node)
        path.append(node)

        for neighbor in adjacency.get(node, []):
            if neighbor not in visited:
                if dfs(neighbor):
                    return True
            elif neighbor in rec_stack:
                path.append(neighbor)
                return True

        path.pop()
        rec_stack.remove(node)
        return False

    if dfs(kpi_id):
        start_idx = path.index(path[-1])
        return path[start_idx:]

    return None


# ============================================================================
# V1 to V2 Migration Engine
# ============================================================================

class KPISchemaV1toV2Migrator:
    """Converts legacy flat V1 KPI documents into structured V2 FlexField Rule Model documents."""

    # Unit tokens we recognise in tiered-schedule clause text
    _UNIT_TOKENS = r"(?:%|ms|min|minutes?|hrs?|hours?|sec(?:onds?)?|events?|sites?|mbps|gbps|units?|calls?|days?|weeks?)"
    # Numeric value with an optional unit
    _NUMVAL = rf"[0-9][0-9,\.]*\s*{_UNIT_TOKENS}?"
    # Range pattern: "4.01 ms - 5.00 ms" or "99.990% - 99.994%"
    _RANGE_PAT = rf"(?:{_NUMVAL}\s*[-–]\s*{_NUMVAL})"
    # Comparison pattern: "< 99.950%", "> 6.00 ms", "<= 15.0 min"
    _CMP_PAT = rf"(?:(?:<=?|>=?)\s*{_NUMVAL})"
    # Consequence value: "2.5% Fee Credit", "12.0% Fee", "$10,000 / event", "$500 / site / hr"
    _CONSEQUENCE_PAT = r"(?:[0-9\.]+%\s*Fee(?:\s*Credit)?|\$[0-9,]+(?:\s*/\s*[a-z]+)*)"

    @staticmethod
    def _extract_tiers_from_clause(text: str) -> List[Dict[str, Any]]:
        """Parse a verbatim contract clause text into structured tier objects.

        Handles:
        - Percentage ranges: 99.990% - 99.994%: 5.0% Fee Credit
        - Latency/time ranges: 4.01 ms - 5.00 ms: 2.5% Fee
        - Comparison-bounded tiers: > 6.00 ms: 12.0% Fee Credit
        - Dollar-penalty tiers: 15.1 min - 30.0 min: $10,000 / event
        - Incident-count tiers: 2-3 Incidents: 25.0% Fee Credit
        """
        # Broad unit-agnostic tier pattern
        UNIT = r"(?:%|ms|min(?:utes?)?|hrs?|hours?|sec(?:onds?)?|events?|sites?|incidents?|mbps|gbps|units?|calls?|days?|weeks?)"
        NUMVAL = rf"[0-9][0-9,\.]*(?:\s*{UNIT})?"

        range_pat = rf"(?:{NUMVAL}\s*[-–]\s*{NUMVAL})"
        cmp_pat = rf"(?:(?:<=?|>=?)\s*{NUMVAL})"
        # Bracket label: "N/A (Single Incident)", "2-3 Incidents"
        bracket_pat = r"(?:N/A\s*\([^)]*\)|[0-9]+\s*[-–]\s*[0-9]+\s*Incidents?)"
        # Consequence: "2.5% Fee Credit", "15.0%", "$10,000 / event / hr"
        consequence_pat = r"(?:[0-9\.]+%(?:\s*Fee(?:\s*Credit)?)?|\$[0-9][0-9,]*(?:\s*/\s*[a-z]+)*)"

        full_pat = rf"({range_pat}|{cmp_pat}|{bracket_pat})\s*:\s*({consequence_pat})"
        matches = list(re.finditer(full_pat, text, re.IGNORECASE))
        if not matches:
            return []

        tiers: List[Dict[str, Any]] = []
        for idx, m in enumerate(matches):
            range_str = (m.group(1) or "").strip()
            value_str = (m.group(2) or "").strip()
            credit_pct: Optional[float] = None
            penalty_amount: Optional[str] = None

            if "$" in value_str:
                penalty_amount = value_str
            else:
                num_m = re.search(r"([0-9\.]+)", value_str)
                if num_m:
                    try:
                        credit_pct = float(num_m.group(1))
                    except ValueError:
                        pass

            tiers.append({
                "tier": f"Tier {idx + 1}",
                "range": range_str,
                "value": value_str,
                "credit_pct": credit_pct,
                "penalty_amount": penalty_amount,
            })

        return tiers

    @staticmethod
    def migrate_doc(v1_doc: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(v1_doc, dict):
            raise ValueError("v1_doc must be a dictionary")

        if v1_doc.get("schema_version") == 2 and isinstance(v1_doc.get("identity"), dict):
            v2_copy = dict(v1_doc)
            identity = dict(v2_copy.get("identity") or {})

            # --- Clean identity.name: strip type prefixes, table pipes, and LLM-appended "Tier N" suffixes ---
            if identity.get("name"):
                name = re.sub(r"^(?:Sla|Obligation|Penalty|Timeline|Financial|Notice):\s*", "", str(identity["name"]), flags=re.IGNORECASE)
                name = re.sub(r"\s*\|\s*.*$", "", name)
                name = re.sub(r"\s*Tier\s+\d+\s*$", "", name, flags=re.IGNORECASE)
                identity["name"] = re.sub(r"^[|\s]+|[|\s]+$", "", name).strip() or identity["name"]
                v2_copy["identity"] = identity

            # --- Tier detection: always re-parse from clause_text (ground truth) ---
            # stale spec.tiers may have been stored from an old, broken regex run.
            cattr = v2_copy.get("custom_attributes") or {}
            clause_text = str(cattr.get("clause_text") or cattr.get("quote") or identity.get("source_clause", {}).get("quote") or v2_copy.get("quote") or "")
            rule = dict(v2_copy.get("rule") or {})
            spec = dict(rule.get("spec") or {})

            # Always attempt a fresh parse so stale DB values are never shown
            fresh_tiers = KPISchemaV1toV2Migrator._extract_tiers_from_clause(clause_text) if clause_text else []
            stale_tiers = spec.get("tiers") or v2_copy.get("target_schedule") or cattr.get("target_schedule") or []
            # Prefer fresh parse; fall back to stale only when fresh yields nothing
            tiers = fresh_tiers if fresh_tiers else stale_tiers

            if tiers:
                v2_copy["rule_type"] = "tiered"
                rule["rule_type"] = "tiered"
                spec["tiers"] = tiers
                rule["spec"] = spec
                v2_copy["rule"] = rule
                v2_copy["target_schedule"] = tiers

            return v2_copy

        kpi_id = str(v1_doc.get("kpi_id") or v1_doc.get("_id") or "")
        contract_id = str(v1_doc.get("contract_id") or "")
        project_id = str(v1_doc.get("project_id") or "") if v1_doc.get("project_id") else None
        contract_name = v1_doc.get("contract_name") or "Contract"

        # Identity
        raw_name = (v1_doc.get("identity", {}).get("name") if isinstance(v1_doc.get("identity"), dict) else None) or v1_doc.get("name") or v1_doc.get("kpi_name") or "Unnamed KPI"
        clean_name = re.sub(r"^(?:Sla|Obligation|Penalty|Timeline|Financial|Notice):\s*", "", str(raw_name), flags=re.IGNORECASE)
        clean_name = re.sub(r"\s*\|\s*.*$", "", clean_name)
        clean_name = re.sub(r"\s*Tier\s+\d+\s*$", "", clean_name, flags=re.IGNORECASE)
        clean_name = re.sub(r"^[|\s]+|[|\s]+$", "", clean_name).strip() or "Unnamed KPI"

        identity = {
            "name": clean_name,
            "kpi_type": (v1_doc.get("identity", {}).get("kpi_type") if isinstance(v1_doc.get("identity"), dict) else None) or v1_doc.get("kpi_type") or "sla",
            "canonical_metric_key": v1_doc.get("canonical_metric_key") or kpi_id,
            "party": v1_doc.get("party") or v1_doc.get("responsible_party"),
            "business_owner": v1_doc.get("business_owner"),
            "technical_owner": v1_doc.get("technical_owner"),
            "responsible_party": v1_doc.get("responsible_party"),
            "contract_id": contract_id,
            "project_id": project_id,
            "contract_name": contract_name,
            "source_clause": {
                "quote": v1_doc.get("source_clause") or v1_doc.get("definition") or "",
                "page_start": v1_doc.get("page_start"),
                "page_end": v1_doc.get("page_end"),
                "section_path": v1_doc.get("section_path") or v1_doc.get("structural_path") or v1_doc.get("section"),
                "source_chunk_id": v1_doc.get("source_chunk_id"),
            },
        }

        # Rule
        rule_type = v1_doc.get("rule_type") or v1_doc.get("type") or "threshold"
        target_schedule = v1_doc.get("target_schedule") or (v1_doc.get("custom_attributes") or {}).get("target_schedule") or []
        clause_text = str(v1_doc.get("clause_text") or v1_doc.get("quote") or v1_doc.get("source_quote") or "")

        # Auto-detect tiered rules from target_schedule or clause_text pattern
        if not target_schedule and clause_text:
            target_schedule = KPISchemaV1toV2Migrator._extract_tiers_from_clause(clause_text)

        if target_schedule:
            rule_type = "tiered"

        operator = v1_doc.get("operator") or v1_doc.get("evaluation_rule", {}).get("operator") or ">="
        unit = v1_doc.get("unit") or v1_doc.get("evaluation_rule", {}).get("unit") or "%"
        period_type = v1_doc.get("period_type") or v1_doc.get("frequency") or "monthly"
        evaluation_window = v1_doc.get("evaluation_window") or period_type
        aggregation = v1_doc.get("aggregation_type") or v1_doc.get("aggregation") or "monthly"

        spec: Dict[str, Any] = {}
        if rule_type == "threshold":
            target = (
                v1_doc.get("target_value")
                if v1_doc.get("target_value") is not None
                else v1_doc.get("value")
            )
            spec = {"target": float(target) if isinstance(target, (int, float)) else target}
        elif rule_type == "range":
            spec = {
                "min": v1_doc.get("value_min") if v1_doc.get("value_min") is not None else v1_doc.get("threshold_min", 0.0),
                "max": v1_doc.get("value_max") if v1_doc.get("value_max") is not None else v1_doc.get("threshold_max", 100.0),
            }
        elif rule_type == "tiered":
            spec = {
                "tiers": target_schedule or v1_doc.get("tiers") or [],
                "interpolation": v1_doc.get("interpolation") or "step",
                "modifiers": v1_doc.get("modifiers") or [],
            }
        elif rule_type == "deadline":
            spec = {
                "target_date_field": v1_doc.get("target_date_field") or "due_date",
                "grace_days": v1_doc.get("grace_period_days") or 0,
            }
        elif rule_type == "composite":
            spec = {
                "formula": v1_doc.get("formula") or "",
                "ref_kpi_ids": v1_doc.get("ref_kpi_ids") or [],
                "cross_contract": bool(v1_doc.get("cross_contract", False)),
            }
        elif rule_type == "error_budget":
            spec = {"budget": v1_doc.get("error_budget") or v1_doc.get("budget") or 1.0}
        elif rule_type == "evidence":
            spec = {"expected": v1_doc.get("expected") or True}
        elif rule_type == "qualitative":
            spec = {"description": v1_doc.get("description") or v1_doc.get("definition") or ""}
        else:
            spec = {
                "target": v1_doc.get("target_value") or v1_doc.get("value"),
                "value_min": v1_doc.get("value_min"),
                "value_max": v1_doc.get("value_max"),
            }

        rule = {
            "rule_type": rule_type,
            "operator": operator,
            "unit": unit,
            "period_type": period_type,
            "evaluation_window": evaluation_window,
            "aggregation": aggregation,
            "spec": spec,
        }

        # Consequence
        consequence = {
            "value": v1_doc.get("consequence_value"),
            "unit": v1_doc.get("consequence_unit"),
            "trigger_condition": v1_doc.get("trigger_condition"),
            "remediation": v1_doc.get("remediation"),
            "remediation_sla": v1_doc.get("remediation_sla"),
            "contact_email": v1_doc.get("contact_email"),
        }

        # Governance
        is_tracked = bool(v1_doc.get("is_tracked", False) or v1_doc.get("tracking_status") == "tracked")
        status = v1_doc.get("status") or ("tracked" if is_tracked else "draft")
        if rule_type == "qualitative" and is_tracked:
            status = "qualitative_tracked"

        governance = {
            "status": status,
            "confidence": float(v1_doc.get("confidence_score") or v1_doc.get("confidence") or 0.8),
            "needs_review": bool(v1_doc.get("needs_review", False)),
            "version": int(v1_doc.get("version") or 1),
            "is_tracked": is_tracked,
            "tracking_status": v1_doc.get("tracking_status") or ("tracked" if is_tracked else "recommended"),
            "is_recommended": bool(v1_doc.get("is_recommended", False)),
            "recommendation_reason": v1_doc.get("recommendation_reason"),
            "created_at": v1_doc.get("created_at") or datetime.utcnow(),
            "created_by": v1_doc.get("created_by") or "system",
            "updated_at": v1_doc.get("updated_at") or datetime.utcnow(),
            "updated_by": v1_doc.get("updated_by") or "system",
        }

        standard_v1_keys = {
            "_id", "kpi_id", "schema_version", "contract_id", "project_id", "contract_name",
            "name", "kpi_name", "description", "kpi_type", "party", "operator", "value",
            "unit", "value_min", "value_max", "threshold_min", "threshold_max", "target_value",
            "baseline", "benchmark", "direction", "period_type", "evaluation_window", "frequency",
            "aggregation_type", "rule_type", "consequence_value", "consequence_unit",
            "trigger_condition", "remediation", "remediation_sla", "contact_email",
            "business_owner", "technical_owner", "responsible_party", "tracking_status",
            "is_tracked", "status", "confidence_score", "recommendation_reason", "is_recommended",
            "source_clause", "section_path", "structural_path", "section", "page_start", "page_end",
            "source_chunk_id", "post_extraction_ai_allowed", "breach_evaluation_mode",
            "evaluation_rule", "created_at", "created_by", "updated_at", "updated_by",
            "source_config_id", "source_config_status", "field_mappings", "last_tracking_backfill",
            "citation", "citation_details", "clause_text", "quote", "source_quote", "run_id",
            "document_id", "user_id", "confidence", "confidence_reason", "needs_review",
            "breach_email_template", "value_candidates", "extraction_method", "definition",
            "formula", "source_requirements", "rule_version", "ai_generated_only_at_extraction",
            "ai_extraction_provider", "char_start", "char_end", "chunk_id", "chunk_level",
            "source_chunk_level", "target_schedule", "checkpoint_dates", "grace_period_days",
            "lookback_window_days", "partial_period_policy", "late_data_policy", "business_hours",
            "blackout_windows", "severity_grace_periods", "reporting_lock", "missing_data_policy",
            "error_budget", "section_tags"
        }

        custom_attributes = v1_doc.get("custom_attributes") or {}
        if not isinstance(custom_attributes, dict):
            custom_attributes = {}
        else:
            custom_attributes = dict(custom_attributes)

        for k, v in v1_doc.items():
            if k not in standard_v1_keys and k not in custom_attributes:
                custom_attributes[k] = v

        v2_doc = {
            "kpi_id": kpi_id,
            "schema_version": 2,
            "contract_id": contract_id,
            "project_id": project_id,
            "contract_name": contract_name,
            "identity": identity,
            "rule": rule,
            "consequence": consequence,
            "governance": governance,
            "custom_attributes": custom_attributes,
        }

        if "_id" in v1_doc:
            v2_doc["_id"] = v1_doc["_id"]

        for s_key in ("source_config_id", "source_config_status", "field_mappings", "last_tracking_backfill"):
            if s_key in v1_doc:
                v2_doc[s_key] = v1_doc[s_key]

        return v2_doc


# ============================================================================
# Legacy Frontend Translation Shim
# ============================================================================

def flatten_for_legacy_frontend(v2_doc: Dict[str, Any]) -> Dict[str, Any]:
    """Flattens a V2 nested document back into a V1 flat dictionary shape.

    Temporary shim until the frontend UI is fully migrated to native V2 objects.
    """
    if not isinstance(v2_doc, dict):
        return {}

    if v2_doc.get("schema_version") != 2 or not isinstance(v2_doc.get("identity"), dict):
        return dict(v2_doc)

    identity = v2_doc.get("identity", {})
    rule = v2_doc.get("rule", {})
    spec = rule.get("spec", {}) if isinstance(rule.get("spec"), dict) else {}
    consequence = v2_doc.get("consequence", {})
    governance = v2_doc.get("governance", {})
    source_clause = identity.get("source_clause", {}) if isinstance(identity.get("source_clause"), dict) else {}
    custom_attrs = v2_doc.get("custom_attributes", {}) if isinstance(v2_doc.get("custom_attributes"), dict) else {}

    target_val = spec.get("target") if "target" in spec else v2_doc.get("target_value")

    flat_doc = {
        "_id": v2_doc.get("_id"),
        "kpi_id": v2_doc.get("kpi_id"),
        "schema_version": v2_doc.get("schema_version", 2),
        "contract_id": v2_doc.get("contract_id") or identity.get("contract_id"),
        "project_id": v2_doc.get("project_id") or identity.get("project_id"),
        "contract_name": v2_doc.get("contract_name") or identity.get("contract_name"),

        "name": identity.get("name"),
        "kpi_type": identity.get("kpi_type"),
        "canonical_metric_key": identity.get("canonical_metric_key"),
        "party": identity.get("party"),
        "business_owner": identity.get("business_owner"),
        "technical_owner": identity.get("technical_owner"),
        "responsible_party": identity.get("responsible_party") or identity.get("party"),
        "source_clause": source_clause.get("quote"),
        "definition": source_clause.get("quote"),
        "page_start": source_clause.get("page_start"),
        "page_end": source_clause.get("page_end"),
        "section_path": source_clause.get("section_path"),
        "structural_path": source_clause.get("section_path"),
        "source_chunk_id": source_clause.get("source_chunk_id"),

        "rule_type": rule.get("rule_type"),
        "operator": rule.get("operator"),
        "unit": rule.get("unit"),
        "period_type": rule.get("period_type"),
        "evaluation_window": rule.get("evaluation_window"),
        "aggregation_type": rule.get("aggregation"),
        "target_value": target_val,
        "value": target_val,
        "value_min": spec.get("min"),
        "value_max": spec.get("max"),
        "threshold_min": spec.get("min"),
        "threshold_max": spec.get("max"),
        "formula": spec.get("formula"),
        "ref_kpi_ids": spec.get("ref_kpi_ids", []),
        "target_schedule": spec.get("tiers", []),
        "error_budget": spec.get("budget"),

        "consequence_value": consequence.get("value"),
        "consequence_unit": consequence.get("unit"),
        "trigger_condition": consequence.get("trigger_condition"),
        "remediation": consequence.get("remediation"),
        "remediation_sla": consequence.get("remediation_sla"),
        "contact_email": consequence.get("contact_email"),

        "status": governance.get("status"),
        "confidence_score": governance.get("confidence"),
        "needs_review": governance.get("needs_review", False),
        "version": governance.get("version", 1),
        "is_tracked": governance.get("is_tracked", False),
        "tracking_status": governance.get("tracking_status"),
        "is_recommended": governance.get("is_recommended", False),
        "recommendation_reason": governance.get("recommendation_reason"),
        "created_at": governance.get("created_at"),
        "created_by": governance.get("created_by"),
        "updated_at": governance.get("updated_at"),
        "updated_by": governance.get("updated_by"),

        "identity": identity,
        "rule": rule,
        "consequence": consequence,
        "governance": governance,
        "custom_attributes": custom_attrs,
        "evaluation_rule": {
            "rule_type": rule.get("rule_type"),
            "operator": rule.get("operator"),
            "target": target_val,
            "unit": rule.get("unit"),
            "evaluation_window": rule.get("evaluation_window"),
            "aggregation": rule.get("aggregation"),
            "spec": spec,
            "ai_used": False,
        },
    }

    for s_key in ("source_config_id", "source_config_status", "field_mappings", "last_tracking_backfill"):
        if s_key in v2_doc:
            flat_doc[s_key] = v2_doc[s_key]

    for k, v in custom_attrs.items():
        if k not in flat_doc:
            flat_doc[k] = v

    return flat_doc
