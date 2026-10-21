#!/usr/bin/env bash
# Register the Atlas WEEKLY capture cron (Mondays 9 AM Panama = 14:00 UTC). Idempotent.
# Weekly since 19 Jul 2026; each capture now buys Bright Data Ad Library records (21 Oct 2026), so daily would cost 7x.
set -euo pipefail
WS=/home/ubuntu/whitespace
CRON_SCRIPT="$WS/scripts/atlas-capture-cron.sh"
CRON_LINE='0 14 * * 1 bash /home/ubuntu/whitespace/scripts/atlas-capture-cron.sh # Atlas WEEKLY capture Mon 9AM Panama (cheap-mode 2026-07-19)'

chmod +x "$CRON_SCRIPT"
# Replace any prior atlas-capture line; keep other crontab entries.
( crontab -l 2>/dev/null | grep -v 'atlas-capture-cron.sh' || true
  echo "$CRON_LINE"
) | sort -u | crontab -
echo "Atlas cron installed:"
crontab -l | grep atlas-capture-cron.sh
