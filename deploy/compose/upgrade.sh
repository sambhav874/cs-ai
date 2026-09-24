#!/usr/bin/env bash
# Upgrade this install, with a backup first and a way back.
#
#   ./upgrade.sh                 update this checkout (git pull --ff-only) and rebuild
#   ./upgrade.sh --ref v1.4.0    check out a tag, branch or commit and rebuild
#   ./upgrade.sh --pull 1.4.0    use published images of that version instead
#   ./upgrade.sh --no-backup     skip the backup (not recommended)
#
# Steps: back up → keep the running images as :previous → fetch the new
# version → start it (the schema update runs before the API) → wait for
# health. If it does not come up healthy, the previous images are started
# again. Data is not rolled back automatically: the schema update only adds
# fields and indexes, so the previous version runs on it. The pre-upgrade
# backup is there if a restore is ever needed (./restore.sh).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ref=''; pull_version=''; backup=1
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) ref="${2:-}"; shift 2 ;;
    --pull) pull_version="${2:-}"; shift 2 ;;
    --no-backup) backup=0; shift ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

require_docker
[ -f "$CS_ENV" ] || die "Nothing is installed here. Run ./install.sh first."

prefix="$(env_get CS_IMAGE_PREFIX)"; prefix="${prefix:-contractsense}"
current="$(env_get CS_VERSION)"; current="${current:-local}"
images=(api intelligence web)
# How long the new version gets to become healthy before rolling back.
health_timeout="${CS_UPGRADE_HEALTH_TIMEOUT:-600}"

# Refuse before touching anything: a checkout with local edits would be
# silently mixed into the new build, or lost by the checkout.
if [ -z "$pull_version" ]; then
  command -v git >/dev/null || die "git is needed to update the checkout (or use --pull)."
  [ -z "$(git -C "$CS_REPO" status --porcelain --untracked-files=no)" ] \
    || die "The checkout at $CS_REPO has local changes. Commit or stash them first."
fi

if [ "$backup" -eq 1 ]; then
  "$CS_DIR/backup.sh" || die "Backup failed; not upgrading."
fi

# Secrets a newer version needs that an older install never generated.
# MONGOT_PASSWORD: the user MongoDB's search process syncs as (MongoDB 8.3).
if [ -z "$(env_get MONGOT_PASSWORD)" ]; then
  env_set MONGOT_PASSWORD "$(openssl rand -hex 32)"
  note "Added MONGOT_PASSWORD to .env (MongoDB search)."
fi

say "Keeping the running version ($current) as :previous"
for img in "${images[@]}"; do
  docker image inspect "$prefix/$img:$current" >/dev/null 2>&1 \
    && docker tag "$prefix/$img:$current" "$prefix/$img:previous"
done

rollback() {
  warn "Upgrade failed. Starting the previous version again."
  for img in "${images[@]}"; do
    docker image inspect "$prefix/$img:previous" >/dev/null 2>&1 \
      && docker tag "$prefix/$img:previous" "$prefix/$img:$current"
  done
  env_set CS_VERSION "$current"
  # Back to the branch (or commit) the checkout was on, not a detached HEAD.
  if [ -n "${old_ref:-}" ]; then git -C "$CS_REPO" checkout --quiet "$old_ref" || true; fi
  dc up -d --remove-orphans
  if wait_healthy 600; then
    die "Rolled back to the previous version; it is running. Logs of the failed attempt: 'docker compose logs'."
  fi
  die "Rolled back, but the previous version is not healthy either. Restore the backup taken just now with ./restore.sh."
}

if [ -n "$pull_version" ]; then
  say "Pulling $prefix/*:$pull_version"
  env_set CS_VERSION "$pull_version"
  dc pull api intelligence web || rollback
else
  old_commit="$(git -C "$CS_REPO" rev-parse HEAD)"
  old_ref="$(git -C "$CS_REPO" symbolic-ref -q --short HEAD || echo "$old_commit")"
  say "Updating the checkout"
  git -C "$CS_REPO" fetch --quiet --tags || warn "Could not fetch; using what this checkout already has."
  if [ -n "$ref" ]; then git -C "$CS_REPO" checkout --quiet "$ref"; else git -C "$CS_REPO" pull --quiet --ff-only; fi
  new_commit="$(git -C "$CS_REPO" rev-parse HEAD)"
  if [ "$new_commit" = "$old_commit" ]; then
    note "Already at $(git -C "$CS_REPO" rev-parse --short HEAD); rebuilding anyway."
  else
    note "$(git -C "$CS_REPO" rev-parse --short "$old_commit") → $(git -C "$CS_REPO" rev-parse --short "$new_commit")"
  fi
  say "Building"
  dc build || rollback
fi

say "Starting the new version"
dc up -d --remove-orphans || rollback
wait_healthy "$health_timeout" && check_oneshots || rollback

say "Upgraded. Running $(env_get CS_VERSION)$([ -n "${new_commit:-}" ] && echo " at $(git -C "$CS_REPO" rev-parse --short HEAD)")."
note "The previous images stay tagged :previous until the next upgrade."
