#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# ContractSense — Dockerfile Smoke Test
# ============================================================
# Fast structural validation (no full builds — they take minutes).
# For full build: docker compose build
#
# Usage: ./test_dockerfiles.sh
# ============================================================

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
PASS=0; FAIL=0

pass() { PASS=$((PASS+1)); echo -e "  ${GREEN}PASS${NC} $1"; }
fail() { FAIL=$((FAIL+1)); echo -e "  ${RED}FAIL${NC} $1"; }

echo ""
echo "═══════════════════════════════════════════════"
echo "  ContractSense Dockerfile Smoke Test"
echo "═══════════════════════════════════════════════"
echo ""

# ── 1. Stage names match what compose files reference ──────
echo -e "${CYAN}[1]${NC} Stage name validation..."

# Frontend Containerfile must have: deps, builder, production, development
for stage in deps builder production development; do
    if grep -q "AS $stage" apps/frontend/Containerfile; then
        pass "Frontend stage '$stage' exists"
    else
        fail "Frontend stage '$stage' MISSING"
    fi
done

# Backend Containerfile — single-stage, no named targets
if grep -qF "FROM" apps/backend/Containerfile; then
    pass "Backend Containerfile has FROM line"
else
    fail "Backend Containerfile MISSING FROM line"
fi

# ── 2. Context path alignment ──────────────────────────────
echo -e "${CYAN}[2]${NC} Context path alignment..."

# Backend Containerfile uses "apps/backend/..." → needs root context
if grep -q "COPY apps/backend" apps/backend/Containerfile; then
    pass "Backend uses repo-root COPY paths → needs 'context: .'"
else
    fail "Backend COPY paths unclear — verify context"
fi

# Frontend Containerfile uses "./package.json" → needs apps/frontend context
if grep -q "COPY package.json" apps/frontend/Containerfile; then
    pass "Frontend uses relative COPY paths → needs 'context: ./apps/frontend'"
else
    fail "Frontend COPY paths unclear — verify context"
fi

# ── 3. docker-compose.yml context matches ─────────────────
echo -e "${CYAN}[3]${NC} docker-compose.yml context alignment..."
if grep -A6 'frontend:' docker-compose.yml | grep -q 'context: ./apps/frontend'; then
    pass "Frontend context is ./apps/frontend ✓"
else
    fail "Frontend context MISMATCH"
fi
if grep -A6 'backend:' docker-compose.yml | grep -q 'context: \.'; then
    pass "Backend context is repo root ✓"
else
    fail "Backend context MISMATCH"
fi

# ── 4. Target matches stage names ─────────────────────────
echo -e "${CYAN}[4]${NC} Target name validation..."
if grep -A5 'frontend:' docker-compose.yml | grep -q "target: production"; then
    pass "Frontend target 'production' matches Containerfile stage"
else
    fail "Frontend target MISMATCH"
fi

# ── 5. Validate docker/* YAML files parse clean ────────────
echo -e "${CYAN}[5]${NC} docker/ compose files parse..."
for f in docker/*.yml; do
    # Fix paths: docker/ env_file are relative to the compose file dir
    sed 's|env_file:\n      - \./apps/|env_file:\n      - ../apps/|' "$f" > /tmp/test-docker-$$.yml 2>/dev/null || cp "$f" /tmp/test-docker-$$.yml
    if python3 -c "import yaml; yaml.safe_load(open('/tmp/test-docker-$$.yml'))" 2>/dev/null; then
        pass "$f (YAML valid)"
    else
        fail "$f (YAML INVALID)"
    fi
done

# ── 6. Quick COPY-path dry-run (does container paths exist in repo?) ──
echo -e "${CYAN}[6]${NC} COPY source paths exist on disk..."

BACKEND_FILES=(
    "apps/backend/pyproject.toml"
    "apps/backend/poetry.lock"
    "apps/backend/entrypoint.sh"
    "apps/backend/celery_entrypoint.sh"
)
for src in "${BACKEND_FILES[@]}"; do
    if [ -f "$src" ] || [ -d "$src" ]; then
        pass "Backend COPY source: $src"
    else
        fail "Backend COPY source MISSING: $src"
    fi
done

FRONTEND_FILES=(
    "apps/frontend/package.json"
    "apps/frontend/package-lock.json"
    "apps/frontend/public"
    "apps/frontend/next.config.ts"
)
for src in "${FRONTEND_FILES[@]}"; do
    if [ -f "$src" ] || [ -d "$src" ]; then
        pass "Frontend COPY source: $src"
    else
        fail "Frontend COPY source MISSING: $src"
    fi
done

# ── 7. npm / poetry lock files in sync ─────────────────────
echo -e "${CYAN}[7]${NC} Lock file freshness..."
if [ apps/frontend/package-lock.json -nt apps/frontend/package.json ] 2>/dev/null; then
    pass "package-lock.json is newer than package.json"
else
    fail "package-lock.json may be stale vs package.json"
fi
if [ apps/backend/poetry.lock -nt apps/backend/pyproject.toml ] 2>/dev/null; then
    pass "poetry.lock is newer than pyproject.toml"
else
    fail "poetry.lock may be stale vs pyproject.toml"
fi

# ── Summary ───────────────────────────────────────────────
rm -f /tmp/test-docker-$$.yml
echo ""
echo "═══════════════════════════════════════════════"
echo -e "  Results: ${GREEN}${PASS} passed${NC} ${RED}${FAIL} failed${NC}"
echo "═══════════════════════════════════════════════"
echo ""
echo "  For full builds:  docker compose build"
echo ""
