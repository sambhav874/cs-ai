#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# ContractSense — Ubuntu VM One-Run Setup
# ─────────────────────────────────────────────────────────────
# Usage:
#   chmod +x setup_ubuntu.sh
#   sudo ./setup_ubuntu.sh
#
# Flags:
#   --with-nginx         Deploy nginx reverse-proxy on port 80/443
#   --with-ssl           Provision Let's Encrypt SSL certs (requires --with-nginx)
#   --domain <domain>    Domain name for nginx / SSL (e.g. app.contractsense.com)
#   --email <email>      Email for Let's Encrypt notifications
#   --branch <branch>    Git branch to clone (default: main)
#   --skip-clone         Skip repo clone (assumes repo is already in /opt/extractor)
#   --skip-docker        Skip Docker install if already present
#   --skip-firewall      Skip UFW firewall configuration
#   --help               Show this help message
# ─────────────────────────────────────────────────────────────

REPO_URL="https://github.com/sambhav874/contractsense.git"
INSTALL_DIR="/opt/contractsense"
BRANCH="dev"
WITH_NGINX=false
WITH_SSL=false
DOMAIN=""
EMAIL=""
SKIP_CLONE=false
SKIP_DOCKER=false
SKIP_FIREWALL=false

usage() {
    sed -n '/^# Usage:/,/^# ---/p' "$0" | sed 's/^# //'
    exit 0
}

for arg in "$@"; do
    case $arg in
        --with-nginx)    WITH_NGINX=true ;;
        --with-ssl)      WITH_SSL=true ;;
        --domain)        shift; DOMAIN="$1" ;;
        --email)         shift; EMAIL="$1" ;;
        --branch)        shift; BRANCH="$1" ;;
        --skip-clone)    SKIP_CLONE=true ;;
        --skip-docker)   SKIP_DOCKER=true ;;
        --skip-firewall) SKIP_FIREWALL=true ;;
        --help)          usage ;;
    esac
    shift 2>/dev/null || true
done

if $WITH_SSL && ! $WITH_NGINX; then
    echo "ERROR: --with-ssl requires --with-nginx"
    exit 1
fi

if $WITH_NGINX && [ -z "$DOMAIN" ]; then
    echo "ERROR: --domain is required when using --with-nginx"
    exit 1
fi

if $WITH_SSL && [ -z "$EMAIL" ]; then
    echo "ERROR: --email is required when using --with-ssl"
    exit 1
fi

if [ "$EUID" -ne 0 ]; then
    echo "ERROR: This script must be run as root (use sudo)."
    exit 1
fi

# ── Color helpers ────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
step()  { echo -e "${GREEN}[+]${NC} $1"; }
info()  { echo -e "${CYAN}[i]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }

# ── Log summary of chosen options ─────────────────────────────
echo ""
echo "═══════════════════════════════════════════════"
echo "  ContractSense Ubuntu Setup"
echo "═══════════════════════════════════════════════"
echo "  Install dir : $INSTALL_DIR"
echo "  Branch      : $BRANCH"
echo "  Nginx       : $WITH_NGINX"
echo "  SSL         : $WITH_SSL"
echo "  Domain      : ${DOMAIN:-N/A}"
echo "  Email       : ${EMAIL:-N/A}"
echo "═══════════════════════════════════════════════"
echo ""
read -rp "Proceed? [Y/n] " CONFIRM
CONFIRM=${CONFIRM:-Y}
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# ══════════════════════════════════════════════════════════════
# 1. System packages
# ══════════════════════════════════════════════════════════════
step "Updating package index and installing system dependencies..."
apt-get update -qq
apt-get install -y -qq \
    curl \
    git \
    build-essential \
    software-properties-common \
    ca-certificates \
    gnupg \
    lsb-release \
    ufw

# ══════════════════════════════════════════════════════════════
# 2. Docker + Docker Compose
# ══════════════════════════════════════════════════════════════
if $SKIP_DOCKER; then
    info "Skipping Docker installation."
else
    step "Installing Docker Engine..."
    install -m 0755 -d /etc/apt/keyrings
    if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
            | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    fi
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
      https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq \
        docker-ce \
        docker-ce-cli \
        containerd.io \
        docker-buildx-plugin \
        docker-compose-plugin

    systemctl enable docker --now
    info "Docker $(docker --version) installed."
fi

# ══════════════════════════════════════════════════════════════
# 3. Git clone
# ══════════════════════════════════════════════════════════════
if $SKIP_CLONE; then
    info "Skipping repo clone. Using existing directory: $INSTALL_DIR"
else
    step "Cloning repository (branch: $BRANCH)..."
    if [ -d "$INSTALL_DIR" ]; then
        warn "$INSTALL_DIR already exists — pulling latest instead."
        git -C "$INSTALL_DIR" fetch origin
        git -C "$INSTALL_DIR" checkout "$BRANCH"
        git -C "$INSTALL_DIR" pull origin "$BRANCH"
    else
        git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    fi
fi

cd "$INSTALL_DIR"

# ══════════════════════════════════════════════════════════════
# 4. Shared directory
# ══════════════════════════════════════════════════════════════
step "Creating shared directory..."
mkdir -p shared
chmod -R 755 shared

# ══════════════════════════════════════════════════════════════
# 5. Environment files
# ══════════════════════════════════════════════════════════════
step "Setting up environment files..."
if [ ! -f apps/backend/.env ]; then
    if [ -f apps/backend/.env.template ]; then
        cp apps/backend/.env.template apps/backend/.env
        info "Created apps/backend/.env from template — EDIT THIS FILE before starting."
    else
        warn "No apps/backend/.env.template found. Create apps/backend/.env manually."
    fi
else
    info "apps/backend/.env already exists — skipping."
fi

if [ ! -f apps/frontend/.env ]; then
    if [ -f apps/frontend/.env.example ]; then
        cp apps/frontend/.env.example apps/frontend/.env
        info "Created apps/frontend/.env from example — EDIT THIS FILE before starting."
    else
        warn "No apps/frontend/.env.example found. Create apps/frontend/.env manually."
    fi
else
    info "apps/frontend/.env already exists — skipping."
fi

# ══════════════════════════════════════════════════════════════
# 6. Firewall
# ══════════════════════════════════════════════════════════════
if $SKIP_FIREWALL; then
    info "Skipping firewall configuration."
else
    step "Configuring UFW firewall..."
    ufw --force reset > /dev/null
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow OpenSSH
    ufw allow 5672/tcp comment 'RabbitMQ'
    ufw allow 15672/tcp comment 'RabbitMQ management'
    if $WITH_NGINX; then
        ufw allow 80/tcp
        ufw allow 443/tcp
    else
        ufw allow 4200/tcp comment 'ContractSense frontend'
        ufw allow 8000/tcp comment 'ContractSense backend API'
    fi
    ufw --force enable
    info "UFW enabled. Allowed ports: $(ufw status numbered | grep 'ALLOW' | awk '{print $3}' | tr '\n' ' ')"
fi

# ══════════════════════════════════════════════════════════════
# 7. Docker Compose production overrides
# ══════════════════════════════════════════════════════════════
step "Generating docker-compose production override..."
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-4200}"

