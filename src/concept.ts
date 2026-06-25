/**
 * concept.ts — Atlas AIPA, Layer 3: the Creative Director.
 *
 * Closes the loop from DETECT → CREATE. For a vertical's top open-window angle,
 * it grounds a fresh creative concept in the REAL winning ads of the adjacent
 * heating lane (the proven psychology to borrow), and emits a structured brief
 * the Atuona Producer can render (image → video). This is the "radar generates
 * the creative" differentiator — and, pointed at expat_language, the EspaLuz
 * dogfood engine.
 *
 * Honesty: the concept is visibly derived from cited evidence (real ad excerpts +
 * public-library links), not a generic "write me 5 headlines" call.
 *
 * Run:  node dist/concept.js              (defaults to expat_language — the dogfood)
 *       node dist/concept.js auto_insurance
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { llmJson, activeLlmLabel } from './llm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const SQLITE = join(DATA_DIR, 'radar.sqlite');
const OUT = join(DATA_DIR, 'concepts.json');

/** Per-vertical brand context so the concept lands on-brand (esp. the dogfood). */
const BRAND_CONTEXT: Record<string, string> = {
  expat_language:
    'EspaLuz — an AI bilingual (Spanish/English) tutor and relocation assistant on WhatsApp/Telegram, helping expat families across 21 Spanish-speaking countries overcome the anxiety of moving abroad without speaking the language.',
};

interface AggRow {
  angle_id: string;
  distinct_advertisers: number;
  new_entrants_7d: number | null;
  recent_launch_30d: number;
  launch_share: number;
  saturation: number;
  adjacency: number;
  window_state: string;
  window_score: number;
  signal_basis: string;
  adjacency_note: string | null;
}
interface SnapRow {
  advertiser_name: string;
  ad_text: string;
  ad_ref_url: string;
  confidence: number;
}
interface Concept {
  concept_name: string;
  emotion: string;
  hook: string;
  headline: string;
  primary_text: string;
  scene_concept: string;
  cta: string;
  image_prompt: string;
}

function pickMove(rows: AggRow[]): AggRow | null {
  const enter = rows.filter((r) => r.window_state === 'ENTER').sort((a, b) => b.window_score - a.window_score);
  if (enter.length) return enter[0]!;
  const open = rows.filter((r) => r.saturation < 0.6).sort((a, b) => b.window_score - a.window_score);
  return open[0] ?? rows.sort((a, b) => b.window_score - a.window_score)[0] ?? null;
}

function heatingFromNote(note: string | null): string | null {
  const m = note?.match(/heating (\w+)/);
  return m ? m[1]! : null;
}

const EMPTY: Concept = {
  concept_name: '', emotion: '', hook: '', headline: '', primary_text: '', scene_concept: '', cta: '', image_prompt: '',
};

