import unittest
import importlib.util
import sys
import types
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = ROOT / "apps/backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
if "fitz" not in sys.modules:
    sys.modules["fitz"] = types.ModuleType("fitz")


def load_backend_module(name, path):
    package_parts = name.split(".")[:-1]
    current_path = ROOT
    for index, part in enumerate(package_parts):
        package_name = ".".join(package_parts[: index + 1])
        current_path = current_path / part
        if package_name not in sys.modules:
            package = types.ModuleType(package_name)
            package.__path__ = [str(current_path)]
            sys.modules[package_name] = package
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


state_module = load_backend_module(
    "apps.backend.services.contract_agent.graph.state",
    "apps/backend/services/contract_agent/graph/state.py",
)
executor_module = load_backend_module(
    "apps.backend.services.contract_agent.graph.tools.executor",
    "apps/backend/services/contract_agent/graph/tools/executor.py",
)
system_prompt_module = load_backend_module(
    "apps.backend.services.contract_agent.system_prompt",
    "apps/backend/services/contract_agent/system_prompt.py",
)

AgentContext = state_module.AgentContext
AgentRunState = state_module.AgentRunState
ToolCallRecord = state_module.ToolCallRecord
execute_mongo_read_tool = executor_module.execute_mongo_read_tool
vector_search_kwargs = executor_module._vector_search_kwargs
vector_collection_for = executor_module._vector_collection


class FakeDatabase:
    def __init__(self, vector_collection, client=None):
        self.vector_collection = vector_collection
        self.client = client

    def __getitem__(self, name):
        del name
        return self.vector_collection


class FakeClient:
    def __init__(self, vector_collection):
        self.vector_collection = vector_collection
        self.requested_databases = []

    def __getitem__(self, name):
        self.requested_databases.append(name)
        return FakeDatabase(self.vector_collection)


class FakeVectorCollection:
    def __init__(self, documents):
        self.documents = documents

    def find(self, query, projection=None):
        del projection
        selectors = query.get("$or", []) if isinstance(query, dict) else []
        if not selectors:
            return list(self.documents)
        return [document for document in self.documents if any(self._matches(document, selector) for selector in selectors)]

    def _matches(self, document, selector):
        for key, value in selector.items():
            if key.startswith("metadata."):
                actual = (document.get("metadata") or {}).get(key.split(".", 1)[1])
            else:
                actual = document.get(key)
            if actual != value:
                return False
        return True


class FakeCollection:
    def __init__(self, documents, vector_documents=None):
        self.documents = documents
        if vector_documents is not None:
            self.database = FakeDatabase(FakeVectorCollection(vector_documents))

    def find(self, query, projection):
        del projection
        wanted = {str(item) for item in query["_id"]["$in"]}
        return [document for document in self.documents if str(document["_id"]) in wanted]


def state_for(message):
    return AgentRunState(
        user_id="eval-user",
        message=message,
        context=AgentContext(contract_id="doc-1", selected_document_ids=["doc-1"]),
    )


