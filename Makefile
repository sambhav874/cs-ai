.PHONY: dev dev-frontend dev-backend build build-frontend start-frontend lint-frontend \
        install install-frontend install-backend install-e2e \
        docker-build docker-up docker-down \
        e2e e2e-open e2e-dev \
        clean eval test-backend

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
