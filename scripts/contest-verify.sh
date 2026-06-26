#!/usr/bin/env bash
# Pre-submit checklist for It's Today Media Build Challenge — run on Oracle or locally.
set -uo pipefail
WS="${1:-/home/ubuntu/whitespace}"
cd "$WS"
FAIL=0
ok() { echo "  OK  $1"; }
bad() { echo "  FAIL $1"; FAIL=$((FAIL + 1)); }

echo "=== ATLAS CONTEST VERIFY ==="
echo "git: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

# Health
HZ=$(curl -sf --max-time 10 http://127.0.0.1:8095/healthz 2>/dev/null || echo '{}')
echo "$HZ" | grep -q '"ok":true' && ok "healthz ok" || bad "healthz down"
echo "$HZ" | grep -q '"brightData":true' && ok "Bright Data wired" || bad "Bright Data missing"
echo "$HZ" | grep -q '"telegram":true' && ok "Telegram wired" || bad "Telegram missing"
echo "$HZ" | grep -q '"brightDataBrowser":true' && ok "Scraping Browser zone (best Meta path)" || echo "  INFO Web Unlocker + retries active (Scraping Browser optional)"

# Data
if [[ -f data/captures.jsonl ]]; then
  ROWS=$(wc -l < data/captures.jsonl)
  [[ "$ROWS" -ge 200 ]] && ok "captures.jsonl ${ROWS} rows" || bad "captures.jsonl thin (${ROWS} rows)"
  DAYS=$(python3 -c "import json; print(len({json.loads(l)['snapshot_date'] for l in open('data/captures.jsonl') if l.strip()}))" 2>/dev/null || echo 0)
  [[ "$DAYS" -ge 2 ]] && ok "${DAYS} snapshot days (time-series started)" || bad "need 2+ snapshot days (have ${DAYS})"
else
  bad "captures.jsonl missing"
fi

[[ -f data/radar.sqlite ]] && ok "radar.sqlite present" || bad "radar.sqlite missing"
[[ -f data/brief.json ]] && ok "brief.json present" || bad "brief.json missing"

# Creative proof
if python3 -c "import json; d=json.load(open('data/concepts.json')); exit(0 if any(v.get('asset') for v in d.values()) else 1)" 2>/dev/null; then
  ok "concepts.json has rendered image asset"
else
  bad "no rendered image in concepts.json — run produce.js"
fi

# Public URLs (best-effort from VM)
curl -sf --max-time 15 -o /dev/null -w '' "https://webhook.aideazz.xyz/whitespace/atlas.html" 2>/dev/null \
  && ok "public atlas.html reachable" || bad "public atlas.html unreachable"

echo "=== RESULT: $([[ $FAIL -eq 0 ]] && echo PASS || echo "$FAIL CHECK(S) FAILED") ==="
exit "$FAIL"
