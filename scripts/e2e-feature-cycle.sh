#!/usr/bin/env bash
# End-to-end feature cycle test — real logs, run on Oracle after deploy.
set -uo pipefail
BASE="${1:-http://127.0.0.1:8095}"
WS="${2:-/home/ubuntu/whitespace}"
LOG="$WS/data/e2e-$(date -u +%Y%m%dT%H%M%SZ).log"
exec > >(tee -a "$LOG") 2>&1

pass=0
fail=0
note() { echo ""; echo "━━━ $1 ━━━"; }
ok() { echo "  ✓ $1"; pass=$((pass + 1)); }
bad() { echo "  ✗ $1"; fail=$((fail + 1)); }

note "1 · HEALTH + CRON"
HZ=$(curl -sf --max-time 10 "$BASE/healthz" || echo '{}')
echo "$HZ" | python3 -m json.tool 2>/dev/null || echo "$HZ"
echo "$HZ" | grep -q '"ok":true' && ok "healthz ok" || bad "healthz"
echo "$HZ" | grep -q '"brightData":true' && ok "Bright Data" || bad "Bright Data"
crontab -l 2>/dev/null | grep -q 'atlas-capture-cron' && ok "cron registered" || bad "cron missing"
[[ -x "$WS/scripts/atlas-capture-cron.sh" ]] && ok "cron script executable" || bad "cron script not executable"

note "2 · ATLAS RADAR API (daily memory)"
ATLAS=$(curl -sf --max-time 15 "$BASE/api/atlas" || echo '{}')
echo "$ATLAS" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  snapshot:', d.get('snapshot_date'))
print('  days:', d.get('distinct_days'), 'rows:', d.get('total_rows'))
print('  board verticals:', len(d.get('board') or []))
print('  brief verticals:', len((d.get('brief') or {}).get('verticals') or []))
print('  concepts:', list((d.get('concepts') or {}).keys()))
print('  tracked:', [(t.get('id'), t.get('label')) for t in (d.get('tracked_verticals') or [])])
" 2>/dev/null || bad "api/atlas parse failed"
SNAP=$(echo "$ATLAS" | python3 -c "import json,sys; print(json.load(sys.stdin).get('snapshot_date',''))" 2>/dev/null)
[[ -n "$SNAP" ]] && ok "api/atlas snapshot=$SNAP" || bad "api/atlas no snapshot"
BOARD_N=$(echo "$ATLAS" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('board') or []))" 2>/dev/null)
[[ "${BOARD_N:-0}" -ge 5 ]] && ok "radar board has $BOARD_N verticals" || bad "radar board thin ($BOARD_N)"

note "3 · WHITESPACE FINDER (one-shot /api/run · media_buyer)"
TEST_V="personal ai companions on the go"
echo "  vertical: \"$TEST_V\""
RUN_LOG=$(mktemp)
if curl -sfN --max-time 240 "$BASE/api/run?vertical=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$TEST_V'))")&mode=media_buyer" 2>/dev/null | tee "$RUN_LOG" | while read -r line; do
  [[ "$line" == data:* ]] && echo "  $line" | head -c 200
  echo "$line" | grep -q '"stage":"done"' && exit 0
  echo "$line" | grep -q '"stage":"error"' && exit 1
done; then
  grep -q '"stage":"done"' "$RUN_LOG" && ok "WHITESPACE run completed" || bad "WHITESPACE run no done event"
  grep -q '"stage":"recon"' "$RUN_LOG" && ok "WHITESPACE recon stage seen" || bad "WHITESPACE no recon"
else
  bad "WHITESPACE run failed or timed out"
fi
rm -f "$RUN_LOG"

note "4 · ADD TO RADAR (persist + score on board)"
TRACK_LOG=$(mktemp)
echo "  tracking: \"$TEST_V\""
if curl -sfN --max-time 600 "$BASE/api/atlas/track?vertical=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$TEST_V'))")" 2>/dev/null | tee "$TRACK_LOG" | while read -r line; do
  [[ "$line" == data:* ]] && echo "  $line" | head -c 220
  echo "$line" | grep -q '"stage":"done"' && exit 0
  echo "$line" | grep -q '"stage":"error"' && exit 1
done; then
  grep -q '"stage":"done"' "$TRACK_LOG" && ok "Add to radar completed" || bad "track no done"
  grep -q 'daily cron' "$TRACK_LOG" && ok "daily cron registration message" || echo "  (info: cron msg may vary)"
else
  bad "Add to radar failed or timed out"
fi
rm -f "$TRACK_LOG"

[[ -f "$WS/data/tracked-verticals.json" ]] && ok "tracked-verticals.json exists" || bad "tracked-verticals.json missing"
cat "$WS/data/tracked-verticals.json" 2>/dev/null | head -20

ATLAS2=$(curl -sf --max-time 15 "$BASE/api/atlas" || echo '{}')
TRACKED=$(echo "$ATLAS2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('tracked_verticals') or []))" 2>/dev/null)
[[ "${TRACKED:-0}" -ge 1 ]] && ok "tracked verticals in API ($TRACKED)" || bad "no tracked verticals in API"
BOARD2=$(echo "$ATLAS2" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('board') or []))" 2>/dev/null)
[[ "${BOARD2:-0}" -gt "${BOARD_N:-0}" ]] && ok "board grew to $BOARD2 verticals" || echo "  (info: board count $BOARD2 — vertical may already exist in sqlite)"

note "5 · EVIDENCE + HISTORY"
EV=$(curl -sf --max-time 10 "$BASE/api/atlas/evidence?vertical=auto_insurance&angle=social_proof&date=$SNAP" || echo '{}')
EV_N=$(echo "$EV" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('evidence') or []))" 2>/dev/null)
[[ "${EV_N:-0}" -ge 1 ]] && ok "evidence drawer data ($EV_N ads)" || bad "evidence empty"
HIST=$(curl -sf --max-time 10 "$BASE/api/atlas/history?vertical=auto_insurance&angle=social_proof" || echo '{}')
HIST_N=$(echo "$HIST" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('history') or []))" 2>/dev/null)
[[ "${HIST_N:-0}" -ge 1 ]] && ok "angle history ($HIST_N points)" || bad "history empty"

note "6 · PUBLIC PAGES"
curl -sf --max-time 15 -o /dev/null "$BASE/" && ok "WHITESPACE page" || bad "WHITESPACE page"
curl -sf --max-time 15 -o /dev/null "$BASE/atlas.html" && ok "Atlas radar page" || bad "Atlas page"
grep -q 'Add to radar' "$WS/public/atlas.html" && ok "atlas.html has Add to radar" || bad "atlas UI"
grep -q 'scanLive' "$WS/public/atlas.html" && bad "Live scan still on radar (should be removed)" || ok "Live scan removed from radar"
grep -q 'api/run' "$WS/public/index.html" && ok "WHITESPACE still uses api/run" || bad "WHITESPACE scanner broken"

note "7 · CONTEST VERIFY"
bash "$WS/scripts/contest-verify.sh" "$WS" || bad "contest-verify failed"

note "SUMMARY"
echo "  PASS=$pass FAIL=$fail"
echo "  Full log: $LOG"
exit "$fail"
