# Atlas Shifted — What We Built (Plain English)

**For:** vibe coders, judges, and anyone who wants the truth without engineer-speak  
**Contest:** [It's Today Media $5,000 Build Challenge](https://www.itstoday.media/) — submit by **July 4, 2026**  
**Live demo:** https://webhook.aideazz.xyz/whitespace/atlas.html  
**On-demand tool:** https://webhook.aideazz.xyz/whitespace/  
**Repo:** https://github.com/ElenaRevicheva/atlas-shifted  

---

## The one-sentence version

Atlas is a bot that **watches real ads in public libraries every day**, figures out **which marketing angle is getting crowded vs. still open**, writes a **campaign concept grounded in those real ads**, and **generates an image + video** for the best opportunity — so a media buyer goes from “what’s happening in the market?” to “here’s something we can test” in minutes, not days.

---

## What was done

| Piece | What it actually does | Status (honest) |
|-------|----------------------|-----------------|
| **Daily capture** | Pulls live ads from Meta Ad Library (+ some Google search ads) for 5 verticals, saves every ad to a log file | ✅ **Works** — 286+ ads, 2 snapshot days (Jun 25–26), solar retry fixed |
| **Classifier** | Sorts each ad into 8 angle types (pain, social proof, urgency, etc.) using AI embeddings | ✅ **Works** |
| **Radar board** | Shows each vertical with ENTER / WATCH / AVOID / STABLE labels and scores | ✅ **Works** — live on atlas.html |
| **Daily brief** | Picks the best “MOVE” per vertical with reasons | ✅ **Works** |
| **Creative Director** | Writes hook, headline, body, scene — tied to real ads it saw | ✅ **Works** — expat_language + auto_insurance done |
| **Producer (Atuona)** | Makes a real `.jpg` image + `.mp4` video for concepts | ✅ **Works** — both files load in browser |
| **Whitespace finder** | You type any vertical → live ad scan → battle plan in ~1–2 min | ✅ **Works** — tested with “solar”, got 12 live Meta ads |
| **Morning cron** | Runs capture → classify → brief → concept → backup without you | ✅ **Scheduled** — 9 AM Panama daily; auto-retry pass for failed verticals |
| **Telegram brief** | Daily MOVE summary pushed to Telegram after brief | ✅ **Works** — send-only, no polling conflict |
| **Meta capture hardening** | 3 retries, 90s timeout, solar-first, Scraping Browser CDP when configured | ✅ **Deployed** — see `docs/BRIGHTDATA_BROWSER_SETUP.md` for max reliability |
| **Off-VM backup** | Pushes the log to private `atlas-captures` repo | ✅ **In cron script** — verify commits on GitHub |
| **7-day velocity charts** | Sparklines showing angle momentum over time | ❌ **Not built yet** — needs more days of data first |
| **TikTok / Taboola** | More ad platforms | ❌ **Not in this build** — on the roadmap |

---

## Why it was done

**The contest asks:** build a real tool that helps a **media buying team** make more money. Not a slide deck. Not a ChatGPT wrapper.

**The problem Atlas targets:** Most ad spy tools show you the ad that’s **already winning**. Everyone copies it. The angle gets crowded. Margins die.

Atlas does the opposite: it looks for the angle that’s **adjacent to what’s heating up** but **not saturated yet** — the whitespace — and then **generates creative for that gap**.

**Why Elena built it:** She already runs 9+ live AI agents on Oracle for her own company (AIdeazz). Atlas is the same “agent that runs itself” pattern, pointed at affiliate/media-buying work — and it doubles as her own marketing engine (EspaLuz expat-language vertical is the dogfood).

---

## How it was done (no magic, just steps)

Think of it like a daily morning routine for a robot employee:

```
1. CAPTURE  →  go scrape public ad libraries, save every ad to captures.jsonl
2. CLASSIFY →  AI reads ad copy, tags it with an angle type, save to radar.sqlite
3. SCORE    →  math: how many advertisers? who's new? what's crowded? → ENTER/WATCH/AVOID
4. BRIEF    →  pick the best move per vertical, write brief.json
5. CONCEPT  →  LLM writes campaign copy using REAL ad excerpts as proof
6. PRODUCE  →  Flux/OpenAI makes image, Runway/Luma makes video
7. BACKUP   →  push log to GitHub so you never lose the time-series
```

**Where it lives:**
- Code: this repo (`atlas-shifted`)
- Server: Oracle VM `170.9.242.90`, PM2 app `whitespace`, port 8095
- Public URL: nginx → `webhook.aideazz.xyz/whitespace/`

**What it reads (public only):**
- Meta Ad Library via Bright Data
- Google search ads (best-effort — Google doesn’t always show ads)
- No private ad accounts, no spend data, no CTR — because those aren’t public

**AI providers (with failover):**
- Claude → Groq → OpenAI → Grok for text
- OpenAI embeddings for classification
- Flux / OpenAI for images; Runway / Luma for video

If one provider dies (Anthropic credits ran out mid-build), the next one picks up. That’s proven — not just planned.

---

## Why it’s different from what’s out there

| Typical tool (Foreplay, Atria, Motion, etc.) | Atlas |
|---------------------------------------------|-------|
| Shows winning creatives on **one platform** | Same angle taxonomy across **Meta + Google** (more coming) |
| “Copy this ad” | “Here’s the **open angle** next to what’s heating up” |
| Dashboard you stare at | **Agent** that runs every morning + generates assets |
| Stops at research | **Closes the loop** → concept + image + video |
| Black-box “AI insights” | Every claim links to **public ad library URLs** you can click |

**What we do NOT claim (on purpose):**
- We don’t know spend, CTR, or ROAS (public libraries don’t have that)
- We **detect** what’s accelerating **now** — we do **not predict** the future (that’s v2 roadmap)
- Nothing is “uncopyable forever” — our edge is **doing the tedious cross-platform work + running it daily + closing the creative loop**

---

## Does it really fit the contest?

**Yes — with honest framing.** Here’s the match:

| Contest wants | Atlas delivers |
|---------------|----------------|
| Real tool for media buying team | ✅ Angle radar + battle plan + ad copy |
| Something that solves a real problem | ✅ “Stop copying saturated winners; find open windows” |
| It actually works | ✅ Live URLs, real ads, real generated video |
| Live demo URL | ✅ atlas.html + whitespace finder |
| GitHub repo | ✅ This repo |
| README with 3 questions | ✅ In README.md |
| AI tools encouraged | ✅ Built with Claude/Cursor + multi-LLM runtime |

**Where to be careful in your pitch:**
- Don’t say “10 days of sparklines” yet — you have **1 day** of data as of Jun 26 morning (Day 0 was Jun 25; cron adds a day each morning)
- Don’t say “predicts the market” — say **detects momentum**
- Don’t oversell Google — it’s wired but thin (9 ads vs 184 Meta)
- Don’t claim TikTok/Taboola — not built

**Realistic grade:** Strong submission for “working demo + clear media-buying value.” Not a finished SaaS product — and the contest doesn’t require that.

---

## Iron-clad proof (verified Jun 26, 2026)

These were checked against the **live server**, not just the code:

| Proof | Result |
|-------|--------|
| Health check `GET /healthz` | `ok: true`, Bright Data on, LLM on |
| PM2 `whitespace` on Oracle | **online**, 18h+ uptime |
| `captures.jsonl` | **189 lines** (184 Meta, 9 Google) |
| `radar.sqlite` | **5 verticals**, snapshot **2026-06-25** |
| `brief.json` | **5 verticals** with MOVE recommendations |
| `concepts.json` | **expat_language** + **auto_insurance** with hooks, headlines, evidence |
| Image `assets/expat_language.jpg` | **HTTP 200** |
| Video `assets/expat_language.mp4` | **HTTP 200** (~2.2 MB) |
| Whitespace run `?vertical=solar` | **12 live Meta ads** captured, full pipeline completed |
| Cron script | Runs daily 9 AM Panama: capture → classify → brief → concept → backup |

**Concept example (real output, not made up):**
- Vertical: `expat_language`
- Concept name: **“The Overheard Sentence”**
- Hook: *“She understood every word they said about her — and said nothing.”*
- Evidence: **3 links** to Facebook Ad Library
- Files: `expat_language.jpg` + `expat_language.mp4` on server

---

## How to check it yourself (click by click)

No terminal needed. Just a browser.

### Test 1 — Is the bot alive? (10 seconds)

1. Open: https://webhook.aideazz.xyz/whitespace/healthz  
2. You should see JSON with `"ok": true`  
3. If `"ok": false` → something is broken, don’t submit yet

### Test 2 — The radar dashboard (2 minutes)

1. Open: https://webhook.aideazz.xyz/whitespace/atlas.html  
2. Top row: **days tracked**, **ads in radar**, **verticals**, **snapshot date**  
3. Scroll to **Angle Window Radar** — you should see 5 industry cards  
4. Each card has colored badges: **ENTER** (green), **WATCH**, **AVOID**, **STABLE**  
5. Scroll to **Generated creative** — you should see at least **expat_language** with:
   - A concept name (not blank)
   - Hook, Headline, Body filled in
   - A **video or image** that plays/loads
   - **Evidence links** — click one, it should open Facebook Ad Library  
6. **OK if you see:** yellow note about sparklines waiting for more days — that’s honest, not broken

### Test 3 — The “wow” demo for judges (3 minutes)

This is the one you show in the interview.

1. Open: https://webhook.aideazz.xyz/whitespace/  
2. Make sure **“Ad angles · media buyer”** is selected  
3. Click the **`solar`** chip (or type `auto insurance`)  
4. Click **Find the whitespace**  
5. Watch the feed — should say things like “Scanning Meta Ad Library”, “Captured N live units”  
6. Wait **60–90 seconds** — don’t refresh  
7. When done, check:
   - **Recommended whitespace angle** — has a name + explanation
   - **Launch-ready ad copy** — Primary text + Headline boxes filled
   - **Evidence trail** at bottom — clickable links to real ads  
8. **Bad sign:** big yellow box saying “knowledge mode, no live evidence” — retry once; if it keeps happening, Bright Data may be down

### Test 4 — Assets really exist (30 seconds)

1. Open: https://webhook.aideazz.xyz/whitespace/assets/expat_language.mp4  
2. Video should play  
3. Open: https://webhook.aideazz.xyz/whitespace/assets/expat_language.jpg  
4. Image should load  

### Test 5 — Tomorrow morning (proves it runs itself)

After **9:30 AM Panama time**, reload atlas.html.  
**days tracked** should go from 1 → 2.  
If it doesn’t move for 2 days in a row → cron is broken, fix before submit.

---

## What’s NOT done yet (say this out loud if asked)

1. **Sparkline charts** — UI placeholder only; need ~7+ days of daily captures  
2. **Full 7-day velocity** — `new_entrants_7d` is empty until enough days stack up; using “launch proxy” for now  
3. **TikTok + Taboola** — roadmap, not built  
4. **Telegram daily brief** — code exists, only fires if env vars set (optional)  
5. **Duplicate cron lines** on server — harmless but should clean up  

None of these kill the submission. They’re “what’s next,” not “what’s fake.”

---

## The 30-second pitch (memorize this)

> “I build autonomous AI agents in production. For your media team I built Atlas — it watches public ad libraries every day, detects which creative angle is opening before it gets crowded, and generates a test-ready concept plus video for the top opportunity. You can type any vertical into the whitespace finder and get a battle plan with live ad links in under two minutes. Public data only — we detect momentum, we don’t predict the future. Here’s the live demo.”

Then open **atlas.html**, run **solar** on the finder, done.

---

## Files that matter (if you’re poking around the repo)

| File | What it is |
|------|-----------|
| `src/capture.ts` | Daily ad scraping → JSONL log |
| `src/classify.ts` | Embeddings + angle tags → SQLite |
| `src/brief.ts` | Daily brief |
| `src/concept.ts` | Creative Director |
| `src/produce.ts` / `src/video.ts` | Image + video generation |
| `src/agent.ts` | On-demand whitespace finder |
| `public/atlas.html` | Radar dashboard |
| `public/index.html` | Whitespace finder UI |
| `scripts/atlas-capture-cron.sh` | Morning cron (on server) |
| `data/captures.jsonl` | The moat — append-only ad log (on server) |

---

## Bottom line

**Is it real?** Yes. Capture, classify, score, concept, image, and video all run on a live server with real public ad data.

**Is it “fully finished”?** No — and it doesn’t need to be by July 4. Sparklines and multi-week velocity are still cooking. The closed loop and live demo are the proof.

**Should you submit?** Yes — if you keep the daily cron running so “days tracked” climbs before submit, and you demo the whitespace finder live. Be honest about what’s v1 vs. what’s next. Judges respect “ugly and functional” over “beautiful and broken.”

---

_Built by Elena Revicheva · [AIdeazz portfolio](https://aideazz.xyz/portfolio) · Last verified: June 26, 2026_
