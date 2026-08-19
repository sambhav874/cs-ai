.PHONY: dev dev-frontend dev-backend build build-frontend start-frontend lint-frontend \
        install install-frontend install-backend install-e2e \
        docker-build docker-up docker-down \
        e2e e2e-open e2e-dev \
        clean eval test-backend check-demo-quarantine \
        eval-agent eval-gate memory-maintenance

# ── Development ──────────────────────────────────────────────

dev:
	@echo "Starting frontend + backend..."
	@trap 'kill 0' EXIT; \
		$(MAKE) dev-frontend & \
		$(MAKE) dev-backend & \
		wait

dev-frontend:
	cd apps/frontend && npm run dev

dev-backend:
	cd apps/backend && poetry run uvicorn main:app --reload

eval:
	cd apps/backend && poetry run python scripts/run_interactive_eval.py

test-backend:
	cd apps/backend && PYTHONPATH=../.. poetry run pytest ../../final_evaluation/tests

# The agent gate. Needs no API key and no MongoDB: every test here drives the
# real agent path with an injected model and an injected tool executor. Run it on
# any change under services/contract_agent.
#
# Covers the eval harness itself (1.1), the synthesis-turn flag (1.2), tool
# routing policy (1.3), the citation pipeline (1.4), and typed tool errors plus
# the run budget (1.5).
AGENT_GATE_TESTS = \
	../../testing/backend/tests/test_agent_eval_gate.py \
	../../testing/backend/tests/test_agent_eval_end_to_end.py \
	../../testing/backend/tests/test_synthesis_turn_flag.py \
	../../testing/backend/tests/test_tool_routing_policy.py \
	../../testing/backend/tests/test_citation_pipeline.py \
	../../testing/backend/tests/test_tool_errors_and_budget.py \
	../../testing/backend/tests/test_scope_gate.py \
	../../testing/backend/tests/test_fact_corrections.py \
	../../testing/backend/tests/test_memory_composer.py \
	../../testing/backend/tests/test_episodic_memory.py \
	../../testing/backend/tests/test_semantic_memory.py \
	../../testing/backend/tests/test_user_preferences.py \
	../../testing/backend/tests/test_memory_lifecycle.py \
	../../testing/backend/tests/test_run_cancellation.py \
	../../testing/backend/tests/test_agent_stream.py

eval-gate:
	cd apps/backend && PYTHONPATH=../..:../../testing/backend poetry run pytest $(AGENT_GATE_TESTS) -q

# eval-agent calls the real model. Pass BASELINE=path/to/report.json to diff the
# seven metrics against another branch and fail on a citation-support regression.
eval-agent:
	cd apps/backend && PYTHONPATH=../..:../../testing/backend poetry run python \
		../../testing/backend/scripts/evaluate_contractsense_agent.py \
		--runner agent --suite smoke \
		--output ../../reports/agent-eval.json \
		--markdown-output ../../reports/agent-eval.md \
		$(if $(BASELINE),--baseline $(BASELINE) --fail-on-regression,)

# Offline memory lifecycle sweep (2.6): consolidates near-duplicate agent
# memories and archives idle chat sessions. Touches the real MONGODB_URI in
# .env — not part of eval-gate, run on a cron/ops cadence, not per-request.
# Pass DRY_RUN=1 to report without writing.
memory-maintenance:
	cd apps/backend && poetry run python scripts/memory_maintenance.py $(if $(DRY_RUN),--dry-run,)

# Canned demo answers live only in apps/frontend/lib/demoResponses.ts, behind
# NEXT_PUBLIC_AGENT_DEMO_MODE, and never claim verification. Fail the build if a
# hand-written citation asserts verified: true inside a rendering component.
check-demo-quarantine:
	@if grep -rn "verified: true" apps/frontend/components/; then \
		echo "ERROR: hardcoded verified:true citation in a component. Citations must come from the backend."; \
		exit 1; \
	fi
	@if grep -rln "AGENT_DEMO_MODE\|resolveDemoQuickAction" apps/frontend/lib/ | grep -v "demoResponses.ts"; then \
		echo "ERROR: demo content leaked outside apps/frontend/lib/demoResponses.ts."; \
		exit 1; \
	fi
	@echo "demo quarantine OK"


# ── Build ────────────────────────────────────────────────────

build: build-frontend

build-frontend:
	cd apps/frontend && npm run build

start-frontend:
	cd apps/frontend && npm run start

lint-frontend:
	cd apps/frontend && npm run lint

# ── Install ──────────────────────────────────────────────────

install: install-frontend install-backend

install-frontend:
	cd apps/frontend && npm install

install-backend:
	cd apps/backend && poetry install

install-e2e:
	cd testing/e2e && npm install

# ── Docker ───────────────────────────────────────────────────

docker-build:
	docker-compose build

docker-up:
	docker-compose up

docker-down:
	docker-compose down

# ── E2E Tests ────────────────────────────────────────────────

e2e:
	cd testing/e2e && npx cypress run --config-file cypress.config.ts

e2e-open:
	cd testing/e2e && npx cypress open --config-file cypress.config.ts

e2e-dev:
	cd testing/e2e && npx cypress run --config-file cypress.dev.config.ts

# ── Clean ────────────────────────────────────────────────────

clean:
	rm -rf apps/frontend/.next
	rm -rf apps/frontend/node_modules
	rm -rf apps/backend/__pycache__
	find apps/backend -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
