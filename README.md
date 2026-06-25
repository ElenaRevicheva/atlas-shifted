# Atlas AIPA — autonomous marketing strategist

> **Live demo:** https://webhook.aideazz.xyz/whitespace/atlas.html
> **On-demand whitespace finder:** https://webhook.aideazz.xyz/whitespace/
> Built for the It's Today Media Build Challenge · by Elena Revicheva (AIdeazz)

Atlas watches the public ad market, **detects which creative angle is opening before it saturates**, generates an **evidence-grounded creative concept** for it, and **renders the actual asset**. It compresses *market observation → test-ready campaign concept* from days to minutes.

Every other tool surfaces the *proven winner* — which herds every buyer into the same saturating angle. Atlas does the opposite: it finds the **open window**, timed by observable entry velocity, with a sourced evidence trail.

**Public data only. No spend / CTR / ROAS is claimed or needed** — those aren't in public ad libraries, so we never pretend to see them. Window states are ranked *hypotheses to test*, not guarantees. The MVP **detects** (what's accelerating now); it does **not** *predict*.

---

## The loop (proven end-to-end, live)

```
Observe → Understand → Detect → Brief → Create → Ship
```

| Stage | What it does | Implementation |
|---|---|---|
| **Observe** | Capture every active ad for 5 verticals daily into an append-only log | `capture.ts` → Meta Ad Library (Bright Data) + Google Search ads (SERP) |
| **Understand** | Classify each ad into a frozen 8-angle ontology | `classify.ts` → OpenAI embeddings → nearest centroid |
| **Detect** | Score each angle: saturation, entry velocity, adjacency → ENTER/WATCH/AVOID | `classify.ts` aggregate → `radar.sqlite` |
| **Brief** | Rank the daily MOVE + lanes to AVOID, with evidence | `brief.ts` → Atlas Daily Brief |
| **Create** | Ground a fresh creative concept in the real winning ads of the adjacent lane | `concept.ts` → Creative Director |
| **Ship** | Render the actual image (video best-effort) for the concept | `produce.ts` / `video.ts` → Atuona pipeline |

The analysis pipeline runs **unattended every morning** (cron, Panama time): `capture → classify → brief → concept → backup`.

---

## Why this is defensible (honest moat — nothing is "uncopyable")

1. **Cross-platform angle unification** — one ontology applied across platforms. Incumbents are platform-siloed because unifying transparency surfaces is tedious, not impossible. We do the tedious part.
2. **A live, accumulating time-series**, started Day 0. No contest entrant can backfill a continuous angle-movement record at submission. (Incumbents with multi-year archives *could* backfill retroactively — so this is a first-mover continuous-observation + demo advantage, not a permanent market moat.)
3. **It's an agent on a production fleet**, not a SaaS dashboard — health-checked, log-verified, resilient.

**Signal honesty (removes the killer probes):**
- Lead with **rising-entrant velocity** (additions to public libraries are observable and unambiguous).
- A **launch proxy** (from Meta "Started running on" dates) shows momentum from a single snapshot, before the 7-day window matures.
- Treat **ad disappearances as low-confidence** — public libraries show only *active* ads, so an exit may be a pause, not abandonment. We never headline a decay claim on exits.
- **Freeze the angle taxonomy per `angle_version`**; compare deltas only within a version, so velocity is real signal, not reclassification drift.
- **Thin-sample guard:** never call an actionable ENTER on a lane with fewer than 2 advertisers.

---

## Data sources (honest, per platform)

| Platform | Method | Status |
|---|---|---|
| **Meta Ad Library** | Bright Data Scraping Browser + LLM extraction | ✅ **Solid spine** — 100+ ads/day across 5 verticals |
| **Google Search ads** | Bright Data SERP API (`top_ads`/`bottom_ads`) | ⚠️ **Best-effort** — Google's paid block is auction-timed and intermittently returned; the collector parses it correctly and unifies it into the radar *when present* (verified with real advertisers, e.g. Progressive), but Google does not reliably surface ads on demand |
| TikTok / Taboola | — | 🔜 documented next |

The architecture is cross-platform; **Meta is the reliable live spine.** Google is wired and fires when its ad block appears — stated plainly rather than overclaimed.

---

## Resilience — "Atlas shrugs"

Atlas shrugs off provider outages and still ships. All proven live *during this build*:
- **LLM:** 4-tier failover `Claude → Groq → OpenAI → Grok`. Anthropic credits died mid-build; Atlas finished on OpenAI. Grok green-tested.
- **Image:** `Flux (Replicate) → OpenAI images`. Replicate ran out of credit; Atlas shipped the EspaLuz image via `gpt-image-1`.
- **Video:** `Runway → Luma`, models env-overridable. (Both accounts currently dry → the still image stands; honest fallback, no crash.)
- **Storage:** the JSONL log is the source of truth; `radar.sqlite` is a disposable projection rebuilt from it — a corrupt projection can never harm the irreplaceable time-series. The JSONL is backed up off-VM daily.

Every Atlas Daily Brief footer reports which tiers are armed — the shrug is a feature you can see.

---

## The frozen angle ontology (v1)

`pain_point` · `social_proof` · `urgency_scarcity` · `authority` · `curiosity_gap` · `transformation` · `fear_loss` · `novelty`

---

## Required answers

**What does this tool do?**
A cross-platform angle-window radar for affiliate media buying. It reads public ad-transparency data (Meta solid, Google best-effort), classifies every active ad into a frozen taxonomy of creative angles, and tracks the velocity of advertiser entry per angle per vertical — surfacing ENTER (open windows), WATCH (heating), AVOID (saturating), each with a clickable evidence trail and live momentum. For the top opportunity it generates an evidence-grounded creative concept and renders the asset. Public data only.

**Why this one?**
Because every tool surfaces *proven winners*, which herds every buyer into the crowding angle. For an affiliate operation buying across platforms where ROI is everything, the lever is *timing the open window* — and closing the loop into creative. I led with the observable rising-entrant signal so every number survives a follow-up, and wired it into generation so it drives production, not just a dashboard.

**What would you build next?**
Finish TikTok + Taboola so all four platforms share one ontology; a landing-page message-match layer (score where ad promise and LP diverge); and the Atlas Intelligence Layer — creative half-life, opportunity-cost-of-waiting, and accumulated market memory that turns snapshots into compounding intelligence. I run this exact agent pattern in production at AIdeazz today, where the same loop generates EspaLuz creative for my own marketing engine.

---

## Run it

```bash
cp .env.example .env        # ANTHROPIC/GROQ/OPENAI/XAI + BRIGHTDATA_* + REPLICATE + RUNWAY/LUMA
npm install && npm run build
npm run capture                  # observe → captures.jsonl
npm run classify                 # → radar.sqlite (angle_snapshots + angle_daily_agg)
npm run brief                    # Atlas Daily Brief
npm run concept expat_language   # evidence-grounded creative concept
npm run produce expat_language   # render the image
npm run video   expat_language   # render the video (best-effort)
npm start                        # serve the dashboard (:8095)
```

Production discipline carried from the AIdeazz fleet: green build → swap, secrets isolated in `.env`, verify from logs not config, no silent failures, public/transparency-mandated data only.

_Built by Elena Revicheva · [AIdeazz](https://aideazz.xyz). You own your code — this engine doubles as an AIdeazz marketing capability regardless of outcome._
