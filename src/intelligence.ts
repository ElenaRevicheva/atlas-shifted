/**
 * intelligence.ts — Atlas Intelligence Layer (v1).
 *
 * Features competitors don't ship together:
 *   · Alternate Universe — angles NOBODY is running (absence = opportunity)
 *   · Wait Cost — BUILD NOW vs WAIT with honest saturation math
 *   · Half-Life — estimated days before an angle expires
 *   · Market Memory — log of prior ENTER calls (compounding intelligence)
 *
 * All heuristics are documented and honest — no fake "AI predictions."
 */
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const MEMORY = join(DATA_DIR, 'memory.jsonl');

/** Frozen ontology — must match classify.ts v1. */
export const ONTOLOGY_IDS = [
  'pain_point',
  'social_proof',
  'urgency_scarcity',
  'authority',
  'curiosity_gap',
  'transformation',
  'fear_loss',
  'novelty',
] as const;

export interface AggRow {
  snapshot_date: string;
  vertical: string;
  angle_id: string;
  distinct_advertisers: number;
  new_entrants_7d: number | null;
  entry_velocity: number | null;
  recent_launch_30d: number;
  launch_share: number;
  saturation: number;
  adjacency: number;
  window_state: string;
  window_score: number;
  signal_basis: string;
  adjacency_note: string | null;
}

export interface AbsentAngle {
  angle_id: string;
  /** Why absence might be whitespace (plain English). */
  opportunity: string;
  /** Adjacent heating angle borrowing demand, if any. */
  adjacent_heat: string | null;
  priority: number;
}

export interface WaitCost {
  verdict: 'BUILD NOW' | 'WAIT' | 'AVOID';
  /** Estimated saturation increase if you wait ~7 days (heuristic). */
  wait_7d_saturation_delta_pct: number;
  /** Plain reason. */
  reason: string;
}

export interface HalfLife {
  /** Estimated days until lane is crowded (3–90). */
  est_days_remaining: number;
  /** 0–100 — room left before saturation kills the edge. */
  opportunity_remaining_pct: number;
  label: 'fresh' | 'closing' | 'expired';
}

export interface VerticalIntelligence {
  vertical: string;
  absent_universe: AbsentAngle[];
  wait_cost: WaitCost | null;
  half_life: HalfLife | null;
  move_angle: string | null;
}

export interface MemoryEntry {
  logged_at: string;
  snapshot_date: string;
  vertical: string;
  angle_id: string;
  window_state: string;
  window_score: number;
  signal_basis: string;
}

function velocity(row: AggRow): number {
  if (row.entry_velocity != null) return Math.min(1, row.entry_velocity / 1);
  return row.launch_share;
}

/** Alternate Universe: which ontology angles have zero/minimal presence? */
export function absentUniverse(rows: AggRow[]): AbsentAngle[] {
  const present = new Map(rows.map((r) => [r.angle_id, r]));
  const heating = rows.filter((r) => velocity(r) >= 0.4).map((r) => r.angle_id);
  const out: AbsentAngle[] = [];

  for (const id of ONTOLOGY_IDS) {
    const row = present.get(id);
    const count = row?.distinct_advertisers ?? 0;
    if (count >= 2) continue; // not absent

    let adjacentHeat: string | null = null;
    let adjScore = 0;
    for (const h of heating) {
      if (h === id) continue;
      const hRow = present.get(h)!;
      if (hRow && hRow.saturation >= 0.4) {
        adjScore = hRow.saturation;
        adjacentHeat = h;
      }
    }

    const opportunity =
      count === 0
        ? `Zero advertisers on "${id}" — a blank lane while competitors fight elsewhere.`
        : `Only ${count} advertiser on "${id}" — thin but testable whitespace.`;

    out.push({
      angle_id: id,
      opportunity,
      adjacent_heat: adjacentHeat,
      priority: Math.round((adjacentHeat ? 60 : 30) + (1 - (row?.saturation ?? 0)) * 40),
    });
  }

  return out.sort((a, B) => B.priority - a.priority).slice(0, 4);
}

/** Counterfactual Studio v1 — BUILD NOW vs WAIT. */
export function waitCost(move: AggRow | null, rows: AggRow[]): WaitCost | null {
  if (!move) return null;
  const vel = velocity(move);
  const delta = Math.round(vel * 7 * 12); // ~12% saturation per unit velocity per week (heuristic)

  if (move.window_state === 'ENTER' && move.saturation < 0.45) {
    return {
      verdict: 'BUILD NOW',
      wait_7d_saturation_delta_pct: delta,
      reason: `Open window at ${Math.round(move.saturation * 100)}% saturation — waiting ~7d may cost ~${delta}pp saturation as ${move.adjacency_note ? 'adjacent demand' : 'entrants'} arrive.`,
    };
  }
  if (move.window_state === 'AVOID' || (move.window_state === 'WATCH' && move.saturation >= 0.65)) {
    return {
      verdict: 'AVOID',
      wait_7d_saturation_delta_pct: delta,
      reason: `Lane already crowded (${Math.round(move.saturation * 100)}% saturation) — waiting won't help; find adjacent whitespace.`,
    };
  }
  const openAlt = rows.find((r) => r.window_state === 'ENTER' && r.saturation < 0.5);
  if (openAlt && openAlt.angle_id !== move.angle_id) {
    return {
      verdict: 'WAIT',
      wait_7d_saturation_delta_pct: delta,
      reason: `Current move is ${move.window_state} — stronger open window may be "${openAlt.angle_id}" (${Math.round(openAlt.saturation * 100)}% sat).`,
    };
  }
  return {
    verdict: 'BUILD NOW',
    wait_7d_saturation_delta_pct: delta,
    reason: `Best available lane — delay risks ${delta}pp saturation increase from ongoing entrants.`,
  };
}

