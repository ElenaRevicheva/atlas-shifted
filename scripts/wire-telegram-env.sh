#!/usr/bin/env bash
# Copy fleet Telegram vars into whitespace/.env if missing (send-only daily brief).
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
copy_if_missing TELEGRAM_BOT_TOKEN
copy_if_missing TELEGRAM_LEADS_DIGEST_CHAT_ID
copy_if_missing TELEGRAM_DAILY_BLOG_NOTIFY_CHAT_ID
# Elena personal chat fallback (Sprint Briefing user id)
if ! grep -q '^ATLAS_TELEGRAM_CHAT_ID=' "$ENV" 2>/dev/null; then
  if ! grep -q '^TELEGRAM_LEADS_DIGEST_CHAT_ID=' "$ENV" 2>/dev/null; then
    echo 'ATLAS_TELEGRAM_CHAT_ID=5481526862' >> "$ENV"
    echo 'wired ATLAS_TELEGRAM_CHAT_ID default'
  fi
fi
