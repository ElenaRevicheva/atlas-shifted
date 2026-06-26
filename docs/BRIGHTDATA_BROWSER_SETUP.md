# Bright Data Scraping Browser — contest-grade Meta capture

**Why:** Meta Ad Library is a heavy JavaScript app. Web Unlocker + `render:true` works sometimes (we fixed solar with retries + 90s timeout), but **Scraping Browser** is Bright Data's managed Chrome — the reliable path for daily cron and live demos.

**Cost:** Pay-as-you-go on your existing Bright Data account (~minutes per daily capture).

---

## One-time setup (~5 minutes)

**Option A — Dashboard (recommended; API key may lack zone-create permission):**

1. Log in at [brightdata.com](https://brightdata.com) (same account as `web_unlocker1`).

2. **My Proxies** → **Scraping Browser** → **Get started** / **Add proxy**.

3. Name the zone e.g. `atlas_scraping_browser` (cannot rename later).

4. Open the zone → **Overview** tab → copy **username:password** (one line).

5. On Oracle VM:
   ```bash
   mkdir -p /home/ubuntu/.secrets
   echo 'brd-customer-XXXXX-zone-atlas_scraping_browser:YOUR_PASSWORD' > /home/ubuntu/.secrets/atlas-brightdata-browser
   chmod 600 /home/ubuntu/.secrets/atlas-brightdata-browser
   bash /home/ubuntu/whitespace/scripts/setup-brightdata-browser.sh
   pm2 restart whitespace --update-env
   ```

**Option B — API auto-create** (requires Admin/Ops API key with zone-create permission):
```bash
bash /home/ubuntu/whitespace/scripts/setup-brightdata-browser.sh
# Set BRIGHTDATA_CUSTOMER_ID if script asks (Account settings → Profile)
```

**What stays unchanged:** `BRIGHTDATA_ZONE=web_unlocker1` for Google SERP and fleet enrich — Scraping Browser is Meta-only, additive fallback chain.

6. Verify:
   ```bash
   curl -s http://127.0.0.1:8095/healthz | grep brightDataBrowser
   # should show "brightDataBrowser":true
   node /home/ubuntu/whitespace/dist/capture.js solar
   # log should say [bd-meta] Browser API OK
   ```

Or after pushing this repo, deploy wires defaults automatically:
```bash
bash /home/ubuntu/whitespace/scripts/wire-brightdata-env.sh
```

---

## Optional: Meta Graph API

`META_AD_LIBRARY_ACCESS_TOKEN` from [developers.facebook.com](https://developers.facebook.com) → Ads Library API.

**Honest limit:** US commercial affiliate ads (solar, supplements, etc.) are **not** returned by this API — only political/social-issue and special categories. Atlas tries API first when set, then browser scrape. Still worth adding for EU expansion later.

---

## Contest demo tip

Before judging / screen recording, run:
```bash
bash /home/ubuntu/whitespace/scripts/contest-verify.sh
node /home/ubuntu/whitespace/dist/capture.js solar   # quick Meta proof if needed
```

Live URLs:
- https://webhook.aideazz.xyz/whitespace/atlas.html
- https://webhook.aideazz.xyz/whitespace/
