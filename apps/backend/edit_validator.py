# apps/backend/edit_validator.py

import logging
from typing import Dict, List, Any
import requests
import json
from core.config import Settings

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class EditValidator:
    """
    A service class to handle AI-powered validation and refinement of user edits for answers and reasons.
    """
    def __init__(self, ai_provider: str):
        self.settings = Settings()
        self.ai_provider = ai_provider.lower()
        logger.info(f"EditValidator initialized with provider: {self.ai_provider}")
        
        # Initialize API keys from settings
        self.groq_api_key = self.settings.groq_api_key
        self.openai_api_key = self.settings.openai_api_key
        
        # Set up headers for each provider
        self.groq_headers = {"Authorization": f"Bearer {self.groq_api_key}", "Content-Type": "application/json"}
        self.openai_headers = {"Authorization": f"Bearer {self.openai_api_key}", "Content-Type": "application/json"}

    def _get_validation_prompt(self, question: str, answer: str, reason: str) -> str:
        return f"""
        You are an AI Quality Assurance assistant. Your task is to validate user-submitted edits for a contract analysis system.
        Analyze the following inputs:
        <Question>
        {question}
        </Question>
        <EditedAnswer>
        {answer}
        </EditedAnswer>
        <EditedReason>
        {reason}
        </EditedReason>

        Perform the following checks:
        1. Answer Validity: Does the <EditedAnswer> provide a relevant and logical answer to the <Question>? It should not be gibberish, nonsensical, or completely off-topic.
        2. Reason Validity: Does the <EditedReason> provide a plausible justification for changing an answer? It should explain *why* an edit was made.

        Respond with a single, minified JSON object with two boolean keys: `is_answer_valid` and `is_reason_valid`. Do not provide any other text or explanation.
        """

    def _query_provider_for_json(self, prompt: str) -> Dict[str, Any]:
        """A generic method to query the selected provider and get a JSON response."""
        provider_map = {
            'groq': self._query_groq,
            'openai': self._query_openai,
        }
        query_func = provider_map.get(self.ai_provider)
        
        if not query_func:
            raise ValueError(f"Invalid or unsupported AI provider '{self.ai_provider}' for edit validation.")
        
        return query_func(prompt)

    def _query_groq(self, prompt: str) -> Dict[str, Any]:
        is_strict = getattr(self.settings, 'groq_strict_mode', False)
        response_format = {"type": "json_object"}
        if is_strict:
            schema = {
                "type": "object",
                "properties": {
                    "is_answer_valid": {"type": "boolean"},
                    "is_reason_valid": {"type": "boolean"}
                },
                "required": ["is_answer_valid", "is_reason_valid"],
                "additionalProperties": False
            }
            response_format = {
                "type": "json_schema",
                "json_schema": {
                    "name": "validation_response",
                    "strict": True,
                    "schema": schema
                }
            }
            
        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers=self.groq_headers,
            json={
                "model": getattr(self.settings, 'model_name', 'llama3-8b-8192'), # Or your preferred model
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2,
                "max_tokens": 1024,
                "response_format": response_format,
            },
            timeout=30
        )
        response.raise_for_status()
        response_text = response.json()["choices"][0]["message"]["content"]
        return json.loads(response_text)
        
    def _query_openai(self, prompt: str) -> Dict[str, Any]:
        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers=self.openai_headers,
            json={
                "model": getattr(self.settings, 'openai_model_name', 'gpt-4-turbo'),
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2,
                "max_tokens": 1024,
                "response_format": {"type": "json_object"},
            },
            timeout=30
        )
        response.raise_for_status()
        response_text = response.json()["choices"][0]["message"]["content"]
        return json.loads(response_text)

    def validate(self, question: str, answer: str, reason: str) -> Dict[str, bool]:
        """Validates the relevance of an answer and reason."""
        prompt = self._get_validation_prompt(question, answer, reason)
        try:
            result_json = self._query_provider_for_json(prompt)
            return {
                "is_answer_valid": result_json.get("is_answer_valid", False),
                "is_reason_valid": result_json.get("is_reason_valid", False)
            }
        except Exception as e:
            logger.error(f"Error during edit validation LLM call with {self.ai_provider}: {str(e)}")
            # Fail safe: If the AI service fails, don't block the user.
            return {"is_answer_valid": True, "is_reason_valid": True}
