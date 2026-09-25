"""A Celery task can import any of the app's packages, lazily.

Found live on cs2: every upload's analysis failed with "No module named
'agents_service'". Celery puts the working directory on sys.path only while
it loads the app (celery.utils.imports.cwd_in_path) and removes it after, so a
module a task imports inside a function — key-term analysis imports
agents_service.untrusted — was not importable in the worker, though the API,
under uvicorn, imported it fine.
"""
import os
import subprocess
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[3] / "apps" / "intelligence"

WORKER_LOAD = """
import os, sys
sys.path = [p for p in sys.path if p not in ('', os.getcwd())]
from celery.utils.imports import cwd_in_path
with cwd_in_path():
    import celery_app  # what `celery -A celery_app worker` does
from agents_service.untrusted import wrap_untrusted_document
print('ok')
"""


def _run(code: str) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    return subprocess.run([sys.executable, "-c", code], cwd=APP_DIR, env=env, capture_output=True, text=True, timeout=120)


def test_a_task_can_import_agents_service_after_the_worker_loads():
    result = _run(WORKER_LOAD)
    assert result.returncode == 0, result.stderr[-2000:]
    assert result.stdout.strip().endswith("ok")
