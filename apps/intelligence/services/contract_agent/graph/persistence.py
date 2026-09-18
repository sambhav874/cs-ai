"""Mongo-backed persistence for deep workflow agent runs."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from pymongo import UpdateOne

from .state import AgentRunState, AgentStatus


class AgentRunStore:
    def __init__(self, mongo_db: Any):
        agent_db = mongo_db.client["contract_agent_db"]
        self.runs = agent_db["agent_runs"]
        self.trace_events = agent_db["agent_trace_events"]
        self.approvals = agent_db["agent_approvals"]
        self.cost_events = agent_db["agent_cost_events"]
        self.checkpoints = agent_db["agent_workflow_checkpoints"]

    def save(self, state: AgentRunState) -> None:
        payload = state.model_dump(mode="json")
        payload["updated_at"] = datetime.utcnow()
        self.runs.update_one(
            {"workflow_id": state.workflow_id},
            {"$set": payload},
            upsert=True,
        )
        # One bulk write, not one round trip per trace event. A run emits a few
        # dozen traces and each upsert was its own trip to Atlas at roughly
        # 200ms, so saving the run took over seven seconds — and it runs after
        # the answer is complete but before the citations are sent, which is
        # what made sources look slow to resolve when resolving them costs 2ms.
        #
        # unordered: these are independent upserts keyed on distinct events, so
        # one failure should not abandon the rest of the run's trace.
        operations = []
        for trace in state.traces:
            event_payload = trace.model_dump(mode="json")
            event_payload["workflow_id"] = state.workflow_id
            event_key = {
                "workflow_id": state.workflow_id,
                "event": trace.event,
                "created_at": event_payload.get("created_at"),
            }
            operations.append(
                UpdateOne(event_key, {"$setOnInsert": event_payload}, upsert=True)
            )
        if operations:
            self.trace_events.bulk_write(operations, ordered=False)
        if state.approval_request:
            approval_payload = state.approval_request.model_dump(mode="json")
            approval_payload["status"] = state.status.value
            self.approvals.update_one(
                {"approval_id": state.approval_request.approval_id},
                {"$set": approval_payload},
                upsert=True,
            )

    def get(self, workflow_id: str) -> Optional[AgentRunState]:
        doc = self.runs.find_one({"workflow_id": workflow_id}, {"_id": 0})
        return AgentRunState.model_validate(doc) if doc else None

    def mark_status(self, workflow_id: str, status: AgentStatus, **updates: Any) -> Optional[AgentRunState]:
        update = {"status": status.value, "updated_at": datetime.utcnow(), **updates}
        self.runs.update_one({"workflow_id": workflow_id}, {"$set": update})
        return self.get(workflow_id)
