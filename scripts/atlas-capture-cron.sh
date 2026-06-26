#!/usr/bin/env bash
# Atlas AIPA daily: capture → classify → brief → concept → backup. Panama 9 AM (14:00 UTC).
set -uo pipefail
WS=/home/ubuntu/whitespace
LOG=$WS/data/capture.log
echo "=== $(date -u +%FT%TZ) UTC | $(TZ=America/Panama date +%F) Panama : start ===" >> "$LOG"
cd "$WS"
node dist/capture.js >> "$LOG" 2>&1
node dist/classify.js >> "$LOG" 2>&1
node dist/brief.js >> "$LOG" 2>&1
node dist/concept.js expat_language >> "$LOG" 2>&1
TOKEN=$(grep -m1 '^GITHUB_TOKEN=' /home/ubuntu/cto-aipa/.env | cut -d= -f2- | tr -d '\r')
if [[ -d "$WS/data/.git" ]]; then
  cd "$WS/data"
  git add captures.jsonl capture.log 2>/dev/null || true
  git commit -m "snapshot $(TZ=America/Panama date +%F)" >> "$LOG" 2>&1 || echo "nothing to commit" >> "$LOG"
  git push "https://${TOKEN}@github.com/ElenaRevicheva/atlas-captures.git" HEAD:main >> "$LOG" 2>&1 \
    && echo "backup pushed" >> "$LOG" || echo "backup push FAILED" >> "$LOG"
fi
echo "=== $(date -u +%FT%TZ) : done ===" >> "$LOG"
