#!/usr/bin/env bash
# Atlas AIPA daily: capture → classify → brief → concept → backup. Panama 9 AM (14:00 UTC).
# Fail-fast: if classify or brief fails, skip the stages that depend on it (they'd
# otherwise regenerate against yesterday's radar.sqlite/brief and silently mislabel
# stale data as fresh — see 2026-07-12 incident) and Telegram-alert instead.
set -uo pipefail
WS=/home/ubuntu/whitespace
LOG=$WS/data/capture.log
cd "$WS"

BOT_TOKEN=$(grep -m1 -E '^(ATLAS_TELEGRAM_BOT_TOKEN|TELEGRAM_BOT_TOKEN)=' .env | head -1 | cut -d= -f2- | tr -d '\r')
CHAT_ID=$(grep -m1 -E '^(ATLAS_TELEGRAM_CHAT_ID|TELEGRAM_LEADS_DIGEST_CHAT_ID|TELEGRAM_DAILY_BLOG_NOTIFY_CHAT_ID)=' .env | head -1 | cut -d= -f2- | tr -d '\r')

alert() {
  echo "ALERT: $1" >> "$LOG"
  if [[ -n "$BOT_TOKEN" && -n "$CHAT_ID" ]]; then
    curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
      -d chat_id="${CHAT_ID}" \
      -d text="⚠️ Atlas cron: $1" >> "$LOG" 2>&1
  fi
}

echo "=== $(date -u +%FT%TZ) UTC | $(TZ=America/Panama date +%F) Panama : start ===" >> "$LOG"

node dist/capture.js >> "$LOG" 2>&1
if ! node dist/classify.js >> "$LOG" 2>&1; then
  alert "classify.js FAILED — radar.sqlite NOT rebuilt, dashboard still shows the previous day's data. Skipping brief/concept this run."
else
  if ! node dist/brief.js >> "$LOG" 2>&1; then
    alert "brief.js FAILED after a successful classify — brief.json/telegram brief NOT updated. Skipping concept this run."
  else
    node dist/concept.js --all-with-data >> "$LOG" 2>&1 || alert "concept.js FAILED after a successful brief — concepts.json NOT updated for some/all verticals."
  fi
fi

TOKEN=$(grep -m1 '^GITHUB_TOKEN=' /home/ubuntu/cto-aipa/.env | cut -d= -f2- | tr -d '\r')
if [[ -d "$WS/data/.git" ]]; then
  cd "$WS/data"
  git add captures.jsonl capture.log 2>/dev/null || true
  git commit -m "snapshot $(TZ=America/Panama date +%F)" >> "$LOG" 2>&1 || echo "nothing to commit" >> "$LOG"
  git push "https://${TOKEN}@github.com/ElenaRevicheva/atlas-captures.git" HEAD:main >> "$LOG" 2>&1 \
    && echo "backup pushed" >> "$LOG" || echo "backup push FAILED" >> "$LOG"
fi
echo "=== $(date -u +%FT%TZ) : done ===" >> "$LOG"
