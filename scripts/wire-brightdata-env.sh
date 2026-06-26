#!/usr/bin/env bash
# Wire Bright Data + Meta fetch tuning into whitespace/.env from fleet defaults.
set -euo pipefail
WS=/home/ubuntu/whitespace
CTO=/home/ubuntu/cto-aipa/.env
ENV=$WS/.env
touch "$ENV"

copy_if_missing() {
  local key=$1
  if grep -q "^${key}=" "$ENV" 2>/dev/null; then return; fi
  if grep -q "^${key}=" "$CTO" 2>/dev/null; then
    grep "^${key}=" "$CTO" | head -1 >> "$ENV"
    echo "wired $key from cto-aipa .env"
  fi
}

copy_if_missing BRIGHTDATA_API_TOKEN
copy_if_missing BRIGHTDATA_ZONE
copy_if_missing BRIGHTDATA_BROWSER_AUTH
copy_if_missing META_AD_LIBRARY_ACCESS_TOKEN

# Sensible Meta capture defaults (safe to append once)
ensure_default() {
  local key=$1 val=$2
  grep -q "^${key}=" "$ENV" 2>/dev/null || echo "${key}=${val}" >> "$ENV"
}
ensure_default WHITESPACE_META_FETCH_TIMEOUT_MS 90000
ensure_default WHITESPACE_META_FETCH_RETRIES 3
ensure_default WHITESPACE_META_FETCH_PAUSE_MS 4000
ensure_default WHITESPACE_META_VERTICAL_PAUSE_MS 5000

if ! grep -q '^BRIGHTDATA_BROWSER_AUTH=' "$ENV" 2>/dev/null; then
  echo "NOTE: BRIGHTDATA_BROWSER_AUTH not set — Meta uses Web Unlocker render (works, but add Scraping Browser zone for contest-grade reliability)"
  echo "      See _internal-docs/BRIGHTDATA_BROWSER_SETUP.md (local ops)"
fi
