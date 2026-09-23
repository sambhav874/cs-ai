#!/usr/bin/env bash
# Install ContractSense on this machine.
#
#   ./install.sh                                  asks for what it needs
#   ./install.sh --domain contracts.acme.com      HTTPS with a Let's Encrypt certificate
#   ./install.sh --http-only --http-port 8080     plain HTTP, e.g. a trial on a laptop
#
# Writes .env next to this script (secrets included, mode 600), builds the
# images, creates a signing certificate for executed PDFs, starts the stack
# and waits for it to be healthy. It does not create any account: the first
# person to open the site signs up and becomes the admin.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DOMAIN=''; HTTP_ONLY=0; HTTP_PORT=''; HTTPS_PORT=''; PULL=0; YES=0; ORG_NAME=''

usage() {
  sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

Options:
  --domain NAME       Public hostname. Its DNS must point at this machine, and
                      ports 80 and 443 must be reachable for the certificate.
  --http-only         No TLS. Serve plain HTTP on --http-port (default 80).
  --http-port N       Host port for HTTP (default 80).
  --https-port N      Host port for HTTPS (default 443).
  --org NAME          Name shown on the signing certificate (default: the domain).
  --pull              Pull published images instead of building from this checkout.
  -y, --yes           Do not ask; fail if something required is missing.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --http-only) HTTP_ONLY=1; shift ;;
    --http-port) HTTP_PORT="${2:-}"; shift 2 ;;
    --https-port) HTTPS_PORT="${2:-}"; shift 2 ;;
    --org) ORG_NAME="${2:-}"; shift 2 ;;
    --pull) PULL=1; shift ;;
    -y|--yes) YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
done

say "Checking this machine"
require_docker
command -v openssl >/dev/null 2>&1 || die "openssl is needed to generate secrets."
ok "Docker $(docker version --format '{{.Server.Version}}'), $(docker compose version --short)"

if [ -f "$CS_ENV" ] && [ -n "$(env_get JWT_SECRET)" ]; then
  die "Already installed ($CS_ENV exists). Use ./upgrade.sh to update. To start over, run 'docker compose down -v' here and delete .env — that erases all data."
fi

mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
if [ "$mem_kb" -gt 0 ] && [ "$mem_kb" -lt 3800000 ]; then
  warn "This machine has $((mem_kb / 1024)) MiB of RAM. 4 GiB is the minimum; the stack idles around 1.1 GiB and parsing needs headroom."
fi

# ── Where it will be served ──────────────────────────────────────────────────
if [ -z "$DOMAIN" ] && [ "$HTTP_ONLY" -eq 0 ]; then
  [ "$YES" -eq 1 ] && die "--domain or --http-only is required with --yes."
  printf 'Public hostname (e.g. contracts.acme.com), or leave empty for plain HTTP: '
  read -r DOMAIN
  [ -z "$DOMAIN" ] && HTTP_ONLY=1
fi

if [ "$HTTP_ONLY" -eq 1 ]; then
  HTTP_PORT="${HTTP_PORT:-80}"
  SITE_ADDRESS='http://:80'
  host="${DOMAIN:-localhost}"
  PUBLIC_URL="http://$host$([ "$HTTP_PORT" = 80 ] || echo ":$HTTP_PORT")"
  warn "Plain HTTP: logins and documents cross the network unencrypted. Use it only on a trusted network or behind your own TLS proxy."
else
  [[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$ ]] || die "'$DOMAIN' is not a hostname. Use --http-only for an IP address or localhost."
  HTTP_PORT="${HTTP_PORT:-80}"; HTTPS_PORT="${HTTPS_PORT:-443}"
  SITE_ADDRESS="$DOMAIN"
  PUBLIC_URL="https://$DOMAIN$([ "$HTTPS_PORT" = 443 ] || echo ":$HTTPS_PORT")"
  if [ "$HTTP_PORT" != 80 ] || [ "$HTTPS_PORT" != 443 ]; then
    warn "Let's Encrypt validates on ports 80/443. With other ports, put your own TLS proxy in front."
  fi
fi
HTTPS_PORT="${HTTPS_PORT:-443}"
ORG_NAME="${ORG_NAME:-${DOMAIN:-ContractSense}}"

for port in "$HTTP_PORT" $([ "$HTTP_ONLY" -eq 1 ] || echo "$HTTPS_PORT"); do
  if (command -v ss >/dev/null && ss -ltn "sport = :$port" | grep -q LISTEN) \
     || (command -v lsof >/dev/null && lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1); then
    die "Port $port is already in use. Free it, or pass --http-port/--https-port."
  fi
