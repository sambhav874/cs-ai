import sys
import os
import json
from pathlib import Path

# Add backend to path
sys.path.append("/Users/sambhavjain/Desktop/Codes/extractor/extractor/apps/backend")
from best import ContractRAGSystem

rag = ContractRAGSystem(ai_provider="groq")
questions = ["What are the explicitly stated primary goods or services (performance obligations) that the contractor promises to transfer to the customer under this contract?"]

# We will pass empty retrieved docs to see if the fallback runs
res = rag.query_model(questions, "Test Contract", [])

for ans in res:
    print("QUESTION: ", ans.question)
    print("VALUE: ", ans.value)
    print("SEGMENT_IDS: ", ans.reference.segment_ids)
