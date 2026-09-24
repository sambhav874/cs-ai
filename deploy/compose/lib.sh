#!/usr/bin/env bash
# Shared by install.sh, upgrade.sh, backup.sh and restore.sh. Sourced, not run.

set -euo pipefail

CS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CS_ENV="$CS_DIR/.env"
CS_REPO="$(cd "$CS_DIR/../.." && pwd)"

if [ -t 1 ]; then
  C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_OFF=$'\033[0m'
else
  C_BOLD=''; C_DIM=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_OFF=''
fi

say()  { printf '%s\n' "${C_BOLD}==>${C_OFF} $*"; }
note() { printf '%s\n' "    ${C_DIM}$*${C_OFF}"; }
ok()   { printf '%s\n' "    ${C_GREEN}✓${C_OFF} $*"; }
warn() { printf '%s\n' "    ${C_YELLOW}!${C_OFF} $*" >&2; }
die()  { printf '%s\n' "${C_RED}error:${C_OFF} $*" >&2; exit 1; }

# docker compose, always against this directory's file and .env.
dc() { docker compose --project-directory "$CS_DIR" -f "$CS_DIR/docker-compose.yml" "$@"; }

require_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed. Install Docker Engine 24+ first: https://docs.docker.com/engine/install/"
  docker info >/dev/null 2>&1 || die "Docker is installed but not running, or this user cannot reach it (try sudo, or add yourself to the docker group)."
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing (the 'docker compose' plugin)."
}

# Read one key from .env without sourcing the whole file into the shell.
env_get() {
  [ -f "$CS_ENV" ] || return 0
  grep -E "^$1=" "$CS_ENV" | tail -1 | cut -d= -f2- || true
}

# Set or replace one key in .env.
env_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp "$CS_DIR/.env.XXXXXX")"
  if [ -f "$CS_ENV" ]; then grep -vE "^$key=" "$CS_ENV" > "$tmp" || true; fi
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$CS_ENV"
}

# Wait until every long-running service with a health check reports healthy.
wait_healthy() {
  local timeout="${1:-600}" waited=0 svc state pending
  local services=(api intelligence web)
  # Local MongoDB only runs under the local-mongo profile; with Atlas it is absent.
  if [ -n "$(dc ps -q mongo 2>/dev/null)" ]; then services=(mongo mongot "${services[@]}"); fi
  while :; do
    pending=()
    for svc in "${services[@]}"; do
      state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
        "$(dc ps -q "$svc" 2>/dev/null | head -1)" 2>/dev/null || echo missing)"
      [ "$state" = "healthy" ] || pending+=("$svc:$state")
    done
    [ ${#pending[@]} -eq 0 ] && return 0
    if [ "$waited" -ge "$timeout" ]; then
      warn "Still not healthy after ${timeout}s: ${pending[*]}"
      return 1
    fi
    sleep 5; waited=$((waited + 5))
  done
}

# The one-shot setup containers must have exited 0.
check_oneshots() {
  local svc code
  for svc in migrate minio-init; do
    code="$(docker inspect --format '{{.State.ExitCode}}' "$(dc ps -aq "$svc" | head -1)" 2>/dev/null || echo '?')"
    [ "$code" = "0" ] || { warn "$svc exited with $code:"; dc logs --tail 30 "$svc" >&2 || true; return 1; }
  done
}
