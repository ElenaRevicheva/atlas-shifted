#!/usr/bin/env bash
# Full Atlas deploy on Oracle — git pull, deps, build, wire env, refresh brief, restart PM2.
set -euo pipefail
WS=/home/ubuntu/whitespace
cd "$WS"
git pull origin main
npm install
npm run build
bash scripts/wire-telegram-env.sh
bash scripts/wire-brightdata-env.sh
node dist/brief.js
pm2 restart whitespace --update-env
echo "Atlas deployed: $(git rev-parse --short HEAD)"
curl -sf http://127.0.0.1:8095/healthz | head -c 300
echo ""
bash scripts/contest-verify.sh "$WS" || true
