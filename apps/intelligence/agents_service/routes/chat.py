"""POST /agents/agent/chat — the platform assistant.

Runs on ContractSense's agent runtime (services/assistant/engine.py). The
request shape is the one the lifecycle API has always sent, so its proxy
(routes/agents.ts) changed only to add `history`; the stream keeps the frames
the chat renders.
"""
import uuid

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agents_service.providers import list_models
from services.assistant.engine import AssistantRequest, stream_assistant

router = APIRouter()


class PageContext(BaseModel):
    """What the user is looking at, so the assistant can scope to it."""
    type: str | None = None
    id:   str | None = None
    label: str | None = None


class HistoryToolCall(BaseModel):
    id: str
    name: str
    args: dict = Field(default_factory=dict)
    result: str | None = None


class HistoryTurn(BaseModel):
    role: str
    content: str = ""
    toolCalls: list[HistoryToolCall] = Field(default_factory=list)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=10_000)
    session_id: str | None = None
    user_id: str
    org_id: str
    # Accepted for compatibility and not honoured: the org's Admin → AI
    # settings choose the model. The chat stopped pinning one in P0.
    provider: str | None = None
    model_id: str | None = None
    agent_mode: bool = True
    page_context: PageContext | None = None
    skill_slug: str | None = None
    skill_system_prompt: str | None = None
    skill_allowed_tools: list[str] | None = None
    # An authorization boundary computed by the API from the caller's role;
    # applied after any skill allowlist.
    denied_tools: list[str] | None = None
    mentions: list[dict] | None = None
    # Earlier turns of this thread, from the API's persisted AgentThread.
    history: list[HistoryTurn] = Field(default_factory=list)


@router.get("/models")
async def get_models():
    """Return all supported provider/model combinations."""
    return {"models": list_models()}


@router.post("/chat")
async def chat(req: ChatRequest, http_request: Request):
    assistant_request = AssistantRequest(
        message=req.message,
        session_id=req.session_id or str(uuid.uuid4()),
        org_id=req.org_id,
        user_id=req.user_id,
        page_context=req.page_context.model_dump() if req.page_context else None,
        mentions=req.mentions,
        skill_slug=req.skill_slug,
        skill_system_prompt=req.skill_system_prompt,
        skill_allowed_tools=req.skill_allowed_tools,
        denied_tools=req.denied_tools,
        history=[t.model_dump() for t in req.history],
    )
    return StreamingResponse(
        stream_assistant(assistant_request, is_disconnected=http_request.is_disconnected),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
