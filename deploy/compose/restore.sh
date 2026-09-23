#!/usr/bin/env bash
# Restore a backup made by backup.sh. This REPLACES the current data.
#
#   ./restore.sh backups/20260923T020000Z
#   ./restore.sh backups/20260923T020000Z --with-env   also restore .env
#
# Use --with-env on a new machine, or when the secrets changed since the
# backup: stored model keys and sealed PDFs depend on the backup's secrets.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

src="${1:-}"; with_env=0
[ "${2:-}" = "--with-env" ] && with_env=1
[ -n "$src" ] && [ -f "$src/mongo.archive.gz" ] || die "Usage: ./restore.sh <backup directory> [--with-env]"
src="$(cd "$src" && pwd)"
require_docker

if [ "$with_env" -eq 1 ]; then
  [ -f "$src/env" ] || die "$src has no env file."
  cp "$src/env" "$CS_ENV"; chmod 600 "$CS_ENV"
  ok "Restored .env from the backup"
fi
[ -f "$CS_ENV" ] || die "No .env here. Run with --with-env, or ./install.sh first."

cat "$src/MANIFEST" 2>/dev/null | sed 's/^/    /'
printf '%s' "${C_YELLOW}This replaces ALL current contracts, users and documents with the backup. Type 'restore' to continue: ${C_OFF}"
read -r answer
[ "$answer" = "restore" ] || die "Cancelled."

say "Stopping the application (databases stay up)"
dc stop edge web api jobs intelligence worker >/dev/null 2>&1 || true
dc up -d mongo minio redis
wait_for_mongo() {
  local i=0
  until dc exec -T mongo mongosh --quiet --eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true; do
    i=$((i + 1)); [ "$i" -ge 60 ] && die "MongoDB did not become primary."; sleep 2
  done
}
wait_for_mongo

say "Restoring databases"
dc exec -T mongo mongorestore --quiet --drop --oplogReplay --archive --gzip < "$src/mongo.archive.gz" \
  || die "mongorestore failed; the application is stopped. Fix the cause and run this again."
ok "Databases"

bucket="$(grep '^bucket=' "$src/MANIFEST" 2>/dev/null | cut -d= -f2)"; bucket="${bucket:-$(env_get S3_BUCKET)}"; bucket="${bucket:-clm-documents}"
say "Restoring documents"
dc run --rm -T -v "$src/files:/backup:ro" --entrypoint sh minio-init -c '
  mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null &&
  mc mb --ignore-existing "local/'"$bucket"'" >/dev/null &&
  mc mirror --quiet --overwrite --remove /backup "local/'"$bucket"'"
' || die "Restoring documents failed; the application is stopped."
ok "Documents"

say "Starting"
dc up -d
wait_healthy 600 || die "Restored, but the stack is not healthy. See 'docker compose logs'."
say "Restore complete."
