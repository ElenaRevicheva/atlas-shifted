# Contest submit checklist — It's Today Media ($5,000 Build Challenge)

**Deadline:** July 4, 2026  
**Submit at:** [itstoday.media](https://www.itstoday.media/)

---

## What to link

| Asset | URL |
|-------|-----|
| **Live demo (radar + brief + creative)** | https://webhook.aideazz.xyz/whitespace/atlas.html |
| **On-demand whitespace finder** | https://webhook.aideazz.xyz/whitespace/ |
| **GitHub repo** | https://github.com/ElenaRevicheva/atlas-shifted |
| **Plain-English proof doc** | https://github.com/ElenaRevicheva/atlas-shifted/blob/main/docs/CONTEST_REALITY_CHECK.md |

---

## 60-second judge script

1. Open **atlas.html** — show 5 verticals with ENTER/WATCH/STABLE labels and scores.
2. Click a vertical — evidence drawer shows **real ad excerpts** (not invented).
3. Scroll to **generated concept** — image + video load (expat_language or auto_insurance).
4. Open **whitespace finder** — type `solar` → live Meta ads → battle plan in ~2 min.
5. Say: *"This runs every morning on Oracle — capture, classify, brief, Telegram push — no human in the loop."*

---

## Pre-submit verify (on Oracle)

```bash
ssh -i ~/.ssh/ssh-key-2026-01-07private.key ubuntu@170.9.242.90
bash /home/ubuntu/whitespace/scripts/contest-verify.sh
```

All lines should show `OK`. WARN on Scraping Browser is OK until you add `BRIGHTDATA_BROWSER_AUTH` (see [BRIGHTDATA_BROWSER_SETUP.md](./BRIGHTDATA_BROWSER_SETUP.md)).

---

## Honest talking points (don't oversell)

- **Public ad libraries only** — no spend, CTR, or ROAS claims.
- **2+ days of time-series** — velocity charts improve daily; don't claim "10 days" until you have them.
- **Detect, not predict** — ENTER/WATCH are hypotheses ranked by saturation + entry momentum.
- **Google ads are best-effort** — Meta is the reliable spine.

---

## One upgrade before judging (recommended)

Add Bright Data **Scraping Browser** zone → `BRIGHTDATA_BROWSER_AUTH` in Oracle `.env`.  
5-minute setup: [BRIGHTDATA_BROWSER_SETUP.md](./BRIGHTDATA_BROWSER_SETUP.md)
