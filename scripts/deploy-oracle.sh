#!/usr/bin/env bash
# Full Atlas deploy on Oracle — git pull, build, wire Telegram, refresh brief, restart PM2.
set -euo pipefail
WS=/home/ubuntu/whitespace
cd "$WS"
git pull origin main
npm run build
bash scripts/wire-telegram-env.sh
node dist/brief.js
pm2 restart whitespace --update-env
echo "Atlas deployed: $(git rev-parse --short HEAD)"
curl -sf http://127.0.0.1:8095/healthz | head -c 200
echo ""