class AgentEvidenceToolsTest(unittest.TestCase):
    def setUp(self):
        self.vector_documents = [
            {
                "contract_id": "doc-1",
                "document_id": "doc-1",
                "contract_name": "Airport Food Services Agreement",
                "segment_id": "seg-article-i",
                "section_path": "ARTICLE I: DEFINITIONS",
                "chunk_level": "macro",
                "page_number": 1,
                "char_start": 0,
                "char_end": 80,
                "text": "ARTICLE I: DEFINITIONS\nSection 1.01: Defined Terms",
            },
            {
                "contract_id": "doc-1",
                "document_id": "doc-1",
                "contract_name": "Airport Food Services Agreement",
                "segment_id": "seg-section-101",
                "section_path": "Section 1.01: Defined Terms",
                "chunk_level": "meso",
                "page_number": 1,
                "char_start": 20,
                "char_end": 80,
                "text": "Section 1.01: Defined Terms",
            },
            {
                "contract_id": "doc-1",
                "document_id": "doc-1",
                "contract_name": "Airport Food Services Agreement",
                "segment_id": "seg-article-ii",
                "section_path": "ARTICLE II: SERVICE LEVELS",
                "chunk_level": "macro",
                "page_number": 2,
                "char_start": 81,
                "char_end": 220,
                "text": "ARTICLE II: SERVICE LEVELS\nSection 2.01: Special Meals\nStandard special meals require 24 hours advance notice.",
            },
            {
                "contract_id": "doc-1",
                "document_id": "doc-1",
                "contract_name": "Airport Food Services Agreement",
                "segment_id": "seg-section-201",
                "section_path": "Section 2.01: Special Meals",
                "chunk_level": "meso",
                "page_number": 2,
                "char_start": 110,
                "char_end": 220,
                "text": "Section 2.01: Special Meals\nStandard special meals require 24 hours advance notice.",
            },
            {
                "contract_id": "doc-1",
                "document_id": "doc-1",
                "contract_name": "Airport Food Services Agreement",
                "segment_id": "seg-article-iii",
                "section_path": "ARTICLE III: PRICING AND PAYMENT",
                "chunk_level": "macro",
                "page_number": 3,
                "char_start": 221,
                "char_end": 420,
                "text": "ARTICLE III: PRICING AND PAYMENT\nSection 3.01: Base Meal Rates\nMeal Category | Base Rate (USD) | Annual Escalation\nBusiness Class | $28.50 - $42.00 | 3.5%",
            },
            {
                "contract_id": "doc-1",
                "document_id": "doc-1",
                "contract_name": "Airport Food Services Agreement",
                "segment_id": "seg-pricing",
                "section_path": "ARTICLE III: PRICING AND PAYMENT > Section 3.01: Base Meal Rates",
                "chunk_level": "meso",
                "page_number": 3,
                "char_start": 260,
                "char_end": 420,
                "text": "Section 3.01: Base Meal Rates\nMeal Category | Base Rate (USD) | Annual Escalation\nBusiness Class | $28.50 - $42.00 | 3.5%",
            },
            {
                "contract_id": "other-doc",
                "document_id": "other-doc",
                "contract_name": "HealthGate Data Corp Hosting and Management Agreement",
                "namespace": "contract-doc-1",
                "segment_id": "seg-healthgate-clause-6",
                "section_path": "Clause 6",
                "chunk_level": "meso",
                "page_number": 9,
                "char_start": 100,
                "char_end": 300,
                "text": "Clause 6 release fee statutory declaration HealthGate Data Corp Hosting and Management Agreement.",
            },
        ]
        self.collection = FakeCollection([
            {
                "_id": "doc-1",
                "contract_name": "Airport Food Services Agreement",
                "index": {
                    "status": "success",
                    "vector_namespace": "contract-doc-1",
                    "vector_backend": "mongodb",
                    "vector_count": 6,
                    "content": (
                        "ARTICLE I: DEFINITIONS\n"
                        "Section 1.01: Defined Terms\n\n"
                        "ARTICLE II: SERVICE LEVELS\n"
                        "Section 2.01: Special Meals\n"
                        "Standard special meals require 24 hours advance notice.\n\n"
                        "ARTICLE III: PRICING AND PAYMENT\n"
                        "Section 3.01: Base Meal Rates\n"
                        "Business Class $28.50 - $42.00.\n"
                    ),
                },
            }
        ], vector_documents=self.vector_documents)

    def test_outline_document_returns_article_count_and_headings(self):
        result = execute_mongo_read_tool(
            self.collection,
            ToolCallRecord(name="outline_document", args={"document_id": "doc-1"}),
            state_for("Outline the active document."),
        )

        self.assertEqual(result["article_count"], 3)
        self.assertEqual(result["section_count"], 3)
        self.assertIn("ARTICLE III: PRICING AND PAYMENT", [heading["heading"] for heading in result["headings"]])

    def test_search_evidence_expands_numeric_article_reference_to_roman_heading(self):
        result = execute_mongo_read_tool(
            self.collection,
            ToolCallRecord(
                name="search_evidence",
                args={
                    "query": "explain article 3",
                    "top_k": 3,
                },
            ),
            state_for("Explain article 3."),
        )

        self.assertIn("ARTICLE III", result["rewritten_queries"])
        self.assertIn("seg-article-iii", [match["segment_id"] for match in result["matches"]])
        self.assertTrue(any("PRICING AND PAYMENT" in match["snippet"] for match in result["matches"]))

    def test_search_evidence_uses_rewritten_query_against_vector_chunks(self):
        result = execute_mongo_read_tool(
            self.collection,
            ToolCallRecord(
                name="search_evidence",
                args={
                    "query": "meal rates pricing table base rate annual escalation",
                    "top_k": 5,
                },
            ),
            state_for("What rates are there for meals?"),
        )

        self.assertGreaterEqual(len(result["matches"]), 1)
        self.assertEqual(result["retrieval_backend"], "hybrid")
        self.assertEqual(result["rewritten_query"], "meal rates pricing table base rate annual escalation")
        self.assertIn("seg-pricing", [match["segment_id"] for match in result["matches"]])
        self.assertTrue(any("Base Meal Rates" in match["snippet"] for match in result["matches"]))

    def test_read_evidence_reads_vector_segment_returned_by_search(self):
        result = execute_mongo_read_tool(
            self.collection,
            ToolCallRecord(name="read_evidence", args={"evidence_ids": ["doc-1:seg-pricing"]}),
            state_for("Read the pricing evidence."),
        )

        self.assertEqual(len(result["matches"]), 1)
        self.assertEqual(result["matches"][0]["segment_id"], "seg-pricing")
        self.assertIn("Annual Escalation", result["matches"][0]["snippet"])

    def test_search_evidence_marks_index_content_fallback(self):
        fallback_collection = FakeCollection(self.collection.documents)
        result = execute_mongo_read_tool(
            fallback_collection,
            ToolCallRecord(
                name="search_evidence",
                args={"query": "pricing payment base meal rates annual escalation", "top_k": 5},
            ),
            state_for("What rates are there for meals?"),
        )

        self.assertEqual(result["retrieval_backend"], "fallback_index")
        self.assertGreaterEqual(len(result["matches"]), 1)

    def test_search_evidence_filters_vector_chunks_to_current_scope(self):
        result = execute_mongo_read_tool(
            self.collection,
            ToolCallRecord(
                name="search_evidence",
                args={"query": "HealthGate Clause 6 release fee statutory declaration", "top_k": 5},
            ),
            state_for("Explain Article 6."),
        )

        self.assertFalse(any(match.get("document_id") == "other-doc" for match in result["matches"]))
        self.assertFalse(any("HealthGate" in match.get("snippet", "") for match in result["matches"]))

    def test_vector_search_kwargs_prefilters_namespace_and_current_document(self):
        kwargs = vector_search_kwargs(
            {"_id": "doc-1"},
            namespace="contract-doc-1",
            k=8,
        )

        self.assertEqual(kwargs["k"], 8)
        self.assertEqual(kwargs["pre_filter"]["namespace"], {"$eq": "contract-doc-1"})
        self.assertIn({"contract_id": {"$eq": "doc-1"}}, kwargs["pre_filter"]["$or"])
        self.assertIn({"document_id": {"$eq": "doc-1"}}, kwargs["pre_filter"]["$or"])

    def test_vector_collection_uses_configured_vector_database(self):
        configured_collection = FakeVectorCollection([])
        client = FakeClient(configured_collection)
        fake_contract_collection = types.SimpleNamespace(
            database=FakeDatabase(FakeVectorCollection([]), client=client)
        )
        original_core = sys.modules.get("core")
        original_config = sys.modules.get("core.config")
        fake_core = types.ModuleType("core")
        fake_core.__path__ = []
        fake_config = types.ModuleType("core.config")
        fake_config.settings = types.SimpleNamespace(
            mongodb_db_name="contract_analysis",
            mongodb_collection_name="contract_vectors",
        )
        sys.modules["core"] = fake_core
        sys.modules["core.config"] = fake_config
        try:
            resolved = vector_collection_for(fake_contract_collection)
        finally:
            if original_core is None:
                sys.modules.pop("core", None)
            else:
                sys.modules["core"] = original_core
            if original_config is None:
                sys.modules.pop("core.config", None)
            else:
                sys.modules["core.config"] = original_config

        self.assertIs(resolved, configured_collection)
        self.assertEqual(client.requested_databases, ["contract_analysis"])

    def test_executor_has_no_query_specific_structure_branch(self):
        source = (ROOT / "apps/backend/services/contract_agent/graph/tools/executor.py").read_text()

        self.assertNotIn("_is_structure_query", source)
        self.assertNotIn("Detected article count", source)
        self.assertNotIn("how much", source.lower())

    def test_system_prompt_requires_rewritten_search_queries(self):
        prompt = system_prompt_module.LANGGRAPH_REACT_SYSTEM_PROMPT

        self.assertIn("Rewrite the user's contract-specific need", prompt)
        self.assertIn("multiple rewritten queries", prompt)


if __name__ == "__main__":
    unittest.main()
