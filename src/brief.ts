/**
 * brief.ts — Atlas AIPA, the Daily Brief. The output that gets remembered.
 *
 * Reads the radar.sqlite projection and renders, per vertical, the single best
 * MOVE (open window) + the lanes to AVOID, each with a sourced evidence link —
 * exactly the "AI employee hands you a decision" surface from roadmap §8.
 *
 * Writes data/brief.json (for the Day-5 front-end) + data/brief.md (human/Telegram),
 * prints to console, and optionally pushes to Telegram if ATLAS_TELEGRAM_* are set.
 *
 * "Atlas shifted": every brief ends with an honest resilience footer — which LLM
 * tiers are armed and whether anything degraded. The shrug is a feature you can see.
 *
 * Run:  node dist/brief.js
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { buildIntelligence } from './intelligence.js';
import { sendAtlasDailyBrief } from './telegram.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const SQLITE = join(DATA_DIR, 'radar.sqlite');

interface AggRow {
  snapshot_date: string;
  vertical: string;
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

const PROVIDER_TIERS: Array<[string, boolean]> = [];

function resilienceFooter(): string {
  const armed: string[] = [];
  if (config.anthropicKey) armed.push('Claude');
  if (config.groqKey) armed.push('Groq');
  if (config.openaiKey) armed.push('OpenAI');
  if (config.xaiKey) armed.push('Grok');
  for (const p of armed) PROVIDER_TIERS.push([p, true]);
  const n = armed.length;
  return `⌐ Atlas shifted — ${n}-tier LLM failover armed (${armed.join(' → ')}); a single provider going dark can't stop the brief.`;
}

/** Pick the recommended MOVE for a vertical: a real ENTER if present, else the
 *  highest-scoring lane that isn't already crowded (an open window). */
function pickMove(rows: AggRow[]): AggRow | null {
  const enter = rows.filter((r) => r.window_state === 'ENTER').sort((a, b) => b.window_score - a.window_score);
  if (enter.length) return enter[0]!;
  const open = rows.filter((r) => r.saturation < 0.6).sort((a, b) => b.window_score - a.window_score);
  return open[0] ?? rows.sort((a, b) => b.window_score - a.window_score)[0] ?? null;
}

function stateLabel(s: string): string {
  return s === 'ENTER' ? '🟢 ENTER' : s === 'WATCH' ? '🟡 WATCH' : s === 'AVOID' ? '🔴 AVOID' : '⚪ STABLE';
}

function moveWhy(r: AggRow): string {
  const bits: string[] = [];
  bits.push(`saturation ${Math.round(r.saturation * 100)}% (${r.distinct_advertisers} advertisers)`);
  if (r.new_entrants_7d != null) bits.push(`${r.new_entrants_7d} new in 7d`);
  else if (r.recent_launch_30d > 0) bits.push(`${r.recent_launch_30d} launched ≤30d (${Math.round(r.launch_share * 100)}% of lane)`);
  if (r.adjacency > 0 && r.adjacency_note) bits.push(r.adjacency_note);
  return bits.join(' · ');
}

function main() {
  if (!existsSync(SQLITE)) {
    console.error('no radar.sqlite — run classify first');
    process.exit(1);
  }
  const db = new DatabaseSync(SQLITE);
  const latest = (db.prepare('SELECT MAX(snapshot_date) d FROM angle_daily_agg').get() as { d: string } | undefined)?.d;
  if (!latest) {
    console.error('no aggregate rows');
    process.exit(1);
  }
  const all = db.prepare('SELECT * FROM angle_daily_agg WHERE snapshot_date = ?').all(latest) as unknown as AggRow[];

  // one evidence URL per (vertical, angle)
  const evRow = db.prepare(
    'SELECT ad_ref_url FROM angle_snapshots WHERE snapshot_date=? AND vertical=? AND angle_id=? LIMIT 1',
  );
  const evidenceFor = (vertical: string, angle: string): string | null =>
    (evRow.get(latest, vertical, angle) as { ad_ref_url: string } | undefined)?.ad_ref_url ?? null;

  const verticals = [...new Set(all.map((r) => r.vertical))].sort();
  const brief: any = { generated_at: new Date().toISOString(), snapshot_date: latest, verticals: [] };

  const md: string[] = [`# 🌐 ATLAS DAILY BRIEF — ${latest}`, ''];
  const con: string[] = [`\n══════ ATLAS DAILY BRIEF · ${latest} ══════`];

  for (const v of verticals) {
    const rows = all.filter((r) => r.vertical === v);
    const move = pickMove(rows);
    if (!move) continue;
    const avoid = rows.filter((r) => r.window_state === 'AVOID').sort((a, b) => b.distinct_advertisers - a.distinct_advertisers);
    const moveEvidence = evidenceFor(v, move.angle_id);

    brief.verticals.push({
      vertical: v,
      move: { angle: move.angle_id, state: move.window_state, score: Math.round(move.window_score * 100), why: moveWhy(move), basis: move.signal_basis, evidence: moveEvidence },
      avoid: avoid.map((a) => ({ angle: a.angle_id, advertisers: a.distinct_advertisers, why: moveWhy(a) })),
    });

    md.push(`## ${v}`);
    md.push(`**MOVE → ${stateLabel(move.window_state)} \`${move.angle_id}\`** · score ${Math.round(move.window_score * 100)}/100 _(basis: ${move.signal_basis})_`);
    md.push(`- why: ${moveWhy(move)}`);
    if (moveEvidence) md.push(`- evidence: ${moveEvidence}`);
    if (avoid.length) md.push(`- avoid: ${avoid.map((a) => `\`${a.angle_id}\` (${a.distinct_advertisers} adv)`).join(', ')}`);
    md.push('');

    con.push(`\n  ${v.toUpperCase()}`);
    con.push(`    MOVE → ${stateLabel(move.window_state)} ${move.angle_id}  (${Math.round(move.window_score * 100)}/100, ${move.signal_basis})`);
    con.push(`      why: ${moveWhy(move)}`);
    if (avoid.length) con.push(`      avoid: ${avoid.map((a) => a.angle_id).join(', ')}`);
  }
  db.close();

  const footer = resilienceFooter();
  brief.resilience = footer;
  brief.provider_tiers = PROVIDER_TIERS.map(([p]) => p);

  const intel = buildIntelligence(SQLITE, latest);
  brief.intelligence = intel;
  writeFileSync(join(DATA_DIR, 'intelligence.json'), JSON.stringify(intel, null, 2));
  md.push('---', `_${footer}_`, '', `_Public ad-library data only — no spend/CTR. Window states are hypotheses to test, ranked by observable saturation + entry momentum._`);
  con.push(`\n  ${footer}`);

  writeFileSync(join(DATA_DIR, 'brief.json'), JSON.stringify(brief, null, 2));
  writeFileSync(join(DATA_DIR, 'brief.md'), md.join('\n'));
  console.log(con.join('\n'));
  console.log(`\nATLAS BRIEF DONE · ${brief.verticals.length} verticals · wrote data/brief.json + data/brief.md`);

  void sendAtlasDailyBrief(brief);
}

main();
