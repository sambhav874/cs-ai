"""The reranker goes through the Voyage SDK, which sends a MongoDB Atlas model
API key to ai.mongodb.com and a Voyage key to api.voyageai.com. It used to
post to api.voyageai.com by hand, which rejects Atlas-issued keys."""
from types import SimpleNamespace

from services.contract_agent.rag.reranker import VoyageReranker


class FakeClient:
    def __init__(self):
        self.calls = []

    def rerank(self, query, documents, model, top_k=None, truncation=True):
        self.calls.append(dict(query=query, documents=documents, model=model, top_k=top_k, truncation=truncation))
        return SimpleNamespace(results=[
            SimpleNamespace(index=1, relevance_score=0.9),
            SimpleNamespace(index=0, relevance_score=0.2),
        ])


def test_rerank_uses_the_sdk_and_keeps_order():
    r = VoyageReranker(api_key="al-test", model="rerank-2.5-lite", top_k=5)
    r._client = FakeClient()
    assert r.rerank("liability cap", ["payment terms", "liability is capped"]) == [(1, 0.9), (0, 0.2)]
    call = r._client.calls[0]
    assert call["model"] == "rerank-2.5-lite" and call["top_k"] == 2 and call["truncation"] is True


def test_an_empty_list_makes_no_call():
    r = VoyageReranker(api_key="al-test")
    r._client = FakeClient()
    assert r.rerank("q", []) == []
    assert r._client.calls == []


def test_the_sdk_client_is_built_with_the_key():
    r = VoyageReranker(api_key="pa-test")
    assert r.client.api_key == "pa-test"