cat > docker-compose.override.yml <<'DCOVERRIDE'
services:
  backend:
    restart: unless-stopped
  frontend:
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=${FRONTEND_PORT:-4200}
DCOVERRIDE

# ══════════════════════════════════════════════════════════════
# 8. Build and start Docker containers
# ══════════════════════════════════════════════════════════════
step "Building Docker images..."
docker compose build --pull

step "Starting services..."
docker compose up -d

# ══════════════════════════════════════════════════════════════
# 9. Nginx reverse proxy (optional)
# ══════════════════════════════════════════════════════════════
if $WITH_NGINX; then
    step "Installing and configuring Nginx as reverse proxy..."

    apt-get install -y -qq nginx

    cat > /etc/nginx/sites-available/contractsense <<NGINXCONF
# ContractSense reverse proxy
# Frontend → port 4200, Backend API → port 8000

upstream contractsense_frontend {
    server 127.0.0.1:${FRONTEND_PORT};
}

upstream contractsense_backend {
    server 127.0.0.1:${BACKEND_PORT};
}

server {
    listen 80;
    server_name ${DOMAIN};

    # Increase upload size for PDF contracts
    client_max_body_size 100M;

    # Backend API
    location /api/ {
        proxy_pass http://contractsense_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # Backend WebSocket
    location /ws/ {
        proxy_pass http://contractsense_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 86400s;
    }

    # Frontend (everything else)
    location / {
        proxy_pass http://contractsense_frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }
}
NGINXCONF

    ln -sf /etc/nginx/sites-available/contractsense /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default

    nginx -t && systemctl reload nginx
    systemctl enable nginx --now
    info "Nginx configured. Frontend → ${DOMAIN}, API → ${DOMAIN}/api/"

    # ═══════════════════════════════════════════════════════════
    # 10. Let's Encrypt SSL (optional)
    # ═══════════════════════════════════════════════════════════
    if $WITH_SSL; then
        step "Provisioning Let's Encrypt SSL certificate via Certbot..."

        apt-get install -y -qq certbot python3-certbot-nginx

        certbot --nginx \
            --non-interactive \
            --agree-tos \
            -m "$EMAIL" \
            -d "$DOMAIN" \
            --redirect

        # Add renewal cron job
        echo "0 3 * * * root certbot renew --quiet --deploy-hook 'systemctl reload nginx'" \
            > /etc/cron.d/certbot-renewal

        systemctl reload nginx
        info "SSL enabled. https://${DOMAIN} is now live."
    fi
fi

# ══════════════════════════════════════════════════════════════
# 11. Add current user to docker group
# ══════════════════════════════════════════════════════════════
REAL_USER="${SUDO_USER:-$USER}"
if [ -n "$REAL_USER" ] && [ "$REAL_USER" != "root" ]; then
    usermod -aG docker "$REAL_USER" 2>/dev/null || true
    info "Added $REAL_USER to docker group (re-login required to take effect)."
fi

# ══════════════════════════════════════════════════════════════
# Done
# ══════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════"
echo -e "  ${GREEN}Setup complete!${NC}"
echo "═══════════════════════════════════════════════"
echo "  Project dir : $INSTALL_DIR"
echo "  4 containers: frontend, backend, worker, rabbitmq"
echo "  Frontend    : http://localhost:${FRONTEND_PORT}"
echo "  Backend API : http://localhost:${BACKEND_PORT}"
echo "  RabbitMQ    : http://localhost:15672   (management UI)"
echo "  Worker      : Celery (behind backend-net, internal)"
if $WITH_NGINX; then
    echo "  Nginx       : http://${DOMAIN}"
fi
if $WITH_SSL; then
    echo "  SSL         : https://${DOMAIN}"
fi
echo ""
echo "  Status:  docker compose ps"
echo "  Logs:    docker compose logs -f [frontend|backend|worker|rabbitmq]"
echo "  Restart: docker compose restart [service]"
echo ""
echo "  IMPORTANT: Edit .env files before first production use!"
echo "    • apps/backend/.env"
echo "    • apps/frontend/.env"
echo "═══════════════════════════════════════════════"
