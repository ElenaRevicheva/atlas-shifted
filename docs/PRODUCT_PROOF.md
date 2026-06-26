# Atlas Shifted — Product proof (plain English)

**For:** reviewers who want the truth without engineer-speak  
**Live demo:** https://webhook.aideazz.xyz/whitespace/atlas.html  
**On-demand tool:** https://webhook.aideazz.xyz/whitespace/

---

## The one-sentence version

Atlas **watches real ads in public libraries every day**, figures out **which marketing angle is getting crowded vs. still open**, writes a **campaign concept grounded in those real ads**, and **generates an image + video** for the best opportunity — so a media buyer goes from “what’s happening in the market?” to “here’s something we can test” in minutes, not days.

---

## What works today

| Piece | What it does | Status |
|-------|--------------|--------|
| **Daily capture** | Meta Ad Library + Google search ads for 5 verticals | ✅ 290+ ads, 2 snapshot days, Scraping Browser live |
| **Classifier** | 8 angle types via AI embeddings | ✅ Works |
| **Radar board** | ENTER / WATCH / AVOID / STABLE per vertical | ✅ [atlas.html](https://webhook.aideazz.xyz/whitespace/atlas.html) |
| **Daily brief** | Best MOVE per vertical with reasons | ✅ Works + Telegram push |
| **Creative Director** | Hook, headline, body tied to real ads | ✅ expat_language + auto_insurance |
| **Producer** | Real `.jpg` + `.mp4` for concepts | ✅ Files load in browser |
| **Whitespace finder** | Type any vertical → live scan → battle plan | ✅ Tested: `solar` → live Meta ads |
| **Morning cron** | Unattended daily pipeline | ✅ 9 AM Panama |
| **7-day velocity charts** | Sparklines | ⏳ Needs more daily runs (honest) |
| **TikTok / Taboola** | More platforms | 🔜 Roadmap |

---

## Why it exists

Most ad-intelligence tools show the ad that’s **already winning**. Everyone copies it. The angle gets crowded. Margins die.

Atlas finds the angle **adjacent to what’s heating up** but **not saturated yet** — then **generates creative for that gap**.

---

## How it runs (daily)

```
CAPTURE → CLASSIFY → SCORE → BRIEF → CONCEPT → PRODUCE → BACKUP
```

- **Production:** Oracle Cloud VM, PM2, public URL via nginx  
- **Data:** public ad libraries only — no spend, CTR, or ROAS claims  
- **AI:** Claude → Groq → OpenAI → Grok failover (proven in production)

---

## How Atlas compares

| Typical spy tool | Atlas |
|------------------|-------|
| One platform | Meta + Google (TikTok/Taboola next) |
| “Copy this winner” | “Here’s the **open angle** next to what’s heating” |
| Dashboard | **Agent** that runs daily + generates assets |
| Stops at research | Closes loop → concept + image + video |
| Black-box AI | Every claim links to **public ad library URLs** |

---

## Verify yourself (browser only)

1. **Health:** https://webhook.aideazz.xyz/whitespace/healthz → `"ok": true`
2. **Radar:** https://webhook.aideazz.xyz/whitespace/atlas.html → 5 verticals, evidence links, generated creative
3. **Finder:** https://webhook.aideazz.xyz/whitespace/ → type `solar` → **Find the whitespace** → wait ~90s → battle plan + ad links
4. **Assets:** https://webhook.aideazz.xyz/whitespace/assets/expat_language.mp4 (video plays)

---

## What we do not claim

- No spend, CTR, or ROAS (not in public libraries)
- **Detect** momentum now — do **not predict** the future
- Google ads are best-effort; Meta is the reliable spine

---

## 30-second pitch

> “Atlas watches public ad libraries every day, detects which creative angle is opening before it gets crowded, and generates a test-ready concept plus video for the top opportunity. Type any vertical into the whitespace finder and get a battle plan with live ad links in under two minutes. Public data only — we detect momentum, we don’t predict the future.”

---

_Built by Elena Revicheva · [AIdeazz](https://aideazz.xyz) · Last verified: June 26, 2026_
