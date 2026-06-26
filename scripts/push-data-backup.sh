#!/usr/bin/env bash
# Push captures.jsonl backup to private atlas-captures repo.
set -euo pipefail
WS=/home/ubuntu/whitespace
DATA=$WS/data
TOKEN=$(grep -m1 '^GITHUB_TOKEN=' /home/ubuntu/cto-aipa/.env | cut -d= -f2- | tr -d '\r')
[[ -d "$DATA/.git" ]] || { echo "no data git repo at $DATA"; exit 1; }
cd "$DATA"
git add captures.jsonl capture.log 2>/dev/null || true
git commit -m "snapshot $(TZ=America/Panama date +%F)" || echo "nothing to commit"
git push "https://${TOKEN}@github.com/ElenaRevicheva/atlas-captures.git" HEAD:main
echo "backup pushed to atlas-captures"
