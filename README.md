# Atlas Shifted — autonomous marketing strategist

> **Live demo:** https://webhook.aideazz.xyz/whitespace/atlas.html  
> **Try any vertical:** https://webhook.aideazz.xyz/whitespace/  
> **Built for:** [It's Today Media Build Challenge](https://www.itstoday.media/) · Elena Revicheva · [AIdeazz](https://aideazz.xyz/portfolio)

---

## What problem this solves (for a media buyer)

Most ad-intelligence tools answer: *“What creative is already winning?”*  
That herds every buyer into the **same angle**. Margins collapse.

**Atlas answers a different question:** *“Which creative angle is still open — adjacent to what’s heating up, but not saturated yet?”*

Then it **closes the loop**: daily brief → evidence-grounded concept → rendered image (and video when available). A buyer goes from *“what’s the market doing?”* to *“here’s something we can test today”* in minutes — not a research sprint.

**Honest scope:** public ad libraries only. No spend, CTR, or ROAS claims. Every MOVE is a **hypothesis to test**, ranked by observable saturation and entry momentum — not a prediction engine.

---

## Verify in 60 seconds (no install)

1. Open the **[live radar](https://webhook.aideazz.xyz/whitespace/atlas.html)** — five affiliate verticals with ENTER / WATCH / AVOID / STABLE labels.
2. Click a vertical — the evidence drawer shows **real ad copy** from Meta and Google (clickable source URLs).
3. Scroll to **generated creative** — image (and video for expat_language) loads for expat_language / auto_insurance.
4. Open the **[whitespace finder](https://webhook.aideazz.xyz/whitespace/)** — type `solar` → live Meta + TikTok Creative Center scan → battle plan in ~2 minutes.

**Production proof:** daily cron on Oracle Cloud (capture → classify → brief → concept → Telegram → backup). Health: `https://webhook.aideazz.xyz/whitespace/healthz` · last verify: **292 ads, 2 snapshot days, contest-verify PASS**

---

## Submission form — copy/paste answers

Use these at your [private submission link](https://www.itstoday.media/submit/946c809e-7e69-4686-a72a-92f593d4423c):

| Field | Answer |
|-------|--------|
| **Demo URL** | `https://webhook.aideazz.xyz/whitespace/atlas.html` |
| **GitHub repo** | `https://github.com/ElenaRevicheva/atlas-shifted` |

### What does this tool do?

Atlas is a daily marketing intelligence agent for affiliate media buying. Every morning it pulls live ads from the Meta Ad Library and Google Search ads (when available) across five verticals, classifies each ad into eight creative angles (pain point, social proof, urgency, authority, etc.), and scores which angles are **entering** (ENTER), **heating adjacent** (WATCH + adjacency notes), **crowded** (AVOID), or **stable**. It delivers a daily MOVE brief — what to test and what to avoid — with real ad excerpts as evidence. For the top opportunity it writes a campaign concept grounded in those ads and renders the creative asset (image + video when available). The on-demand **whitespace finder** scans Meta and TikTok Creative Center for any vertical you type; Taboola native is next on the same angle taxonomy so all four buying platforms can share one radar. It runs on a production server without manual steps: capture, classify, brief, Telegram push, backup. Public data only; no fake performance metrics.

### Why did you build THIS one?

Because your business lives and dies on **timing creative angles across platforms** — and every tool I’ve used optimizes for copying winners, not finding whitespace. I built Atlas to mirror how a sharp media buyer actually thinks: watch what’s entering the market, avoid lanes that are crowding, move on adjacent angles before everyone else, and ship creative fast enough to test. I didn’t stop at a dashboard — I closed the loop to concept + asset because research that doesn’t reach production is shelfware. I run nine other AI agents in production for my own company (AIdeazz) on the same Oracle stack; Atlas is that same “agent that runs itself” pattern applied directly to your world. I also dogfood it: the expat-language vertical matches EspaLuz, my live language-learning product — real ICP keywords, not generic demos.

### What would you build next if this became your full-time job?

Week 1–2: add **Taboola native** and fold **TikTok into the daily cron** (TikTok Creative Center already works in the on-demand finder) so all four buying platforms share one radar — Meta is the spine today. Week 3–4: **landing-page message match** — score where ad promise and LP copy diverge (the leak that kills affiliate ROI after the click). Month 2: **Atlas Intelligence Layer** — 7-day entry-velocity sparklines (2 snapshot days live now, compounding daily), creative half-life, cost-of-waiting on a heating angle, and accumulated market memory. Month 3: team workflows — Slack/Telegram alerts tuned to buyer vertical, A/B hook variants auto-generated from the evidence drawer, and HubSpot or your CRM wired so every MOVE creates a trackable test ticket. I’ve already shipped multi-agent HubSpot ingestion and Bright Data research layers in production; this is extending that stack to your media team’s daily rhythm.

### Additional notes (optional)

I’m an AI-augmented builder: I ship production systems with Claude Code and Cursor, not slide decks. This submission is live software — **292 real ads captured**, **2 snapshot days** (7-day velocity charts grow as the daily cron runs), Bright Data Scraping Browser + Web Unlocker, 4-tier LLM failover, daily cron at 9 AM Panama, Telegram brief push, off-site GitHub backup. Daily pipeline: Meta (~96% of captures) + Google best-effort; finder adds TikTok on demand. I’m a solo founder and single parent; I designed for **unattended operation** because I can’t babysit dashboards. Happy to walk through the radar, the evidence trail, or the Oracle deployment on a call. Portfolio: [aideazz.xyz/portfolio](https://aideazz.xyz/portfolio) · proof doc: [PRODUCT_PROOF.md](./docs/PRODUCT_PROOF.md)

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
| **Observe** | Daily: Meta + Google (best-effort) for 5 verticals → append-only log |
| **Understand** | Classify each ad into 8 frozen angles (embeddings) |
| **Detect** | Score saturation + launch proxies → ENTER / WATCH / AVOID / STABLE |
| **Brief** | Daily MOVE per vertical + Telegram push |
| **Create** | Evidence-grounded concept from real ads in the lane |
| **Ship** | Render image (+ video best-effort) for top opportunities |

Cron: **9 AM Panama daily** · `capture → classify → brief → concept → backup` · on-demand finder: Meta + TikTok

---

## Data sources (honest)

| Platform | Daily cron | Whitespace finder | Method |
|----------|------------|-------------------|--------|
| **Meta Ad Library** | ✅ Primary | ✅ | Bright Data Scraping Browser + LLM extraction (~282/292 ads) |
| **Google Search ads** | ⚠️ Best-effort | ✅ | Bright Data SERP — when Google serves paid results |
| **TikTok Creative Center** | — | ✅ | Bright Data scrape of top ads |
| **Taboola native** | — | — | 🔜 Next (same 8-angle ontology) |

**Scoring honesty:** ENTER / WATCH / AVOID / STABLE from distinct advertisers + launch proxies. Full 7-day entry-velocity sparklines need more daily snapshots (2 days live; cron compounding).

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

_Built by Elena Revicheva · [AIdeazz](https://aideazz.xyz/portfolio). Public repo — this engine doubles as an AIdeazz marketing capability regardless of contest outcome._