/** Creative Half-Life v1 — heuristic from saturation + launch momentum. */
export function halfLife(row: AggRow | null): HalfLife | null {
  if (!row || row.distinct_advertisers < 2) return null;
  const vel = velocity(row);
  const room = 1 - row.saturation;
  const opportunity_remaining_pct = Math.round(room * (1 - row.launch_share * 0.5) * 100);
  const est = Math.min(90, Math.max(3, Math.round((room / Math.max(vel, 0.08)) * 14)));
  const label: HalfLife['label'] =
    opportunity_remaining_pct >= 55 ? 'fresh' : opportunity_remaining_pct >= 25 ? 'closing' : 'expired';
  return { est_days_remaining: est, opportunity_remaining_pct, label };
}

export function logMarketMemory(entry: Omit<MemoryEntry, 'logged_at'>): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const line: MemoryEntry = { ...entry, logged_at: new Date().toISOString() };
  appendFileSync(MEMORY, JSON.stringify(line) + '\n');
}

export function readMarketMemory(limit = 20): MemoryEntry[] {
  if (!existsSync(MEMORY)) return [];
  const lines = readFileSync(MEMORY, 'utf8').trim().split('\n').filter(Boolean);
  return lines
    .slice(-limit)
    .map((l) => {
      try {
        return JSON.parse(l) as MemoryEntry;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as MemoryEntry[];
}

export function pickMove(rows: AggRow[]): AggRow | null {
  const enter = rows.filter((r) => r.window_state === 'ENTER').sort((a, b) => b.window_score - a.window_score);
  if (enter.length) return enter[0]!;
  const open = rows.filter((r) => r.saturation < 0.6).sort((a, b) => b.window_score - a.window_score);
  return open[0] ?? rows.sort((a, b) => b.window_score - a.window_score)[0] ?? null;
}

/** Build intelligence report for all verticals on a snapshot date. */
export function buildIntelligence(sqlitePath: string, snapshotDate: string): {
  verticals: VerticalIntelligence[];
  memory: MemoryEntry[];
} {
  const db = new DatabaseSync(sqlitePath);
  const all = db
    .prepare('SELECT * FROM angle_daily_agg WHERE snapshot_date = ?')
    .all(snapshotDate) as unknown as AggRow[];
  const verticals = [...new Set(all.map((r) => r.vertical))].sort();
  const report: VerticalIntelligence[] = [];

  for (const v of verticals) {
    const rows = all.filter((r) => r.vertical === v);
    const move = pickMove(rows);
    if (move?.window_state === 'ENTER') {
      logMarketMemory({
        snapshot_date: snapshotDate,
        vertical: v,
        angle_id: move.angle_id,
        window_state: move.window_state,
        window_score: move.window_score,
        signal_basis: move.signal_basis,
      });
    }
    report.push({
      vertical: v,
      absent_universe: absentUniverse(rows),
      wait_cost: waitCost(move, rows),
      half_life: halfLife(move),
      move_angle: move?.angle_id ?? null,
    });
  }
  db.close();
  return { verticals: report, memory: readMarketMemory(15) };
}

/** Sparkline history for one angle in a vertical. */
export function angleHistory(
  sqlitePath: string,
  vertical: string,
  angleId: string,
): Array<{ date: string; score: number; saturation: number; advertisers: number; velocity: number }> {
  if (!existsSync(sqlitePath)) return [];
  const db = new DatabaseSync(sqlitePath);
  const rows = db
    .prepare(
      `SELECT snapshot_date, window_score, saturation, distinct_advertisers, launch_share, entry_velocity, signal_basis
       FROM angle_daily_agg WHERE vertical=? AND angle_id=? ORDER BY snapshot_date ASC`,
    )
    .all(vertical, angleId) as Array<{
    snapshot_date: string;
    window_score: number;
    saturation: number;
    distinct_advertisers: number;
    launch_share: number;
    entry_velocity: number | null;
    signal_basis: string;
  }>;
  db.close();
  return rows.map((r) => ({
    date: r.snapshot_date,
    score: Math.round(r.window_score * 100),
    saturation: Math.round(r.saturation * 100),
    advertisers: r.distinct_advertisers,
    velocity: r.entry_velocity != null ? Math.round(r.entry_velocity * 100) / 100 : Math.round(r.launch_share * 100),
  }));
}

/** Evidence rows for drawer — all ads in a lane. */
export function laneEvidence(
  sqlitePath: string,
  snapshotDate: string,
  vertical: string,
  angleId: string,
): Array<{ advertiser: string; excerpt: string; url: string; confidence: number }> {
  if (!existsSync(sqlitePath)) return [];
  const db = new DatabaseSync(sqlitePath);
  const rows = db
    .prepare(
      `SELECT advertiser_name, ad_text, ad_ref_url, confidence FROM angle_snapshots
       WHERE snapshot_date=? AND vertical=? AND angle_id=? ORDER BY confidence DESC LIMIT 20`,
    )
    .all(snapshotDate, vertical, angleId) as Array<{
    advertiser_name: string;
    ad_text: string;
    ad_ref_url: string;
    confidence: number;
  }>;
  db.close();
  return rows.map((r) => ({
    advertiser: r.advertiser_name,
    excerpt: r.ad_text.slice(0, 320),
    url: r.ad_ref_url,
    confidence: Math.round(r.confidence * 100),
  }));
}
