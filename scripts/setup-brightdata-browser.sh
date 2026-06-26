#!/usr/bin/env bash
# Idempotent Scraping Browser wiring — NEVER overwrites existing env keys.
# Tries: (1) already set, (2) server secret file, (3) existing browser_api zone via API,
# (4) create zone via API, (5) print manual dashboard steps.
set -euo pipefail
WS=/home/ubuntu/whitespace
ENV=$WS/.env
SECRET_FILE="${BRIGHTDATA_BROWSER_SECRET_FILE:-/home/ubuntu/.secrets/atlas-brightdata-browser}"
ZONE_NAME="${BRIGHTDATA_BROWSER_ZONE:-atlas_scraping_browser}"
TOKEN=$(grep -m1 '^BRIGHTDATA_API_TOKEN=' "$ENV" 2>/dev/null | cut -d= -f2- | tr -d '\r' \
  || grep -m1 '^BRIGHTDATA_API_TOKEN=' /home/ubuntu/cto-aipa/.env | cut -d= -f2- | tr -d '\r')

if [[ -z "$TOKEN" ]]; then
  echo "NOTE: BRIGHTDATA_API_TOKEN missing — skip browser setup"
  exit 0
fi

if grep -q '^BRIGHTDATA_BROWSER_AUTH=' "$ENV" 2>/dev/null; then
  echo "BRIGHTDATA_BROWSER_AUTH already set — no overwrite"
  exit 0
fi

wire_auth() {
  local auth=$1
  touch "$ENV"
  echo "BRIGHTDATA_BROWSER_AUTH=${auth}" >> "$ENV"
  echo "wired BRIGHTDATA_BROWSER_AUTH (web_unlocker1 unchanged)"
}

# Manual paste from Bright Data dashboard → Overview tab (username:password one line)
if [[ -f "$SECRET_FILE" ]]; then
  auth=$(tr -d '\r\n' < "$SECRET_FILE" | head -1)
  if [[ "$auth" == brd-customer-*:* ]]; then
    wire_auth "$auth"
    exit 0
  fi
fi

auth_hdr=( -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" )
zones_json=$(curl -sf "${auth_hdr[@]}" "https://api.brightdata.com/zone/get_all_zones" || echo '[]')
browser_zone=$(echo "$zones_json" | python3 -c "
import json,sys
zones=json.load(sys.stdin)
for z in zones:
    if z.get('type')=='browser_api' and z.get('status')=='active':
        print(z['name']); break
" 2>/dev/null || true)

if [[ -z "$browser_zone" ]]; then
  code=$(curl -s -o /tmp/bd_create.json -w '%{http_code}' -X POST "${auth_hdr[@]}" \
    -d "{\"zone\":{\"name\":\"${ZONE_NAME}\"},\"plan\":{\"type\":\"browser_api\",\"country\":\"us\"}}" \
    "https://api.brightdata.com/zone")
  if [[ "$code" == "201" || "$code" == "200" ]]; then
    browser_zone="$ZONE_NAME"
    echo "Created Scraping Browser zone: ${browser_zone}"
  elif [[ "$code" == "403" ]]; then
    echo "API key cannot create zones (403). Create Scraping Browser manually:"
    echo "  1. https://brightdata.com/cp/zones → Scraping Browser → Add"
    echo "  2. Name: ${ZONE_NAME} → copy username:password from Overview"
    echo "  3. echo 'brd-customer-...-zone-...:PASSWORD' > ${SECRET_FILE}"
    echo "  4. bash scripts/setup-brightdata-browser.sh"
    echo "  (Or upgrade API key permissions at https://brightdata.com/cp/setting/users)"
    exit 0
  else
    echo "Create zone HTTP ${code}: $(head -c 120 /tmp/bd_create.json 2>/dev/null)"
    exit 0
  fi
else
  echo "Found browser zone: ${browser_zone}"
fi

pass_json=$(curl -sf "${auth_hdr[@]}" "https://api.brightdata.com/zone/passwords?zone=${browser_zone}" || echo '{}')
zone_pass=$(echo "$pass_json" | python3 -c "
import json,sys
d=json.load(sys.stdin)
pwds=d.get('passwords') or []
print(pwds[0] if pwds else '')
" 2>/dev/null || true)

cust="${BRIGHTDATA_CUSTOMER_ID:-}"
if [[ -z "$cust" && -f /home/ubuntu/.secrets/brightdata-customer-id ]]; then
  cust=$(tr -d '\r\n' < /home/ubuntu/.secrets/brightdata-customer-id)
fi

if [[ -n "$zone_pass" && -n "$cust" ]]; then
  wire_auth "brd-customer-${cust}-zone-${browser_zone}:${zone_pass}"
  exit 0
fi

echo "Browser zone exists but cannot build auth automatically (need customer id)."
echo "Paste full username:password to ${SECRET_FILE} and re-run this script."
