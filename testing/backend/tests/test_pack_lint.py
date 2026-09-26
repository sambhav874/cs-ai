"""The pack lint over both halves (merge step 8; packs/README.md)."""
import shutil
from pathlib import Path

import pytest
import yaml

from services.obligation_packs import PACK_ROOT, clear_cache
from services.pack_lint import lint_packs


def test_the_shipped_packs_pass():
    assert lint_packs() == []


@pytest.fixture
def packs(tmp_path):
    root = tmp_path / "packs"
    shutil.copytree(PACK_ROOT, root)
    clear_cache()
    yield root
    clear_cache()


def edit(path: Path, fn):
    data = yaml.safe_load(path.read_text())
    fn(data)
    path.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True))


def problems(root):
    return lint_packs(root, repo_root=PACK_ROOT.parent)


def test_approved_language_needs_a_named_reviewer(packs):
    edit(packs / "logistics" / "clauses.yaml", lambda c: c[0]["review"].update(status="approved"))
    assert any("needs reviewer, reviewed_on" in p for p in problems(packs))


def test_a_playbook_link_must_resolve_to_the_taxonomy(packs):
    edit(packs / "logistics" / "playbook.yaml", lambda p: p[0].update(obligation_class="liability_cap"))
    assert any("obligation_class 'liability_cap' is not a class" in p for p in problems(packs))


def test_an_ungated_extraction_half_fails(packs):
    edit(packs / "logistics" / "coverage.yaml",
         lambda c: [c.pop(k) for k in [k for k in c if k.endswith("_floor")]])
    assert any("has no floors" in p for p in problems(packs))


def test_default_value_language_is_refused(packs):
    path = packs / "logistics" / "conventions.md"
    path.write_text(path.read_text() + "\nIf unspecified, assume USD.\n")
    assert any("default-value language" in p for p in problems(packs))


def test_unknown_categories_and_versions_are_caught(packs):
    edit(packs / "saas" / "clauses.yaml", lambda c: c[0].update(category="nonsense"))
    edit(packs / "saas" / "pack.yaml", lambda m: m.update(version=2))
    found = problems(packs)
    assert any("unknown category 'nonsense'" in p for p in found)
    assert any("must be semantic" in p for p in found)
