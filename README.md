# WHITESPACE

**It doesn't generate one more ad. It autonomously mines the _live_ ad market, reverse-engineers _why_ the top creatives convert, and surfaces the high-margin angle nobody is running yet — with a sourced evidence trail.**

An agentic creative-angle intelligence engine. Built for the It's Today Media Build Challenge — and architected to run, unchanged, as a growth weapon for the AIdeazz marketing engine.

🔗 Live demo: _(deploys to https://webhook.aideazz.xyz/whitespace/ — see Deploy below)_

---

## What it does

Performance/affiliate media buying lives and dies on one lever: **creative angle**. Winning angles fatigue in days, and the bottleneck is finding the _next_ fresh angle before the current one dies. Everything downstream — the video generator, the landing-page builder — is starved without a steady feed of winning angles, and nobody on the team has time to manually reverse-engineer why competitors' ads are printing money.

WHITESPACE automates that, as an autonomous agent:

1. **Input** a vertical/offer (e.g. `medicare advantage`, `solar`, `auto insurance`).
2. **Recon** — scrapes the live, **public** ad market via Bright Data: **Meta Ad Library** + **TikTok Creative Center**.
3. **Vision deconstruction** — Claude vision decomposes each top creative into structured **Angle DNA**: hook archetype, emotional lever, claim, visual pattern, CTA, persona, and the mechanism that makes it convert.
4. **Clustering + whitespace** — maps the **crowded lanes** (what everyone is running), then finds the **whitespace**: proven-_adjacent_ angles nobody is running yet — borrowing psychology that's already converting, aimed at an unworked persona or emotion.
5. **Battle plan** — the recommended net-new angle + launch-ready ad copy + a landing-page hook + the **sourced evidence trail** of live ads that justify the bet.

The whole thing runs on **public data**, so it works on day one with **zero access** to your ad accounts — the live demo is real, not a mock.

### Why this, and not a dashboard or a creative generator

The role page already lists a video creative generator, an ad-upload MCP, and a landing-page/CMS in progress. A dashboard or another generator would be redundant — and is what most submissions will build. WHITESPACE deliberately sits **upstream** of all of them: it produces the one input they can't generate themselves — _which angle to run next_ — and hands a ready brief straight into them.

---

## Two modes, one engine (the AIdeazz reuse)

The core — recon → vision → cluster → **whitespace** — is brand- and vertical-agnostic. Only the final synthesis is audience-specific, switched by one flag:

| | `media_buyer` mode | `content` mode |
|---|---|---|
| **Recon** | Meta Ad Library + TikTok Creative Center | Google SERP + competitor content/positioning |
| **Finds** | the ad angle nobody runs | the content angle nobody publishes |
| **Output** | ad copy + landing-page hook | blog brief + LinkedIn/IG/X atoms + HubSpot campaign angle |

`content` mode makes the same whitespace IP a GEO/SEO + creative-angle weapon for the [AIdeazz](https://aideazz.xyz) marketing engine — finding the angle competitors aren't publishing and feeding it into the blog + Buffer + HubSpot pipeline.

---

## Architecture

```
vertical ─▶ recon ─▶ vision deconstruction ─▶ clustering + whitespace ─▶ synthesis
            (Bright Data)   (Claude vision)        (LLM)                 ├─ battle plan  (media_buyer)
                                                                         └─ content brief (content)
```

| File | Responsibility |
|---|---|
| `src/agent.ts` | Orchestrator — streams progress (SSE), threads `RunMode` through a shared core |
| `src/brightdata.ts` | Live recon: Web Unlocker + SERP + Scraping Browser (adapted from the AIdeazz fleet's proven layer) |
| `src/ad-sources.ts` | Ad-library recon (media_buyer) + competitor-content recon (content) |
| `src/vision.ts` | Claude-vision deconstruction of each creative → Angle DNA |
| `src/angles.ts` | Cluster the angle landscape + detect whitespace (the core IP) |
| `src/battle-plan.ts` | media_buyer synthesis — ad copy + LP hook + evidence |
| `src/content-brief.ts` | content synthesis — blog brief + social atoms + HubSpot angle |
| `src/llm.ts` | Resilient LLM layer: Claude → Groq → OpenAI (text), Claude → OpenAI (vision) |
| `src/server.ts` | Express + SSE live demo; `src/cli.ts` headless runner |
| `public/index.html` | Single-page live UI |

**Resilience by design:** every LLM call degrades Claude → Groq → OpenAI so a single dead/capped provider can't kill a run. If Bright Data isn't configured, the run still completes via an LLM market-knowledge pass — **clearly flagged** (`meta.degraded = true`); synthesized angles are never presented as scraped evidence.

---

## Run it

```bash
cp .env.example .env        # add ANTHROPIC_API_KEY (+ optionally GROQ/OPENAI, BRIGHTDATA_*)
npm install
npm run build

# Web (live demo):
npm start                   # → http://localhost:8095

# Headless:
node dist/cli.js "medicare advantage"                 # media_buyer mode
node dist/cli.js "ai marketing agency" --content      # AIdeazz content mode
node dist/cli.js "solar" --json                       # raw JSON deliverable
```

### Environment

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude (vision deconstruction + synthesis) — primary |
| `GROQ_API_KEY` / `OPENAI_API_KEY` | resilient fallbacks |
| `BRIGHTDATA_API_TOKEN` + `BRIGHTDATA_ZONE` | live public ad-market recon (Web Unlocker zone) |
| `WHITESPACE_MAX_CREATIVES` | creatives analyzed per run (default 12) |

---

## What I'd build next

- **Creative-fatigue early warning** — track angle saturation over time; alert before a winning angle dies.
- **Auto-brief the generators** — push the battle plan straight into the video creative generator + LP/CMS via MCP, closing the loop angle → asset.
- **Policy pre-flight** — score a generated creative + LP against Meta/Google/TikTok ad policy to predict account-ban risk before upload (arbitrage's #1 existential threat).
- **Per-account learning** — fold in the buyer's own historical performance so whitespace bets are ranked by _their_ realized ROAS, not just market signal.

---

_Built by Elena Revicheva · [AIdeazz](https://aideazz.xyz). You own your code — this engine doubles as an AIdeazz marketing capability regardless of outcome._
