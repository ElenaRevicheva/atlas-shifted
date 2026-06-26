# Atlas Shifted — autonomous marketing strategist

> **Live demo:** https://webhook.aideazz.xyz/whitespace/atlas.html  
> **Try any vertical:** https://webhook.aideazz.xyz/whitespace/  
> **Built for:** [It's Today Media Build Challenge](https://www.itstoday.media/) · Elena Revicheva · [AIdeazz](https://aideazz.xyz)

---

## What problem this solves (for a media buyer)

Most ad-intelligence tools answer: *“What creative is already winning?”*  
That herds every buyer into the **same angle**. Margins collapse.

**Atlas answers a different question:** *“Which creative angle is still open — adjacent to what’s heating up, but not saturated yet?”*

Then it **closes the loop**: daily brief → evidence-grounded concept → rendered image (and video when available). A buyer goes from *“what’s the market doing?”* to *“here’s something we can test today”* in minutes — not a research sprint.

**Honest scope:** public ad libraries only. No spend, CTR, or ROAS claims. Every MOVE is a **hypothesis to test**, ranked by observable saturation and entry momentum — not a prediction engine.

---

## Verify in 60 seconds (no install)

1. Open the **[live radar](https://webhook.aideazz.xyz/whitespace/atlas.html)** — five affiliate verticals with ENTER / WATCH / STABLE labels.
2. Click a vertical — the evidence drawer shows **real ad copy** from public libraries (clickable sources).
3. Scroll to **generated creative** — image loads for expat_language / auto_insurance.
4. Open the **[whitespace finder](https://webhook.aideazz.xyz/whitespace/)** — type `solar` → live Meta scan → battle plan in ~2 minutes.

**Production proof:** runs unattended every morning on Oracle Cloud (capture → classify → brief → Telegram). Health: `https://webhook.aideazz.xyz/whitespace/healthz`

---

## Submission form — copy/paste answers

Use these at your [private submission link](https://www.itstoday.media/submit/946c809e-7e69-4686-a72a-92f593d4423c):

| Field | Answer |
|-------|--------|
| **Demo URL** | `https://webhook.aideazz.xyz/whitespace/atlas.html` |
| **GitHub repo** | `https://github.com/ElenaRevicheva/atlas-shifted` |

### What does this tool do?

Atlas is a daily marketing intelligence agent for affiliate media buying. Every morning it pulls live ads from the Meta Ad Library (and Google Search ads when available) across five verticals, classifies each ad into eight creative angles (pain point, social proof, urgency, authority, etc.), and scores which angles are **entering**, **heating**, or **saturating**. It delivers a daily MOVE brief — what to test and what to avoid — with real ad excerpts as evidence. For the top opportunity it writes a campaign concept grounded in those ads and renders the creative asset. It runs on a production server without manual steps: capture, classify, brief, Telegram push, backup. Public data only; no fake performance metrics.

### Why did you build THIS one?

Because your business lives and dies on **timing creative angles across platforms** — and every tool I’ve used optimizes for copying winners, not finding whitespace. I built Atlas to mirror how a sharp media buyer actually thinks: watch what’s entering the market, avoid lanes that are crowding, move on adjacent angles before everyone else, and ship creative fast enough to test. I didn’t stop at a dashboard — I closed the loop to concept + asset because research that doesn’t reach production is shelfware. I run nine other AI agents in production for my own company (AIdeazz) on the same Oracle stack; Atlas is that same “agent that runs itself” pattern applied directly to your world. I also dogfood it: the expat-language vertical matches EspaLuz, my live language-learning product — real ICP keywords, not generic demos.

### What would you build next if this became your full-time job?

Week 1–2: wire **TikTok and Taboola** into the same angle ontology so all four of your buying platforms share one radar — the architecture is ready, Meta is the spine today. Week 3–4: **landing-page message match** — score where ad promise and LP copy diverge (the leak that kills affiliate ROI after the click). Month 2: **Atlas Intelligence Layer** — creative half-life, cost-of-waiting on a heating angle, and accumulated market memory so each daily snapshot compounds instead of resetting. Month 3: team workflows — Slack/Telegram alerts tuned to buyer vertical, A/B hook variants auto-generated from the evidence drawer, and HubSpot or your CRM wired so every MOVE creates a trackable test ticket. I’ve already shipped multi-agent HubSpot ingestion and Bright Data research layers in production; this is extending that stack to your media team’s daily rhythm.

### Additional notes (optional)

I’m an AI-augmented builder: I ship production systems with Claude Code and Cursor, not slide decks. This submission is live software — 292+ real ads captured, 2 days of time-series (growing daily), Bright Data Scraping Browser + Web Unlocker, 4-tier LLM failover, daily cron, off-site backup. I’m a solo founder and single parent; I designed for **unattended operation** because I can’t babysit dashboards. Happy to walk through the radar, the evidence trail, or the Oracle deployment on a call. Portfolio: [aideazz.xyz](https://aideazz.xyz) · proof doc: [PRODUCT_PROOF.md](./docs/PRODUCT_PROOF.md)

---

## About the builder

**Elena Revicheva** — solo founder, AI-augmented builder, 13+ months running a production AI agent fleet on Oracle Cloud ($0/month infra). Nine live agents (CTO co-pilot, EspaLuz tutor, job hunter, trading, etc.) with health checks, Telegram ops, and HubSpot CRM integration. Atlas reuses the Bright Data web layer built during the Bright Data / lablab hackathon (Web Unlocker + Scraping Browser + SERP) — same credentials, new product aimed at media-buying whitespace.

---

## The daily loop (live in production)

```
Observe → Understand → Detect → Brief → Create → Ship
```

| Stage | What it does |
|-------|----------------|
| **Observe** | Capture active ads for 5 verticals → append-only log |
| **Understand** | Classify each ad into 8 frozen angles (embeddings) |
| **Detect** | Score saturation + entry velocity → ENTER / WATCH / AVOID |
| **Brief** | Daily MOVE per vertical + Telegram push |
| **Create** | Evidence-grounded concept from real winning ads |
| **Ship** | Render image (+ video best-effort) |

Cron: **9 AM Panama daily** · `capture → classify → brief → concept → backup`

---

## Data sources (honest)

| Platform | Method | Status |
|----------|--------|--------|
| **Meta Ad Library** | Bright Data Scraping Browser + LLM extraction | ✅ Primary spine — 290+ ads captured |
| **Google Search ads** | Bright Data SERP (`top_ads` / `bottom_ads`) | ⚠️ Best-effort — present when Google serves paid results |
| TikTok / Taboola | — | 🔜 next (same ontology) |

---

## Resilience

- **LLM:** Claude → Groq → OpenAI → Grok (proven when Anthropic credits died mid-build)
- **Images:** Flux → OpenAI fallback
- **Video:** Runway → Luma (best-effort)
- **Data:** JSONL is source of truth; SQLite rebuilds from it; daily GitHub backup

---

## Angle ontology (v1, frozen)

`pain_point` · `social_proof` · `urgency_scarcity` · `authority` · `curiosity_gap` · `transformation` · `fear_loss` · `novelty`

---

## Run locally

```bash
cp .env.example .env
npm install && npm run build
npm run capture && npm run classify && npm run brief
npm run concept expat_language && npm run produce expat_language
npm start   # http://localhost:8095
```

---

## Docs

| Doc | Purpose |
|-----|---------|
| [PRODUCT_PROOF.md](./docs/PRODUCT_PROOF.md) | Plain-English verification — what works, how to check |
| [MARKET_ANALYSIS.md](./docs/MARKET_ANALYSIS.md) | Why Atlas fits affiliate media buying |

---

_Built by Elena Revicheva · [AIdeazz](https://aideazz.xyz). Public repo — this engine doubles as an AIdeazz marketing capability regardless of contest outcome._
