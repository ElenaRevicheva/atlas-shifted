# Contest submission — It's Today Media

**Deadline:** July 4, 2026, 11:59 PM ET  
**Your link:** https://www.itstoday.media/submit/946c809e-7e69-4686-a72a-92f593d4423c

---

## URLs to paste

| Field | Value |
|-------|-------|
| **Demo URL** | https://webhook.aideazz.xyz/whitespace/atlas.html |
| **GitHub repo** | https://github.com/ElenaRevicheva/atlas-shifted |

---

## Form answers (copy/paste)

### What does this tool do?

Atlas is a daily marketing intelligence agent for affiliate media buying. Every morning it pulls live ads from the Meta Ad Library (and Google Search ads when available) across five verticals, classifies each ad into eight creative angles (pain point, social proof, urgency, authority, etc.), and scores which angles are entering, heating, or saturating. It delivers a daily MOVE brief — what to test and what to avoid — with real ad excerpts as evidence. For the top opportunity it writes a campaign concept grounded in those ads and renders the creative asset. It runs on a production server without manual steps: capture, classify, brief, Telegram push, backup. Public data only; no fake performance metrics.

### Why did you build THIS one?

Because your business lives and dies on timing creative angles across platforms — and every tool I've used optimizes for copying winners, not finding whitespace. I built Atlas to mirror how a sharp media buyer actually thinks: watch what's entering the market, avoid lanes that are crowding, move on adjacent angles before everyone else, and ship creative fast enough to test. I didn't stop at a dashboard — I closed the loop to concept + asset because research that doesn't reach production is shelfware. I run nine other AI agents in production for my own company (AIdeazz) on the same Oracle stack; Atlas is that same "agent that runs itself" pattern applied directly to your world. I also dogfood it: the expat-language vertical matches EspaLuz, my live language-learning product — real ICP keywords, not generic demos.

### What would you build next if this became your full-time job?

Week 1–2: wire TikTok and Taboola into the same angle ontology so all four of your buying platforms share one radar — the architecture is ready, Meta is the spine today. Week 3–4: landing-page message match — score where ad promise and LP copy diverge (the leak that kills affiliate ROI after the click). Month 2: Atlas Intelligence Layer — creative half-life, cost-of-waiting on a heating angle, and accumulated market memory so each daily snapshot compounds instead of resetting. Month 3: team workflows — Slack/Telegram alerts tuned to buyer vertical, A/B hook variants auto-generated from the evidence drawer, and HubSpot or your CRM wired so every MOVE creates a trackable test ticket. I've already shipped multi-agent HubSpot ingestion and Bright Data research layers in production; this is extending that stack to your media team's daily rhythm.

### Additional notes (optional)

I'm an AI-augmented builder: I ship production systems with Claude Code and Cursor, not slide decks. This submission is live software — 290+ real ads captured, 2 days of time-series (growing daily), Bright Data Scraping Browser + Web Unlocker, 4-tier LLM failover, daily cron, off-site backup. I'm a solo founder and single parent; I designed for unattended operation because I can't babysit dashboards. Happy to walk through the radar, the evidence trail, or the Oracle deployment on a call. Portfolio: https://aideazz.xyz

---

## 60-second demo script

1. **atlas.html** — five verticals, ENTER/WATCH/STABLE scores.
2. Click a vertical — evidence drawer with **real ad excerpts**.
3. Scroll — generated image loads.
4. **whitespace finder** — type `solar` → live scan → battle plan.
5. Say: *"Runs every morning on Oracle — no human in the loop."*

---

## Pre-submit verify

```bash
bash /home/ubuntu/whitespace/scripts/contest-verify.sh
```

All checks should show **OK** (verified Jun 26, 2026).

---

## Honest limits (if asked)

- Public libraries only — no spend/CTR/ROAS.
- **Detect**, not predict — 2 snapshot days so far; velocity charts improve daily.
- Google ads are best-effort; Meta is the reliable spine.
