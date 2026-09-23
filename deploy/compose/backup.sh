#!/usr/bin/env bash
# Back up everything a restore needs, while the stack keeps running.
#
#   ./backup.sh                  into ./backups/<UTC timestamp>/
#   ./backup.sh /mnt/nas/cs      into another directory
#
# Each backup holds:
#   mongo.archive.gz   both databases (platform and intelligence), consistent
#                      as of one moment (--oplog: it is a replica set)
#   files/             every uploaded and generated document, from MinIO
#   env                this install's .env: secrets, signing certificate
#   MANIFEST           what was backed up, from which version
#
# Keeps the newest CS_BACKUP_KEEP backups (default 7) in the target directory.
# Copy them off this machine: a backup on the same disk is not a backup.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_docker
[ -f "$CS_ENV" ] || die "No .env here; nothing is installed."

root="${1:-$CS_DIR/backups}"
keep="${CS_BACKUP_KEEP:-7}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dest="$root/$stamp"
mkdir -p "$dest"
chmod 700 "$root" "$dest"

say "Backing up to $dest"

dc exec -T mongo mongodump --quiet --oplog --archive --gzip > "$dest/mongo.archive.gz" \
  || die "mongodump failed."
[ -s "$dest/mongo.archive.gz" ] || die "mongodump produced an empty archive."
ok "Databases ($(du -h "$dest/mongo.archive.gz" | cut -f1))"

bucket="$(env_get S3_BUCKET)"; bucket="${bucket:-clm-documents}"
mkdir -p "$dest/files"
dc run --rm --no-deps -T -v "$dest/files:/backup" --entrypoint sh minio-init -c '
  mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null &&
  mc mirror --quiet --overwrite "local/'"$bucket"'" /backup
' || die "Copying documents out of MinIO failed."
ok "Documents ($(find "$dest/files" -type f | wc -l | tr -d ' ') files, $(du -sh "$dest/files" | cut -f1))"

cp "$CS_ENV" "$dest/env"
chmod 600 "$dest/env"
ok "Configuration and secrets"

{
  echo "created=$stamp"
  echo "version=$(env_get CS_VERSION)"
  echo "commit=$(git -C "$CS_REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "bucket=$bucket"
} > "$dest/MANIFEST"

# Retention: the newest $keep stay. Names are UTC timestamps, so they sort by age.
total="$(find "$root" -mindepth 1 -maxdepth 1 -type d -name '20*Z' | wc -l | tr -d ' ')"
if [ "$total" -gt "$keep" ]; then
  find "$root" -mindepth 1 -maxdepth 1 -type d -name '20*Z' | sort | head -n "$((total - keep))" \
    | while IFS= read -r d; do rm -rf "$d"; done
  note "Removed $((total - keep)) backup(s) beyond the newest $keep."
fi

say "Done: $dest"
