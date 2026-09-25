"""Every prompt passed through str.format has only real placeholders.

A JSON example left with bare braces reads as a placeholder to .format and
raises KeyError on every call: /redline and /agent/portfolio-query failed
100% of the time this way. Prompts joined with + are exempt.
"""
import ast
import importlib
import pathlib
import string

import agents_service

ROOT = pathlib.Path(agents_service.__file__).parent


def _formatted_prompts():
    for path in ROOT.rglob("*.py"):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "format" and isinstance(node.func.value, ast.Name)
                    and "PROMPT" in node.func.value.id.upper()):
                mod = "agents_service." + ".".join(path.relative_to(ROOT).with_suffix("").parts)
                yield mod, node.func.value.id


def test_formatted_prompts_have_only_identifier_placeholders():
    seen = set(_formatted_prompts())
    assert ("agents_service.agents.redline_agent", "_EXTRACT_PROMPT") in seen
    for mod, name in seen:
        template = getattr(importlib.import_module(mod), name, None)
        if not isinstance(template, str):
            continue  # a local, not a module constant
        fields = {f for _, f, _, _ in string.Formatter().parse(template) if f is not None}
        odd = [f for f in fields if not f.isidentifier()]
        assert not odd, f"{mod}.{name} has brace text read as placeholders: {odd[:2]}"


def test_the_one_that_crashed_now_formats():
    # portfolio_agent crashed the same way; it was retired in P2, its filters
    # now the assistant's contract_filter tool.
    from agents_service.agents import redline_agent

    assert "<ins>x</ins>" in redline_agent._EXTRACT_PROMPT.format(diff_html="<ins>x</ins>")


def test_key_term_recovery_pass_looks_for_fields_the_schema_declares():
    # The review agent's recovery pass once looked for keys its own schema
    # never produced; the key-term extractor that replaced it keeps the check.
    from services import key_terms

    assert set(key_terms.RECOVERY_FIELDS) <= set(key_terms.FIELD_BY_NAME)
