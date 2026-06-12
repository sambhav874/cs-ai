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

    def query_gemini(self, prompt: str) -> Optional[List[Dict[str, Any]]]:
        model_name = getattr(settings, "gemini_model_name", None) or "gemini-pro"
        gemini_api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={self.owner.gemini_api_key}"
        response_schema = self._answer_array_schema()
        payload = {
            "contents": [{
                "parts": [{
                    "text": f"{prompt}\n\nIMPORTANT: You MUST respond with a valid JSON array that strictly follows this schema: {json.dumps(response_schema)}"
                }]
            }],
            "generationConfig": {
                "temperature": settings.temperature,
                "topP": settings.top_p,
                "response_mime_type": "application/json",
            }
        }

        try:
            response = self.owner.http_session.post(
                gemini_api_url,
                json=payload,
                headers=self.owner.gemini_headers,
                timeout=settings.api_timeout,
            )
            response.raise_for_status()
            response_json = response.json()
            if response_json.get("candidates") and response_json["candidates"][0].get("content"):
                content = response_json["candidates"][0]["content"]["parts"][0]["text"] if response_json["candidates"][0]["content"].get("parts") else None
                if content:
                    try:
                        parsed = json.loads(content)
                        if isinstance(parsed, list):
                            return parsed
                        json_match = re.search(r"```json\n([\s\S]+?)\n```", content)
                        if json_match:
                            return json.loads(json_match.group(1))
                        json_start = content.find("[")
                        json_end = content.rfind("]")
                        if json_start != -1 and json_end != -1:
                            return json.loads(content[json_start:json_end + 1])
                    except json.JSONDecodeError as exc:
                        self._error(f"Failed to parse Gemini response as JSON: {exc}")
                        self._debug("Gemini response content omitted from logs.")

            self._error("Unexpected Gemini API response structure.")
            return []
        except requests.exceptions.RequestException as exc:
            self._error(f"Gemini API request failed: {exc}")
            if exc.response is not None:
                self._error(f"Gemini API response status: {exc.response.status_code}")
            return None
        except Exception as exc:
            log_exception(self.logger, "Error in Gemini API query", exc)
            return None

    def query_groq(self, prompt: str) -> Optional[List[Dict[str, Any]]]:
        try:
            is_strict = getattr(settings, "groq_strict_mode", True)
            response_format = {"type": "json_object"}
            if is_strict:
                prompt += '\n\nIMPORTANT: For strict mode, you MUST wrap the final JSON array in an object with a single key \'answers\'. Example: {"answers": [...]}'
                response_format = self._openai_style_response_format()

            response = self.owner.http_session.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers=self.owner.groq_headers,
                json={
                    "model": settings.model_name,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": settings.temperature,
                    "top_p": settings.top_p,
                    "n": settings.n,
                    "frequency_penalty": settings.frequency_penalty,
                    "response_format": response_format,
                },
                timeout=settings.api_timeout,
            )
            if response.status_code == 429:
                self._error("Groq API rate limit exceeded (429).")
                return []
            response.raise_for_status()
            response_json = response.json()
            self._debug(f"Groq API raw response status: {response.status_code}")
            self._debug("Groq API raw response body omitted from logs.")
            if response_json.get("choices") and response_json["choices"][0].get("message"):
                content = response_json["choices"][0]["message"]["content"]
                self._debug("Groq API response content omitted from logs.")
                return self.process_response(content)
            self._error("Unexpected Groq API response structure.")
            return []
        except requests.exceptions.RequestException as exc:
            self._error(f"Groq API request failed: {exc}")
            if exc.response is not None:
                self._error(f"Groq API response status: {exc.response.status_code}")
            return None
        except Exception as exc:
            log_exception(self.logger, "Error in Groq API query", exc)
            return None

    def query_openai(self, prompt: str) -> Optional[List[Dict[str, Any]]]:
        openai_model = getattr(settings, "openai_model_name", None) or "gpt-4-turbo"
        try:
            is_strict = getattr(settings, "openai_strict_mode", True)
            response_format = {"type": "json_object"}
            if is_strict:
                prompt += '\n\nIMPORTANT: For strict mode, you MUST wrap the final JSON array in an object with a single key \'answers\'. Example: {"answers": [...]}'
                response_format = self._openai_style_response_format()

            response = self.owner.http_session.post(
                "https://api.openai.com/v1/chat/completions",
                headers=self.owner.openai_headers,
                json={
                    "model": openai_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": settings.temperature,
                    "top_p": settings.top_p,
                    "response_format": response_format,
                },
                timeout=settings.api_timeout,
            )
            response.raise_for_status()
            response_json = response.json()
            if response_json.get("choices") and response_json["choices"][0].get("message"):
                return self.process_response(response_json["choices"][0]["message"]["content"])
            self._error("Unexpected OpenAI API response structure.")
            return []
        except requests.exceptions.RequestException as exc:
            self._error(f"OpenAI API request failed: {exc}")
            if exc.response is not None:
                self._error(f"OpenAI API response status: {exc.response.status_code}")
            return None
        except Exception as exc:
            log_exception(self.logger, "Error in OpenAI API query", exc)
            return None

    def query_claude(self, prompt: str) -> Optional[List[Dict[str, Any]]]:
        claude_model = getattr(settings, "anthropic_model_name", None) or "claude-haiku-4-5"
        max_tokens = getattr(settings, "max_tokens", 65536)
        is_strict = getattr(settings, "claude_strict_mode", False)
        qa_schema = self._openai_style_response_format()["json_schema"]["schema"]

        try:
            if is_strict:
                tool_name = "extract_qa_answers"
                response = self.owner.http_session.post(
                    "https://api.anthropic.com/v1/messages",
                    headers=self.owner.claude_headers,
                    json={
                        "model": claude_model,
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": max_tokens,
                        "tools": [{
                            "name": tool_name,
                            "description": "Extract structured question-answer pairs from the contract analysis.",
                            "strict": True,
                            "input_schema": qa_schema,
                        }],
                        "tool_choice": {"type": "tool", "name": tool_name},
                    },
                    timeout=settings.api_timeout,
                )
                response.raise_for_status()
                for block in response.json().get("content", []):
                    if block.get("type") == "tool_use" and block.get("name") == tool_name:
                        return block["input"].get("answers", [])
                self._error(f"Claude structured output: no tool_use block found for tool '{tool_name}'.")
                return []

            response = self.owner.http_session.post(
                "https://api.anthropic.com/v1/messages",
                headers=self.owner.claude_headers,
                json={
                    "model": claude_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": settings.temperature,
                    "top_p": settings.top_p,
                    "max_tokens": max_tokens,
                },
                timeout=settings.api_timeout,
            )
            response.raise_for_status()
            response_json = response.json()
            if response_json.get("content") and isinstance(response_json["content"], list) and response_json["content"][0].get("text"):
                return self.process_response(response_json["content"][0]["text"])
            self._error("Unexpected Claude API response structure.")
            return []
        except requests.exceptions.RequestException as exc:
            self._error(f"Claude API request failed: {exc}")
            if exc.response is not None:
                self._error(f"Claude API response status: {exc.response.status_code}")
            return None
        except Exception as exc:
            log_exception(self.logger, "Error in Claude API query", exc)
            return None

    def query_huggingface(self, prompt: str) -> Optional[List[Dict[str, Any]]]:
        try:
            if not hasattr(self.owner, "model") or not hasattr(self.owner, "tokenizer"):
                self._error("HuggingFace model or tokenizer not initialized.")
                return []
            response = self.owner.model(
                prompt,
                max_length=getattr(settings, "max_tokens", 1024),
                num_return_sequences=1,
                temperature=settings.temperature if settings.temperature > 0 else 0.1,
                top_p=settings.top_p if settings.top_p > 0 else None,
                pad_token_id=self.owner.tokenizer.eos_token_id,
            )
            if response and response[0].get("generated_text"):
                generated_text = response[0]["generated_text"]
                if generated_text.startswith(prompt):
                    content = generated_text[len(prompt):]
                else:
                    content = generated_text
                    self._warning("HuggingFace output did not start with the prompt. Using full generated text.")
                return self.process_response(content)
            self._error("Unexpected HuggingFace response structure.")
            return None
        except Exception as exc:
            log_exception(self.logger, "Error in HuggingFace query", exc)
            return None

    def process_response(self, content: str) -> Optional[List[Dict[str, Any]]]:
        """Extract and normalize structured answers from a provider response."""
        try:
            self._debug("Raw LLM content omitted from logs.")
            cleaned_content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
            cleaned_content = re.sub(r"^```json|```$", "", cleaned_content, flags=re.MULTILINE).strip()
            json_str = ""

            json_match = re.search(r"```(?:json)?\n([\s\S]+?)\n```", cleaned_content)
            if json_match:
                json_str = json_match.group(1).strip()
                self._debug("Extracted JSON from code block markers")

            if not json_str:
                json_start = cleaned_content.find("[")
                json_end = cleaned_content.rfind("]")
                if json_start != -1 and json_end != -1 and json_end > json_start:
                    json_str = cleaned_content[json_start:json_end + 1]
                    self._debug("Extracted JSON by finding outermost brackets")

            if not json_str:
                json_objects = re.findall(r"\{.*?\}", cleaned_content, re.DOTALL)
                if json_objects:
                    json_str = "[" + ",".join(json_objects) + "]"
                    self._debug("Constructed JSON array from individual objects")

            if not json_str:
                self._error("No JSON structure found in provider response.")
                return None

            try:
                json_str = re.sub(r'(?<!\\)"(?=\s*:)', '"', json_str)
                json_str = re.sub(r"(?<=:)\s*'([^']+)'\s*(?=,)", r' "\1"', json_str)
                parsed_json = json.loads(json_str)
                if not isinstance(parsed_json, list):
                    if isinstance(parsed_json, dict):
                        if "answers" in parsed_json and isinstance(parsed_json["answers"], list):
                            parsed_json = parsed_json["answers"]
                        else:
                            parsed_json = [parsed_json]
                    else:
                        raise ValueError("Top-level JSON is not an array or object")

                processed_list = []
                for item_idx, item in enumerate(parsed_json):
                    if not isinstance(item, dict):
                        self._warning(f"Item {item_idx} is not a dictionary: {item}")
                        continue
                    confidence = str(item.get("confidence", "medium")).lower()
                    if confidence not in {"high", "medium", "low"}:
                        confidence = "medium"
                    processed_list.append({
                        "question": str(item.get("question", f"Unknown Question {item_idx + 1}")),
                        "value": str(item.get("value", "")),
                        "segment_ids": list(item.get("segment_ids", [])),
                        "justification": str(item.get("justification", "")),
                        "confidence": confidence,
                    })
                self._info(f"Successfully processed {len(processed_list)} answers from JSON response")
                return processed_list
            except json.JSONDecodeError as exc:
                self._error(f"JSON parsing error: {str(exc)}")
                self._debug("Problematic JSON content omitted from logs.")
                return []
        except Exception as exc:
            log_exception(self.logger, "Unexpected error in _process_response", exc)
            return []

    def _answer_array_schema(self) -> Dict[str, Any]:
        return {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question": {"type": "string"},
                    "value": {"type": "string"},
                    "segment_ids": {"type": "array", "items": {"type": "string"}},
                    "justification": {"type": "string"},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                },
                "required": ["question", "value", "segment_ids", "justification", "confidence"],
            },
        }

    def _openai_style_response_format(self) -> Dict[str, Any]:
        return {
            "type": "json_schema",
            "json_schema": {
                "name": "extracted_answers",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "answers": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "question": {"type": "string"},
                                    "value": {"type": "string"},
                                    "segment_ids": {"type": "array", "items": {"type": "string"}},
                                    "justification": {"type": "string"},
                                    "confidence": {"type": "string"},
                                },
                                "required": ["question", "value", "segment_ids", "justification", "confidence"],
                                "additionalProperties": False,
                            },
                        },
                    },
                    "required": ["answers"],
                    "additionalProperties": False,
                },
            },
        }

    def _debug(self, message: str) -> None:
        if self.logger is not None:
            self.logger.debug(message)

    def _info(self, message: str) -> None:
        if self.logger is not None:
            self.logger.info(message)

    def _warning(self, message: str) -> None:
        if self.logger is not None:
            self.logger.warning(message)

    def _error(self, message: str) -> None:
        if self.logger is not None:
            self.logger.error(message)


class StructuredLLMClient:
    """Dispatch structured prompts to the configured provider."""

    def __init__(self, owner: Any):
        self.owner = owner

    @property
    def provider(self) -> str:
        return str(getattr(self.owner, "ai_provider", "groq") or "groq").lower()

    def query_answers(self, prompt: str) -> Optional[List[Dict[str, Any]]]:
        provider = self.provider
        if provider == "gemini":
            return self.owner._query_gemini(prompt)
        if provider == "groq":
            return self.owner._query_groq(prompt)
        if provider == "openai":
            return self.owner._query_openai(prompt)
        if provider == "claude":
            return self.owner._query_claude(prompt)
        return self.owner._query_huggingface(prompt)

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
                        "read_evidence",
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
