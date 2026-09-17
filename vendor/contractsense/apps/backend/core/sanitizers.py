import re
import logging
from utils.text_cleanup import clean_text_encoding

logger = logging.getLogger(__name__)

def sanitize_llm_input(text: str) -> str:
    """
    Sanitizes extracted document text to prevent LLM Prompt Injection attacks.
    Filters zero-width characters, truncates massive contiguous strings, and neuters common jailbreak commands.
    """
    if not text:
        return text

    text = clean_text_encoding(text)
    original_length = len(text)
    
    # 1. Remove zero-width characters and unusual control characters
    # These are often used by attackers to bypass simple string matching or hide instructions.
    # We keep standard whitespace like newlines and tabs.
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202f\u2060-\u206f]', '', text)
    
    # 2. Heuristic checks for known jailbreak vectors or injection attempts
    # We redact these phrases to prevent the LLM from executing them if they slip into context.
    danger_phrases = [
        # We only look for extremely specific LLM terminology that would never appear in a legitimate contract.
        # Phrases like "disregard the above" or "system override" are removed because they can be common in business/IT 
        # contracts and addendums, and we rely on the XML `<document_content>` tags to protect us.
        r"(?i)ignore\s+(all\s+)?previous\s+(system\s+)?prompts?",
        r"(?i)print\s+(your\s+)?(initial\s+)?system\s+prompt",
        r"(?i)output\s+(your\s+)?system\s+prompt",
        r"(?i)you\s+are\s+now\s+(an\s+)?(AI|assistant)\s+that",
    ]
    
    for phrase_regex in danger_phrases:
        if re.search(phrase_regex, text):
            logger.warning(f"Potential prompt injection detected (matched: {phrase_regex}). Sanitizing...")
            text = re.sub(phrase_regex, "[REDACTED INJECTION ATTEMPT]", text)
    
    # 3. Prevent excessively long contiguous strings (like base64 payloads)
    # Match any non-whitespace sequence longer than 500 characters and truncate it.
    text = re.sub(r'\S{500,}', '[TRUNCATED LONG STRING]', text)

    if len(text) != original_length:
        logger.info(f"Sanitization modified text. Original length: {original_length}, New length: {len(text)}")
        
    return clean_text_encoding(text).strip()
