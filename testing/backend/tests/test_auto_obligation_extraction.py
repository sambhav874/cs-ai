"""Obligations are extracted when a contract is ingested — for every contract.

Before this, auto-extraction on ingest existed only for the Baltia demo
(`worker/tasks.py`), so every real upload produced a contract with an empty
obligation register and no indication that extraction had never been attempted.
"""

import sys
import types
from unittest.mock import MagicMock

import pytest
from bson import ObjectId


@pytest.fixture
def tasks(monkeypatch):
    """Import the worker module with the cloud SDKs it does not need here stubbed."""
    stubs = {
        "azure": {},
        "azure.core": {},
        "azure.core.exceptions": {"AzureError": type("AzureError", (Exception,), {})},
        "azure.storage": {},
        "azure.storage.blob": {"BlobServiceClient": object},
        "pinecone": {"Pinecone": object, "ServerlessSpec": object},
    }
    for name, attributes in stubs.items():
        if name not in sys.modules:
            module = types.ModuleType(name)
            for key, value in attributes.items():
                setattr(module, key, value)
            sys.modules[name] = module
    try:
        import worker.tasks as worker_tasks
    except Exception as exc:  # noqa: BLE001 - any import failure means "not runnable here"
        # The worker module pulls the whole ingestion stack (OCR, embeddings,
        # cloud SDKs). Skipping on any import failure keeps these runnable in
        # CI and in the container without pinning a local machine's toolchain.
        pytest.skip(f"worker dependencies unavailable: {type(exc).__name__}: {exc}")
    return worker_tasks


def test_extraction_runs_and_stamps_the_resolved_family(tasks, monkeypatch):
    contract_id = str(ObjectId())
    updates = []

    fake_collection = MagicMock()
    fake_collection.find_one.return_value = {
        "_id": ObjectId(contract_id),
        "contract_name": "Ground Handling Agreement",
        "ownerType": "team",
        "ownerId": ObjectId(),
    }
    fake_collection.update_one.side_effect = lambda q, u: updates.append(u["$set"])
    monkeypatch.setattr(tasks, "collection", fake_collection)

    manager = MagicMock()
    manager.extract_for_contract.return_value = {
        "run_id": "kpi_run_abc",
        "kpi_count": 42,
        "extraction_method": "hybrid_llm",
        "contract_family": "iata_ground_handling",
        "pack_id": "iata_ground_handling",
        "pack_version": 1,
    }
    monkeypatch.setattr("services.kpi_manager.ContractKPIManager", lambda *a, **k: manager)

    result = tasks.extract_obligations_task.run(contract_id=contract_id, user_id="u1")

    assert result["status"] == "success"
    assert updates[0]["obligations.status"] == "running"
    assert updates[-1]["obligations.status"] == "success"
    assert updates[-1]["obligations.count"] == 42
    assert updates[-1]["obligations.pack_id"] == "iata_ground_handling"


def test_a_failed_extraction_is_recorded_not_swallowed(tasks, monkeypatch):
    """An empty register and a failed extraction must not look the same."""
    updates = []
    fake_collection = MagicMock()
    fake_collection.find_one.return_value = {"_id": ObjectId(), "contract_name": "X"}
    fake_collection.update_one.side_effect = lambda q, u: updates.append(u["$set"])
    monkeypatch.setattr(tasks, "collection", fake_collection)

    manager = MagicMock()
    manager.extract_for_contract.side_effect = RuntimeError("provider down")
    monkeypatch.setattr("services.kpi_manager.ContractKPIManager", lambda *a, **k: manager)

    result = tasks.extract_obligations_task.run(contract_id=str(ObjectId()), user_id="u1")

    assert result["status"] == "error"
    assert updates[-1]["obligations.status"] == "error"
    assert "provider down" in updates[-1]["obligations.error"]


def test_a_missing_contract_does_not_raise(tasks, monkeypatch):
    fake_collection = MagicMock()
    fake_collection.find_one.return_value = None
    monkeypatch.setattr(tasks, "collection", fake_collection)

    assert tasks.extract_obligations_task.run(contract_id=str(ObjectId()), user_id="u1")["status"] == "error"


def test_an_invalid_contract_id_does_not_raise(tasks):
    assert tasks.extract_obligations_task.run(contract_id="not-an-oid", user_id="u1")["status"] == "error"


def test_the_extraction_result_carries_the_pack_stamp():
    """The task reads these off the result; if extract_for_contract stops
    returning them the stamp silently becomes null on every contract."""
    import inspect

    from services.kpi_manager import ContractKPIManager

    source = inspect.getsource(ContractKPIManager.extract_for_contract)
    for field in ('"contract_family": pack_resolution', '"pack_id": pack_resolution', '"pack_version": pack_resolution'):
        assert field in source
