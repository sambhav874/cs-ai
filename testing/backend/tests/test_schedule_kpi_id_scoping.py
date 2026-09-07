"""Fee-schedule records must carry a contract-scoped `kpi_id`.

`_consolidate_multi_tier_schedules` collapses tier rows into one parent schedule
record and assigns it a fresh id.  That id used to be seeded from the schedule
title alone, while `kpi_id` carries a globally unique index and the bulk upsert
in `extract_for_contract` filters on `kpi_id` by itself.  Two contracts that each
produced a similarly-titled schedule therefore hashed to the same id, and the
second extraction `$set` its whole document — `contract_id` included — over the
first one's, silently moving another contract's obligation.
"""

from services.kpi_manager import ContractKPIManager


def _tier_rows(contract_id: str):
    """Two rows that cluster into one schedule, for the given contract."""
    return [
        {
            "kpi_id": f"kpi_seed_{contract_id}_1",
            "contract_id": contract_id,
            "name": "Towing Charge Tier 1",
            "value": 120.0,
            "unit": "USD",
            "quote": "Towing charge, tier 1: USD 120.00 per movement.",
        },
        {
            "kpi_id": f"kpi_seed_{contract_id}_2",
            "contract_id": contract_id,
            "name": "Towing Charge Tier 2",
            "value": 240.0,
            "unit": "USD",
            "quote": "Towing charge, tier 2: USD 240.00 per movement.",
        },
    ]


def _schedule_record(manager, contract_id: str):
    consolidated = manager._consolidate_multi_tier_schedules(_tier_rows(contract_id))
    schedules = [item for item in consolidated if str(item.get("kpi_id", "")).startswith("kpi_sch_")]
    assert len(schedules) == 1, f"expected one clustered schedule, got {len(schedules)}"
    return schedules[0]


def test_same_title_different_contracts_do_not_collide():
    manager = ContractKPIManager()

    first = _schedule_record(manager, "contract_aaa")
    second = _schedule_record(manager, "contract_bbb")

    # Same generated title — this is what used to make them collide.
    assert first["name"] == second["name"]
    assert first["kpi_id"] != second["kpi_id"], (
        "two contracts with the same schedule title share a kpi_id; the globally "
        "unique index means the second extraction overwrites the first"
    )


def test_schedule_id_is_stable_within_a_contract():
    manager = ContractKPIManager()

    assert _schedule_record(manager, "contract_aaa")["kpi_id"] == (
        _schedule_record(manager, "contract_aaa")["kpi_id"]
    )


def test_schedule_id_keeps_its_prefix():
    manager = ContractKPIManager()

    assert _schedule_record(manager, "contract_aaa")["kpi_id"].startswith("kpi_sch_")


def test_schedule_id_falls_back_without_a_contract_id():
    """A row with no contract_id must still produce an id, not raise."""
    manager = ContractKPIManager()

    rows = [{**row, "contract_id": None} for row in _tier_rows("ignored")]
    consolidated = manager._consolidate_multi_tier_schedules(rows)
    schedules = [item for item in consolidated if str(item.get("kpi_id", "")).startswith("kpi_sch_")]

    assert len(schedules) == 1
    assert schedules[0]["kpi_id"]