async function main() {
  if (!existsSync(SQLITE)) {
    console.error('no radar.sqlite — run classify first');
    process.exit(1);
  }
  const vertical = (process.argv[2] || 'expat_language').trim();
  const db = new DatabaseSync(SQLITE);
  const latest = (db.prepare('SELECT MAX(snapshot_date) d FROM angle_daily_agg').get() as { d: string } | undefined)?.d;
  if (!latest) {
    console.error('no aggregate rows');
    process.exit(1);
  }

  const aggRows = db.prepare('SELECT * FROM angle_daily_agg WHERE vertical=? AND snapshot_date=?').all(vertical, latest) as unknown as AggRow[];
  if (aggRows.length === 0) {
    console.error(`no data for vertical "${vertical}"`);
    process.exit(1);
  }
  const move = pickMove(aggRows)!;
  const heating = heatingFromNote(move.adjacency_note);

  // Grounding evidence: real winning ads from the move angle + the adjacent heating lane.
  const pull = db.prepare(
    'SELECT advertiser_name, ad_text, ad_ref_url, confidence FROM angle_snapshots WHERE vertical=? AND snapshot_date=? AND angle_id=? ORDER BY confidence DESC LIMIT 3',
  );
  const groundAngles = [move.angle_id, ...(heating ? [heating] : [])];
  const evidence: Array<{ angle: string; advertiser: string; excerpt: string; url: string }> = [];
  for (const ang of groundAngles) {
    for (const r of pull.all(vertical, latest, ang) as unknown as SnapRow[]) {
      evidence.push({ angle: ang, advertiser: r.advertiser_name, excerpt: r.ad_text.slice(0, 280), url: r.ad_ref_url });
    }
  }
  db.close();

  const brand = BRAND_CONTEXT[vertical];
  const evidenceBlock = evidence
    .map((e, i) => `${i + 1}. [${e.angle} · ${e.advertiser}] "${e.excerpt}"`)
    .join('\n');

  const { value: concept, provider } = await llmJson<Concept>(
    `You are a direct-response creative director.${brand ? ` The brand is ${brand}` : ''}

Atlas detected an OPEN WINDOW in the "${vertical}" market: the **${move.angle_id}** angle is low-saturation${heating ? `, but its advertisers also run the HEATING **${heating}** angle (live, growing demand)` : ''}. The play is to enter the open ${move.angle_id} lane while borrowing the proven persuasion psychology that's already converting nearby.

REAL ADS CURRENTLY RUNNING (your grounding — borrow what works, do not copy verbatim):
${evidenceBlock || '(none available)'}

Craft ONE fresh creative concept for the open **${move.angle_id}** angle${brand ? ', on-brand for the brand above' : ''}. Ground the emotion and hook in the evidence. Be compliant (no false claims, no guaranteed outcomes). Return ONLY JSON:
{
  "concept_name": "short memorable name",
  "emotion": "the single emotion it owns",
  "hook": "the 1-line scroll-stopping opener",
  "headline": "<=60 chars",
  "primary_text": "1-2 punchy sentences",
  "scene_concept": "one vivid sentence describing the hero VISUAL to generate (for image+video)",
  "cta": "short CTA",
  "image_prompt": "a detailed text-to-image prompt to render the hero visual"
}`,
    { fallback: EMPTY, maxTokens: 1200 },
  );

  const out = {
    vertical,
    snapshot_date: latest,
    generated_at: new Date().toISOString(),
    move: { angle: move.angle_id, state: move.window_state, score: Math.round(move.window_score * 100), signal_basis: move.signal_basis, adjacency_note: move.adjacency_note },
    heating_lane: heating,
    grounding_evidence: evidence,
    concept,
    producer_brief: {
      // exactly what the Atuona pipeline consumes (text -> Flux image -> Luma/Runway video)
      image_prompt: concept.image_prompt,
      scene: concept.scene_concept,
      caption: `${concept.headline} — ${concept.primary_text}`,
      angle: move.angle_id,
      vertical,
    },
    llm_provider: provider,
  };

  // Persist as a map keyed by vertical so multiple verticals accumulate.
  let all: Record<string, unknown> = {};
  if (existsSync(OUT)) {
    try {
      all = JSON.parse(readFileSync(OUT, 'utf8')) as Record<string, unknown>;
    } catch {
      /* start fresh */
    }
  }
  // Preserve any already-rendered asset/video so the daily concept re-run doesn't
  // wipe generated creative (produce/video merge into this same entry).
  const prev = (all[vertical] || {}) as { asset?: unknown; video?: unknown };
  all[vertical] = {
    ...out,
    ...(prev.asset ? { asset: prev.asset } : {}),
    ...(prev.video ? { video: prev.video } : {}),
  };
  writeFileSync(OUT, JSON.stringify(all, null, 2));

  console.log(`\n══════ ATLAS CREATIVE CONCEPT · ${vertical} · ${latest} ══════`);
  console.log(`  OPEN WINDOW: ${move.angle_id} (${out.move.score}/100, ${move.signal_basis})${heating ? ` · adjacent to heating ${heating}` : ''}`);
  console.log(`  grounded in ${evidence.length} real ads (${activeLlmLabel()} via ${provider})\n`);
  console.log(`  CONCEPT: ${concept.concept_name}  [owns: ${concept.emotion}]`);
  console.log(`  HOOK:    ${concept.hook}`);
  console.log(`  HEAD:    ${concept.headline}`);
  console.log(`  BODY:    ${concept.primary_text}`);
  console.log(`  SCENE:   ${concept.scene_concept}`);
  console.log(`  CTA:     ${concept.cta}`);
  console.log(`\n  → producer_brief written for Atuona (image_prompt + scene + caption)`);
  console.log(`ATLAS CONCEPT DONE · wrote data/concepts.json[${vertical}]`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
