"""Shared pytest path setup for moved backend tests."""

from pathlib import Path
import sys


TESTING_BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]
APP_BACKEND_ROOT = REPO_ROOT / "apps" / "backend"

for path in (APP_BACKEND_ROOT, TESTING_BACKEND_ROOT):
    path_string = str(path)
    if path_string not in sys.path:
        sys.path.insert(0, path_string)
