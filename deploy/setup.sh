#!/bin/bash
# ────────────────────────────────────────────────────────────────────────────
# Flurry Systems — EC2 setup script (Ubuntu 22.04 / 24.04)
# Run once on a fresh instance:  bash setup.sh
# ────────────────────────────────────────────────────────────────────────────
set -e

DOMAIN="${1:-flurrysystems.com}"
APP_DIR="/var/www/flurry"
LOG_DIR="/var/log/flurry"

echo ""
echo "  Setting up Flurry Systems for domain: $DOMAIN"
echo ""

# ── 1. System updates ────────────────────────────────────────────────────────
sudo apt-get update -y
sudo apt-get upgrade -y

# ── 2. Node.js 20 LTS ────────────────────────────────────────────────────────
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "  Node $(node -v) / npm $(npm -v) installed"

# ── 3. Nginx ──────────────────────────────────────────────────────────────────
sudo apt-get install -y nginx

# ── 4. PM2 ───────────────────────────────────────────────────────────────────
sudo npm install -g pm2

# ── 5. Certbot (Let's Encrypt SSL) ───────────────────────────────────────────
sudo apt-get install -y certbot python3-certbot-nginx

# ── 6. App directory & logs ───────────────────────────────────────────────────
sudo mkdir -p "$APP_DIR"
sudo mkdir -p "$LOG_DIR"
sudo chown -R ubuntu:ubuntu "$APP_DIR"
sudo chown -R ubuntu:ubuntu "$LOG_DIR"

# ── 7. Clone repo ────────────────────────────────────────────────────────────
git clone https://github.com/krystleM26/flurrysystems.git "$APP_DIR"
cd "$APP_DIR"
npm install --omit=dev

# ── 8. Create .env (fill in real values after setup) ─────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" <<ENV
NODE_ENV=production
PORT=3000
ADMIN_PASSWORD=CHANGE_ME
SESSION_SECRET=CHANGE_ME_TO_A_LONG_RANDOM_STRING
ENV
  echo "  ⚠️  Created $APP_DIR/.env — edit it with your real values before starting."
fi

# ── 9. Nginx config ───────────────────────────────────────────────────────────
sudo tee /etc/nginx/sites-available/flurry > /dev/null <<NGINX
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    # Block direct access to admin .env and private files
    location ~ /\.(env|git|pem|key) {
        deny all;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/flurry /etc/nginx/sites-enabled/flurry
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "  Nginx configured for $DOMAIN"

# ── 10. Start app with PM2 ───────────────────────────────────────────────────
cd "$APP_DIR"
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup | tail -1 | sudo bash   # auto-start on reboot

echo ""
echo "  ✓ Setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Edit $APP_DIR/.env with your real ADMIN_PASSWORD and SESSION_SECRET"
echo "  2. Run: pm2 restart flurry-systems"
echo "  3. Point your GoDaddy domain A record → this server's IP"
echo "  4. Then run: sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN"
echo ""
