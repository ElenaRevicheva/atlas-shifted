#!/usr/bin/env bash
# Register Atlas daily capture cron (9 AM Panama = 14:00 UTC). Idempotent.
set -euo pipefail
WS=/home/ubuntu/whitespace
CRON_SCRIPT="$WS/scripts/atlas-capture-cron.sh"
CRON_LINE='0 14 * * * bash /home/ubuntu/whitespace/scripts/atlas-capture-cron.sh # Atlas daily capture (9AM Panama)'

chmod +x "$CRON_SCRIPT"
# Replace any prior atlas-capture line; keep other crontab entries.
( crontab -l 2>/dev/null | grep -v 'atlas-capture-cron.sh' || true
  echo "$CRON_LINE"
) | sort -u | crontab -
echo "Atlas cron installed:"
crontab -l | grep atlas-capture-cron.sh
