# 18 — Testing Strategy

## Testing Pyramid

```
         ╱  E2E Tests  ╲       ← 10% — Critical user journeys
        ╱  Integration   ╲     ← 30% — Service interactions, API contracts
       ╱    Unit Tests     ╲   ← 60% — Business logic, utilities, components
```

---

## Unit Tests

| Layer | Framework | What to Test |
|-------|-----------|-------------|
| Backend (Node.js) | Vitest | Service logic, data transformations, validation, state machines, RBAC evaluation, workflow engine rules |
| Agent (Python) | Pytest | Agent logic (mocked LLM), tool selection, playbook matching, confidence scoring, orchestrator routing |
| Frontend (React) | Vitest + React Testing Library | Component rendering, user interactions, form validation, state management, conditional UI |

### Agent-Specific Unit Testing

```python
# Test that Draft Agent selects correct template
async def test_draft_agent_template_selection():
    agent = DraftAgent(llm=MockLLM())
    result = await agent.select_template(
        contract_type="nda",
        jurisdiction="Delaware",
        deal_value=0,
    )
    assert result.template_id == "tpl_nda_standard"
    assert result.confidence > 0.9

# Test confidence gating
async def test_low_confidence_triggers_human_review():
    agent = DraftAgent(llm=MockLLM(confidence=0.6))
    result = await agent.execute(mock_state)
    assert result.requires_human_review is True
```

---

## Integration Tests

| Scope | Tool | What to Test |
|-------|------|-------------|
| API endpoints | Supertest + Vitest | Request/response contracts, auth middleware, RBAC enforcement, error handling |
| Database | Prisma + test DB | Migrations, RLS policies, complex queries, data integrity |
| Agent ↔ Backend | gRPC test client | Agent invocation, response processing, error handling |
| Event pipeline | Redis test instance | Event publishing, consumption, ordering |
| Search | Elasticsearch test instance | Indexing, search results, relevance ranking |

### RBAC Integration Tests

```typescript
// Test that Sales Rep cannot edit contracts they don't own
test("sales rep cannot edit unowned contract", async () => {
  const res = await request(app)
    .patch("/api/v1/contracts/ctr_other_persons")
    .set("Authorization", `Bearer ${salesRepToken}`)
    .send({ title: "Modified" });
  expect(res.status).toBe(403);
});
```

---

## End-to-End Tests

Critical user journeys tested with Playwright:

### Per-Phase E2E Scenarios

| Phase | E2E Scenario | Steps |
|-------|-------------|-------|
| 1 | Login and see dashboard | Open app → login → verify dashboard loads |
| 2 | Upload and find contract | Upload PDF → search for it → verify detail page |
| 3 | Submit request and assign | Fill intake form → submit → see in queue → assign |
| 4 | Draft contract from template | Select template → generate draft → open in editor → edit → save |
| 5 | Negotiate with counterparty | Send to portal → counterparty redlines → view diff → counter-propose |
| 6 | Approve a contract | Submit for approval → approver sees request → approves → status changes |
| 7 | Sign a contract | Send for signature → external signer signs → contract filed as executed |
| 8 | Track obligations | Executed contract → obligations extracted → alert fires → mark complete |
| 9 | View analytics dashboard | Open dashboard → verify metrics → drill into chart |
| 10 | CRM integration | Salesforce opportunity updates → contract request auto-created |

### Full Lifecycle E2E (Smoke Test)

The most important test — runs the complete happy path:

```
Login → Submit request → Draft NDA from template → AI review passes →
Submit for approval → Approve → Send for signature → Signer signs →
Contract filed as executed → Obligations extracted → Dashboard shows
the new contract → Search finds it → Agent answers questions about it
```

This test should run on every deploy.

---

## Agent Testing

### LLM Response Mocking

For deterministic testing, mock LLM responses:

```python
class MockLLM:
    def __init__(self, responses: dict):
        self.responses = responses

    async def generate(self, prompt: str) -> str:
        for pattern, response in self.responses.items():
            if pattern in prompt:
                return response
        return "Mock default response"
```

### Agent Evaluation Framework

For non-deterministic testing (quality assurance), use evaluation datasets:

| Agent | Eval Dataset | Metrics |
|-------|-------------|---------|
| Draft Agent | 50 known-good contract requests → expected template selection | Template accuracy %, field population accuracy % |
| Review Agent | 100 contracts with known risk profiles → expected risk scores | Risk score correlation with human assessment |
| Redline Agent | 30 negotiation scenarios → expected counter-proposals | Playbook compliance %, quality rating by legal SME |
| Search Agent | 100 natural language queries → expected results | Precision@5, recall, Mean Reciprocal Rank |
| Obligation Agent | 50 contracts with known obligations → expected extraction | Obligation extraction recall %, date accuracy % |

Run agent evals weekly on staging environment. Track quality metrics over time.

---

## Performance Testing

| Test | Tool | Target |
|------|------|--------|
| API load test | k6 | 500 concurrent users, <200ms p95 for list endpoints, <500ms for search |
| Agent response time | Custom benchmark | <3s for simple chat responses, <10s for document generation |
| Search performance | Elasticsearch benchmark | <500ms for full-text search across 100K contracts |
| Collaborative editing | WebSocket load test | 10 concurrent editors, <100ms change propagation |
| Bulk operations | Custom benchmark | Process 1000 PDFs in <30 minutes |

---

## Security Testing

- [ ] OWASP Top 10 scan (ZAP or Burp Suite) — every release
- [ ] Dependency vulnerability scan (Snyk/Dependabot) — continuous
- [ ] RBAC penetration testing — every phase
- [ ] JWT manipulation testing — Phase 1
- [ ] SQL injection testing — Phase 1
- [ ] XSS testing (especially in editor/portal) — Phase 4/5
- [ ] File upload security (malware scan, size limits) — Phase 2
- [ ] Rate limiting verification — Phase 1