done
ok "Serving at $PUBLIC_URL"

# ── Secrets ──────────────────────────────────────────────────────────────────
say "Generating secrets"
hex() { openssl rand -hex 32; }
{
  echo "# Written by install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Keep this file private and backed up:"
  echo "# losing AI_KEY_ENCRYPTION_KEY makes stored model keys unreadable, and"
  echo "# the signing certificate is what executed PDFs are sealed with."
  echo "CS_VERSION=${CS_VERSION:-local}"
  echo "CS_IMAGE_PREFIX=${CS_IMAGE_PREFIX:-contractsense}"
  echo "CS_PUBLIC_URL=$PUBLIC_URL"
  echo "CS_SITE_ADDRESS=$SITE_ADDRESS"
  echo "CS_HTTP_PORT=$HTTP_PORT"
  echo "CS_HTTPS_PORT=$HTTPS_PORT"
  echo "JWT_SECRET=$(hex)"
  echo "PORTAL_JWT_SECRET=$(hex)"
  echo "INTERNAL_SERVICE_SECRET=$(hex)"
  echo "INTEL_SECRET_KEY=$(hex)"
  echo "AI_KEY_ENCRYPTION_KEY=$(openssl rand -base64 32)"
  echo "S3_ACCESS_KEY=cs$(openssl rand -hex 8)"
  echo "S3_SECRET_KEY=$(hex)"
  echo "REGISTRATION_MODE=first-user"
  echo "# Optional. Without a key AI is off until an admin adds one in Admin → AI."
  echo "ANTHROPIC_API_KEY="
  echo "OPENAI_API_KEY="
  echo "# Optional. Without SMTP nothing is emailed: invites, signing requests and reminders."
  echo "SMTP_HOST="
  echo "SMTP_PORT=587"
  echo "SMTP_USER="
  echo "SMTP_PASS="
  echo "SMTP_FROM=noreply@${DOMAIN:-localhost}"
} > "$CS_ENV.tmp"
chmod 600 "$CS_ENV.tmp"
mv "$CS_ENV.tmp" "$CS_ENV"
ok "Wrote $CS_ENV (mode 600)"

# ── Images ───────────────────────────────────────────────────────────────────
if [ "$PULL" -eq 1 ]; then
  say "Pulling images"
  dc pull
else
  say "Building images from $CS_REPO (10-20 minutes the first time)"
  dc build
fi
ok "Images ready"

# ── Signing certificate ──────────────────────────────────────────────────────
say "Creating the certificate executed PDFs are sealed with"
cert="$(dc run --rm --no-deps -T --entrypoint node api --import tsx --input-type=module -e "
import crypto from 'node:crypto'
import { generateSelfSignedP12 } from './src/lib/signing-cert.ts'
const pass = crypto.randomBytes(24).toString('base64url')
const p12 = generateSelfSignedP12(pass, process.argv[1] + ' Signing Authority', process.argv[1])
console.log('SIGNING_CERT_P12_BASE64=' + p12.toString('base64'))
console.log('SIGNING_CERT_PASSPHRASE=' + pass)
" "$ORG_NAME" 2>/dev/null)" || die "Could not generate the signing certificate."
env_set SIGNING_CERT_P12_BASE64 "$(printf '%s\n' "$cert" | grep '^SIGNING_CERT_P12_BASE64=' | cut -d= -f2-)"
env_set SIGNING_CERT_PASSPHRASE "$(printf '%s\n' "$cert" | grep '^SIGNING_CERT_PASSPHRASE=' | cut -d= -f2-)"
[ -n "$(env_get SIGNING_CERT_P12_BASE64)" ] || die "The signing certificate came back empty."
ok "Self-signed, valid 10 years. Replace it with a CA-issued one to show a trusted signer in PDF readers."

# ── Start ────────────────────────────────────────────────────────────────────
say "Starting"
dc up -d
if ! wait_healthy 600 || ! check_oneshots; then
  dc ps
  die "The stack did not come up. See 'docker compose logs <service>' in $CS_DIR."
fi
ok "All services healthy"

cat <<EOF

${C_BOLD}ContractSense is running at $PUBLIC_URL${C_OFF}

  1. Open it and choose "Set up this instance". The first account becomes the
     admin; after that, people join by invite (Admin → Users).
  2. To turn on AI, add a model key in Admin → AI (or set ANTHROPIC_API_KEY /
     OPENAI_API_KEY in .env and run 'docker compose up -d').
  3. Schedule backups, e.g. nightly:  0 2 * * *  $CS_DIR/backup.sh

Keep $CS_ENV safe and backed up. Upgrades: $CS_DIR/upgrade.sh
EOF
