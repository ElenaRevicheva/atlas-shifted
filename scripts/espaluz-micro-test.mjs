#!/usr/bin/env node
/**
 * EspaLuz Meta micro-test kit — pulls live expat_language concept from Atlas API.
 * Run: node scripts/espaluz-micro-test.mjs
 *      ATLAS_API=https://webhook.aideazz.xyz/whitespace node scripts/espaluz-micro-test.mjs
 */
const BASE = (process.env.ATLAS_API || 'http://127.0.0.1:8095').replace(/\/$/, '');
const ASSET_BASE = `${BASE}`;

async function main() {
  const r = await fetch(`${BASE}/api/atlas`);
  if (!r.ok) throw new Error(`Atlas API ${r.status}`);
  const d = await r.json();
  const c = d.concepts?.expat_language;
  if (!c) {
    console.error('No expat_language concept — run: npm run concept expat_language');
    process.exit(1);
  }
  const cc = c.concept || {};
  const tr = c.tracking || {};
  const move = c.move || {};
  const img = c.asset?.image_file ? `${ASSET_BASE}/${c.asset.image_file}` : null;
  const vid = c.video?.video_file ? `${ASSET_BASE}/${c.video.video_file}` : null;

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  EspaLuz × Atlas — Meta micro-test kit (expat_language)         ║
╚══════════════════════════════════════════════════════════════════╝

PRODUCT     EspaLuz — AI bilingual tutor on WhatsApp/Telegram
VERTICAL    expat_language · angle: ${move.angle} (${move.score}/100 ${move.state})
CONCEPT_ID  ${tr.concept_id || 'expat_language_unknown'}

── META AD SETUP (suggested $25–50 / 5 days) ──
Objective:  Traffic or Leads (link clicks → WhatsApp/Telegram)
Geo:        US (+ optional UK/CA expats)
Interests:  expat, relocation, learn Spanish, move abroad
Placement:  Feed + Reels (use video if available)

── PRIMARY TEXT ──
${cc.primary_text || '(generate concept first)'}

── HEADLINE ──
${cc.headline || cc.hook || ''}

── DESCRIPTION ──
${cc.hook || ''}

── CTA BUTTON ──
Learn More → ${tr.landing_url || 'https://aideazz.xyz/#espaluz'}

── LANDING URL (paste into Meta — includes full tracking) ──
${tr.landing_url || ''}

── CREATIVE ASSETS ──
Image:  ${img || 'missing — npm run produce expat_language'}
Video:  ${vid || 'missing — npm run video expat_language'}

── CONVERSION TRACKING ──
• Form leads on aideazz.xyz → auto-sync to Atlas (utm_campaign=atlas_expat_language)
• WhatsApp/Telegram trial → check /espaluz in Telegram bot; POST spend manually:
  curl -X POST https://webhook.aideazz.xyz/cto/api/performance-event \\
    -H "Authorization: Bearer \$OUTREACH_SECRET" \\
    -H "Content-Type: application/json" \\
    -d '{"source":"meta_ads","concept_id":"${tr.concept_id}","vertical":"expat_language","angle_id":"${move.angle}","metrics":{"spend":25,"clicks":0}}'

── A/B HOOKS (duplicate ad set, swap hook only) ──
${(c.mutations || []).map((m, i) => `V${i + 2} (${m.emotion}): ${m.hook}`).join('\n') || '(no mutations)'}

Refresh Atlas card after spend/leads: ${BASE.replace(/\/$/, '')}/atlas.html
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
