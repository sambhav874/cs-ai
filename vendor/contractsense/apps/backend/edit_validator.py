# apps/backend/edit_validator.py

import logging
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class EditValidation(BaseModel):
    """Structured verdict on a user's edit to an extracted answer."""

    is_answer_valid: bool = Field(
        description="True if the edited answer is a relevant, logical response to the question."
    )
    is_reason_valid: bool = Field(
        description="True if the edited reason plausibly justifies changing the answer."
    )


class EditValidator:
    """
    A service class to handle AI-powered validation and refinement of user edits for answers and reasons.

    Goes through the shared model factory rather than posting to provider REST
    endpoints directly, so it picks up the account's configured provider/model
    and works on every provider the factory supports rather than only Groq and
    OpenAI. The two-boolean verdict is a Pydantic schema handed to the provider
    as a structured output, replacing the hand-rolled response_format branching
    and json.loads of the raw message content.
    """

    def __init__(self, ai_provider: str):
        self.ai_provider = (ai_provider or "groq").lower()
        logger.info(f"EditValidator initialized with provider: {self.ai_provider}")

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
        """

    def _build_llm(self) -> Optional[Any]:
        """Imported lazily — this module is imported by request handlers that
        shouldn't pay the agent package's import cost unless a validation runs."""
        from services.contract_agent.graph.model_factory import build_chat_model

        return build_chat_model(
            provider=self.ai_provider,
            purpose="classify",
            temperature=0.2,
            optional=True,
        )

    def validate(self, question: str, answer: str, reason: str) -> Dict[str, bool]:
        """Validates the relevance of an answer and reason."""
        prompt = self._get_validation_prompt(question, answer, reason)
        try:
            llm = self._build_llm()
            if llm is None:
                raise RuntimeError(f"No API key configured for provider '{self.ai_provider}'")

            from langchain_core.messages import HumanMessage

            structured = llm.with_structured_output(EditValidation, method="json_schema")
            result: EditValidation = structured.invoke([HumanMessage(content=prompt)])
            return {
                "is_answer_valid": bool(result.is_answer_valid),
                "is_reason_valid": bool(result.is_reason_valid),
            }
        except Exception as e:
            logger.error(f"Error during edit validation LLM call with {self.ai_provider}: {str(e)}")
            # Fail safe: If the AI service fails, don't block the user.
            return {"is_answer_valid": True, "is_reason_valid": True}
