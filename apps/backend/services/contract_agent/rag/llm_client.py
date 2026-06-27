"""Structured model client wrapper for contract-agent calls."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

import requests

from core.config import settings
from utils.secure_logger import log_exception
from utils.text_cleanup import clean_text_encoding


class ProviderLLMClient:
    """Provider-specific transport and response parsing for contract answers."""

    def __init__(self, owner: Any):
        self.owner = owner
        self.logger = getattr(owner, "logger", None)

    @property
    def provider(self) -> str:
        return str(getattr(self.owner, "ai_provider", "groq") or "groq").lower()

    def query_plain_markdown(self, prompt: str) -> str:
        try:
            if self.provider == "groq":
                response = self.owner.http_session.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers=getattr(self.owner, "groq_headers", {"Authorization": f"Bearer {self.owner.groq_api_key}", "Content-Type": "application/json"}),
                    json={
                        "model": settings.model_name,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": settings.temperature,
                        "top_p": settings.top_p,
                        "n": 1,
                        "max_completion_tokens": getattr(settings, "max_tokens", 2048),
                    },
                    timeout=settings.api_timeout,
                )
                response.raise_for_status()
                payload = response.json()
                return clean_text_encoding(payload.get("choices", [{}])[0].get("message", {}).get("content", "")).strip()

            if self.provider == "gemini":
                model_name = getattr(settings, "gemini_model_name", None) or "gemini-pro"
                gemini_api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={self.owner.gemini_api_key}"
                response = self.owner.http_session.post(
                    gemini_api_url,
                    json={
                        "contents": [{"parts": [{"text": prompt}]}],
                        "generationConfig": {
                            "temperature": settings.temperature,
                            "topP": settings.top_p,
                        },
                    },
                    headers=getattr(self.owner, "gemini_headers", {"Content-Type": "application/json"}),
                    timeout=settings.api_timeout,
                )
                response.raise_for_status()
                payload = response.json()
                content = payload.get("candidates", [{}])[0].get("content", {})
                parts = content.get("parts") or []
                return clean_text_encoding(parts[0].get("text", "") if parts else "").strip()

            if self.provider == "openai":
                openai_model = getattr(settings, "openai_model_name", None) or "gpt-4-turbo"
                response = self.owner.http_session.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers=getattr(self.owner, "openai_headers", {"Authorization": f"Bearer {self.owner.openai_api_key}", "Content-Type": "application/json"}),
                    json={
                        "model": openai_model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": settings.temperature,
                        "top_p": settings.top_p,
                    },
                    timeout=settings.api_timeout,
                )
                response.raise_for_status()
                payload = response.json()
                return clean_text_encoding(payload.get("choices", [{}])[0].get("message", {}).get("content", "")).strip()

            if self.provider == "claude":
                claude_model = getattr(settings, "anthropic_model_name", None) or "claude-haiku-4-5"
                response = self.owner.http_session.post(
                    "https://api.anthropic.com/v1/messages",
                    headers=getattr(self.owner, "claude_headers", {
                        "x-api-key": self.owner.anthropic_api_key,
                        "anthropic-version": "2023-06-01",
                        "Content-Type": "application/json",
                    }),
                    json={
                        "model": claude_model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": settings.temperature,
                        "top_p": settings.top_p,
                        "max_tokens": getattr(settings, "max_tokens", 4096),
                    },
                    timeout=settings.api_timeout,
                )
                response.raise_for_status()
                payload = response.json()
                blocks = payload.get("content") or []
                text = "".join(block.get("text", "") for block in blocks if block.get("type") == "text")
                return clean_text_encoding(text).strip()
        except Exception as error:
            log_exception(self.logger, "Plain project assistant response failed", error)

        return "No indexed documents are available in this project yet. You can still upload a contract or supporting file, and I can help plan what to review once it is ingested."


class StructuredLLMClient:
    """Dispatch structured prompts to the configured provider."""

    def __init__(self, owner: Any):
        self.owner = owner

    @property
    def provider(self) -> str:
        return str(getattr(self.owner, "ai_provider", "groq") or "groq").lower()

    def query_tool_action(self, prompt: str) -> Dict[str, Any]:
        """Ask the model for one tool action.

        OpenAI and Claude get native schema/tool constraints. Other providers use
        the existing plain markdown path plus strict local parsing.
        """
        provider = self.provider
        if provider == "openai":
            action = self._query_openai_tool_action(prompt)
            if action:
                return action
        if provider == "claude":
            action = self._query_claude_tool_action(prompt)
            if action:
                return action

        raw_action = self.owner._query_plain_markdown(prompt)
        return self.parse_tool_action(raw_action)

    def parse_tool_action(self, raw_action: str) -> Dict[str, Any]:
        text = str(raw_action or "").strip()
        if not text:
            return {"tool": "final_answer", "args": {}, "thought": "No action returned."}
        fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if fenced:
            text = fenced.group(1).strip()
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start:end + 1]
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return {"tool": "final_answer", "args": {}, "thought": "Invalid JSON action payload."}
        if not isinstance(parsed, dict):
            return {"tool": "final_answer", "args": {}, "thought": "Invalid action payload."}
        if not isinstance(parsed.get("args"), dict):
            parsed["args"] = {}
        return parsed

    def _action_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "thought": {"type": "string"},
                "tool": {
                    "type": "string",
                    "enum": [
                        "list_documents",
                        "outline_document",
                        "search_evidence",
                        "get_kpi_context",
                        "calculate_from_evidence",
                        "final_answer",
                    ],
                },
                "args": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "limit": {"type": "integer"},
                        "segment_ids": {"type": "array", "items": {"type": "string"}},
                        "text": {"type": "string"},
                    },
                    "additionalProperties": False,
                },
            },
            "required": ["thought", "tool", "args"],
            "additionalProperties": False,
        }

    def _query_openai_tool_action(self, prompt: str) -> Optional[Dict[str, Any]]:
        try:
            response = self.owner.http_session.post(
                "https://api.openai.com/v1/chat/completions",
                headers=self.owner.openai_headers,
                json={
                    "model": getattr(settings, "openai_model_name", None) or "gpt-4o-mini",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                    "response_format": {
                        "type": "json_schema",
                        "json_schema": {
                            "name": "contract_agent_tool_action",
                            "strict": True,
                            "schema": self._action_schema(),
                        },
                    },
                },
                timeout=settings.api_timeout,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            return self.parse_tool_action(content)
        except Exception as exc:
            self._log_tool_action_fallback("OpenAI structured tool action failed", exc)
            return None

    def _query_claude_tool_action(self, prompt: str) -> Optional[Dict[str, Any]]:
        try:
            tool_name = "choose_contract_agent_tool"
            response = self.owner.http_session.post(
                "https://api.anthropic.com/v1/messages",
                headers=self.owner.claude_headers,
                json={
                    "model": getattr(settings, "anthropic_model_name", None) or getattr(settings, "claude_model_name", None) or "claude-haiku-4-5",
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": min(getattr(settings, "max_tokens", 2048), 1024),
                    "tools": [{
                        "name": tool_name,
                        "description": "Choose the next contract evidence tool to call.",
                        "input_schema": self._action_schema(),
                    }],
                    "tool_choice": {"type": "tool", "name": tool_name},
                },
                timeout=settings.api_timeout,
            )
            response.raise_for_status()
            for block in response.json().get("content", []):
                if block.get("type") == "tool_use" and block.get("name") == tool_name:
                    action = block.get("input")
                    return action if isinstance(action, dict) else None
            return None
        except Exception as exc:
            self._log_tool_action_fallback("Claude structured tool action failed", exc)
            return None

    def _log_tool_action_fallback(self, message: str, exc: Exception) -> None:
        logger = getattr(self.owner, "logger", None)
        if logger is not None:
            logger.warning("%s; falling back to JSON action prompt: %s", message, exc)

    def _final_answer_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "answer": {"type": "string"},
                "confidence": {
                    "type": "string",
                    "enum": ["high", "medium", "low"],
                },
                "tools_called": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "citations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "ref": {"type": "integer"},
                            "quote": {"type": "string"},
                            "page": {"type": "integer"},
                        },
                        "required": ["ref", "quote", "page"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["answer", "confidence", "tools_called", "citations"],
            "additionalProperties": False,
        }

    def query_final_answer(self, prompt: str) -> Dict[str, Any]:
        provider = self.provider
        if provider == "openai":
            action = self._query_openai_final_answer(prompt)
            if action:
                return action
        elif provider == "claude":
            action = self._query_claude_final_answer(prompt)
            if action:
                return action
        elif provider == "gemini":
            action = self._query_gemini_final_answer(prompt)
            if action:
                return action
        elif provider == "groq":
            action = self._query_groq_final_answer(prompt)
            if action:
                return action

        raw_action = self.owner._query_plain_markdown(prompt)
        return self.parse_final_answer(raw_action)

    def parse_final_answer(self, raw_text: str) -> Dict[str, Any]:
        text = str(raw_text or "").strip()
        if not text:
            return {"answer": "", "confidence": "low", "tools_called": [], "citations": []}
        fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if fenced:
            text = fenced.group(1).strip()
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start:end + 1]
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return {"answer": text, "confidence": "low", "tools_called": [], "citations": []}
        if not isinstance(parsed, dict):
            return {"answer": text, "confidence": "low", "tools_called": [], "citations": []}
        
        # Ensure default values exist matching schema
        if "answer" not in parsed:
            parsed["answer"] = ""
        if "confidence" not in parsed:
            parsed["confidence"] = "low"
        if "tools_called" not in parsed:
            parsed["tools_called"] = []
        if "citations" not in parsed:
            parsed["citations"] = []
            
        return parsed

    def _query_openai_final_answer(self, prompt: str) -> Optional[Dict[str, Any]]:
        try:
            response = self.owner.http_session.post(
                "https://api.openai.com/v1/chat/completions",
                headers=getattr(self.owner, "openai_headers", {"Authorization": f"Bearer {self.owner.openai_api_key}", "Content-Type": "application/json"}),
                json={
                    "model": getattr(settings, "openai_model_name", None) or "gpt-4o-mini",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                    "response_format": {
                        "type": "json_schema",
                        "json_schema": {
                            "name": "final_answer_response",
                            "strict": True,
                            "schema": self._final_answer_schema(),
                        },
                    },
                },
                timeout=settings.api_timeout,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            return json.loads(content)
        except Exception as exc:
            self._log_tool_action_fallback("OpenAI structured final answer failed", exc)
            return None

    def _query_claude_final_answer(self, prompt: str) -> Optional[Dict[str, Any]]:
        try:
            tool_name = "respond_final_answer"
            response = self.owner.http_session.post(
                "https://api.anthropic.com/v1/messages",
                headers=getattr(self.owner, "claude_headers", {
                    "x-api-key": self.owner.anthropic_api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                }),
                json={
                    "model": getattr(settings, "anthropic_model_name", None) or getattr(settings, "claude_model_name", None) or "claude-haiku-4-5",
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": min(getattr(settings, "max_tokens", 2048), 1024),
                    "tools": [{
                        "name": tool_name,
                        "description": "Respond with the final answer, confidence, tools called, and citations.",
                        "input_schema": self._final_answer_schema(),
                    }],
                    "tool_choice": {"type": "tool", "name": tool_name},
                },
                timeout=settings.api_timeout,
            )
            response.raise_for_status()
            for block in response.json().get("content", []):
                if block.get("type") == "tool_use" and block.get("name") == tool_name:
                    action = block.get("input")
                    return action if isinstance(action, dict) else None
            return None
        except Exception as exc:
            self._log_tool_action_fallback("Claude structured final answer failed", exc)
            return None

    def _query_gemini_final_answer(self, prompt: str) -> Optional[Dict[str, Any]]:
        try:
            model_name = getattr(settings, "gemini_model_name", None) or "gemini-2.0-flash"
            gemini_api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={self.owner.gemini_api_key}"
            response = self.owner.http_session.post(
                gemini_api_url,
                headers=getattr(self.owner, "gemini_headers", {"Content-Type": "application/json"}),
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {
                        "temperature": 0.0,
                        "responseMimeType": "application/json",
                        "responseSchema": self._final_answer_schema(),
                    },
                },
                timeout=settings.api_timeout,
            )
            response.raise_for_status()
            payload = response.json()
            content = payload.get("candidates", [{}])[0].get("content", {})
            parts = content.get("parts") or []
            raw_text = parts[0].get("text", "").strip() if parts else ""
            return json.loads(raw_text)
        except Exception as exc:
            self._log_tool_action_fallback("Gemini structured final answer failed", exc)
            return None

    def _query_groq_final_answer(self, prompt: str) -> Optional[Dict[str, Any]]:
        try:
            model_name = getattr(settings, "model_name", None) or "llama-3.3-70b-versatile"
            response = self.owner.http_session.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers=getattr(self.owner, "groq_headers", {"Authorization": f"Bearer {self.owner.groq_api_key}", "Content-Type": "application/json"}),
                json={
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": "You are a helpful assistant. You must respond with valid JSON matching the schema: " + json.dumps(self._final_answer_schema())},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0,
                    "response_format": {"type": "json_object"},
                    "max_completion_tokens": getattr(settings, "max_tokens", 2048),
                },
                timeout=settings.api_timeout,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            return json.loads(content)
        except Exception as exc:
            self._log_tool_action_fallback("Groq structured final answer failed", exc)
            return None
