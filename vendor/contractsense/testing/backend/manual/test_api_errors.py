import os
import sys
import asyncio

sys.path.append('/Users/sambhavjain/Desktop/Codes/extractor/extractor/apps/backend')
from best import ContractRAGSystem
from settings import settings
import logging

logging.basicConfig(level=logging.DEBUG)

prompt = """
You are an advanced contract analysis AI. Your task is to answer questions based on the provided contract context.

**CONTEXT:**
- You will be given a list of 'Available Document Segments' with unique IDs, and 'Retrieved Contract Context' from a vector search.
- Use this information to formulate your answers.

**CRITICAL RESPONSE REQUIREMENTS:**
1. You MUST respond ONLY with a valid JSON array of objects in the exact specified format below.
2. Do NOT include any introductory text, explanations, or content outside the JSON structure.
3. Escape all special characters in JSON strings (use \" for quotes within values).
4. Ensure all brackets and braces are properly closed.

**RESPONSE REQUIREMENTS:**
1.  **Detailed Answer (`value`):** Provide a detailed answer...
2.  **Evidence (`segment_ids`):** Identify segment IDs...
3.  **Reasoning (`justification`):** Briefly explain how...
4.  **Confidence (`confidence`):** Rate your confidence...

**Available Document Segments (Excerpt - use these IDs for referencing):**
segment_id_1: This is a test segment

**Retrieved Contract Context (from Vector Search - use for understanding, but reference Segment IDs from above):**
This is a test document context

**Questions to Answer:**
- What is the termination clause?
- Who are the parties involved?

**Response Format (Strict JSON Array of Objects):**
```json
[
{
    "question": "What are the distinct services and goods in this contract?",
    "value": "The distinct services include...",
    "segment_ids": ["segment_id_1"],
    "justification": "The services are described...",
    "confidence": "high"
}
]
```
"""

def test_groq():
    print("\n\n=== Testing Groq ===")
    settings.groq_strict_mode = True
    settings.model_name = "llama-3.1-8b-instant"  # model that supports JSON schema
    rag = ContractRAGSystem(ai_provider="groq")
    res = rag._query_groq(prompt)
    print("Groq Response:", res)

def test_claude():
    print("\n\n=== Testing Claude ===")
    settings.claude_strict_mode = True
    rag = ContractRAGSystem(ai_provider="claude")
    res = rag._query_claude(prompt)
    print("Claude Response:", res)

if __name__ == "__main__":
    test_groq()
    test_claude()
