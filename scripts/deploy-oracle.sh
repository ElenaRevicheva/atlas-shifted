#!/usr/bin/env bash
# Standard Atlas deploy on Oracle VM — run after pushing to GitHub main.
set -euo pipefail
WS=/home/ubuntu/whitespace
cd "$WS"
git pull origin main
npm run build
pm2 restart whitespace
echo "Atlas deployed: $(git rev-parse --short HEAD)"
