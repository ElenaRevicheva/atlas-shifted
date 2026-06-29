#!/usr/bin/env bash
# Copy OUTREACH_SECRET from CTO AIPA .env into whitespace for Atlas performance hub reads.
set -euo pipefail
WS="${1:-/home/ubuntu/whitespace}"
CTO="${2:-/home/ubuntu/cto-aipa}"
SECRET=$(grep -E '^OUTREACH_SECRET=' "$CTO/.env" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)
if [[ -z "$SECRET" ]]; then
  echo "OUTREACH_SECRET not found in $CTO/.env — set ATLAS_PERFORMANCE_SECRET manually"
  exit 1
fi
ENV="$WS/.env"
touch "$ENV"
if grep -q '^ATLAS_PERFORMANCE_SECRET=' "$ENV"; then
  sed -i "s|^ATLAS_PERFORMANCE_SECRET=.*|ATLAS_PERFORMANCE_SECRET=$SECRET|" "$ENV"
else
  echo "ATLAS_PERFORMANCE_SECRET=$SECRET" >> "$ENV"
fi
if ! grep -q '^ATLAS_PERFORMANCE_HUB_URL=' "$ENV"; then
  echo 'ATLAS_PERFORMANCE_HUB_URL=https://webhook.aideazz.xyz/cto/api/atlas-performance' >> "$ENV"
fi
echo "Atlas performance hub wired in $ENV"
