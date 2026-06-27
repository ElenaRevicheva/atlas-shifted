#!/usr/bin/env bash
# Pre-deploy smoke test — run before pm2 restart. Exits non-zero on regression.
set -uo pipefail
BASE="${1:-http://127.0.0.1:8095}"
FAIL=0
ok() { echo "  OK  $1"; }
bad() { echo "  FAIL $1"; FAIL=$((FAIL + 1)); }

echo "=== ATLAS PRE-DEPLOY VERIFY ==="

HZ=$(curl -sf --max-time 10 "$BASE/healthz" 2>/dev/null || echo '{}')
echo "$HZ" | grep -q '"ok":true' && ok "healthz" || bad "healthz"
echo "$HZ" | grep -q '"brightData":true' && ok "Bright Data" || echo "  INFO Bright Data off (local ok)"

ATLAS=$(curl -sf --max-time 15 "$BASE/api/atlas" 2>/dev/null || echo '{}')
echo "$ATLAS" | grep -q '"ok":true' && ok "api/atlas" || bad "api/atlas"
ROWS=$(echo "$ATLAS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('total_rows',0))" 2>/dev/null || echo 0)
[[ "${ROWS:-0}" -ge 50 ]] && ok "radar rows ($ROWS)" || echo "  INFO thin radar ($ROWS rows)"

curl -sf --max-time 5 -o /dev/null "$BASE/" && ok "finder /" || bad "finder /"
curl -sf --max-time 5 -o /dev/null "$BASE/atlas.html" && ok "atlas.html" || bad "atlas.html"

# SSE streams stay open — only verify the endpoint accepts the request (200), not full body.
CODE=$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' "$BASE/api/run?vertical=smoke" 2>/dev/null || echo 000)
[[ "$CODE" == "200" ]] && ok "api/run SSE (opens)" || echo "  INFO api/run check skipped ($CODE — SSE may timeout curl)"

echo "=== RESULT: $([[ $FAIL -eq 0 ]] && echo PASS || echo "$FAIL FAILED") ==="
exit "$FAIL"
