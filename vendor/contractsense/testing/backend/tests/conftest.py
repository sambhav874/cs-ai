"""Shared pytest path setup for moved backend tests."""

from pathlib import Path
import sys


TESTING_BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]
APP_BACKEND_ROOT = REPO_ROOT / "apps" / "backend"

# The tests directory itself, so a test can import a fixture from a sibling
# module — `test_kpi_enhancements` imports FakeDB from `test_kpi_source_ingestion`,
# which raised ModuleNotFoundError and failed five tests that had nothing wrong
# with them.
TESTS_DIR = Path(__file__).resolve().parent

for path in (APP_BACKEND_ROOT, TESTING_BACKEND_ROOT, TESTS_DIR):
    path_string = str(path)
    if path_string not in sys.path:
        sys.path.insert(0, path_string)
