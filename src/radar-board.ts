/**
 * radar-board.ts — shared board projection for Atlas UI + brief.
 *
 * Uses per-vertical latest snapshot so an ad-hoc "Add to radar" capture on a new
 * day (e.g. ai_marketing_studios on 2026-06-28) still appears even when an older
 * day has more verticals overall.
 */
import type { DatabaseSync } from 'node:sqlite';

export type AggRow = {
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
  [key: string]: unknown;
};

/** Header snapshot: latest calendar day with radar data (what users expect after 9 AM cron). */
export function pickPrimarySnapshotDate(db: DatabaseSync): string | null {
  const row = db
    .prepare(`SELECT MAX(snapshot_date) AS d FROM angle_daily_agg`)
    .get() as { d: string } | undefined;
  return row?.d ?? null;
}

/** Latest snapshot_date per vertical that has radar data. */
export function verticalLatestDates(db: DatabaseSync): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT vertical, MAX(snapshot_date) AS d
       FROM angle_daily_agg
       GROUP BY vertical`,
    )
    .all() as Array<{ vertical: string; d: string }>;
  return new Map(rows.map((r) => [r.vertical, r.d]));
}

/** Board rows grouped by vertical — each vertical from its own latest snapshot. */
export function loadBoardByVertical(db: DatabaseSync): {
  primarySnapshot: string | null;
  board: Array<{ vertical: string; snapshot_date: string; angles: AggRow[] }>;
} {
  const primarySnapshot = pickPrimarySnapshotDate(db);
  const latestByV = verticalLatestDates(db);
  const sel = db.prepare(
    `SELECT * FROM angle_daily_agg
     WHERE snapshot_date=? AND vertical=?
     ORDER BY window_score DESC`,
  );

  const board: Array<{ vertical: string; snapshot_date: string; angles: AggRow[] }> = [];
  for (const [vertical, snapshot_date] of [...latestByV.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const angles = sel.all(snapshot_date, vertical) as AggRow[];
    if (angles.length) board.push({ vertical, snapshot_date, angles });
  }
  return { primarySnapshot, board };
}

/** All agg rows for brief — one latest snapshot per vertical. */
export function loadLatestAggRows(db: DatabaseSync): { primarySnapshot: string | null; rows: AggRow[] } {
  const primarySnapshot = pickPrimarySnapshotDate(db);
  const latestByV = verticalLatestDates(db);
  const sel = db.prepare(`SELECT * FROM angle_daily_agg WHERE snapshot_date=? AND vertical=?`);
  const rows: AggRow[] = [];
  for (const [vertical, snapshot_date] of latestByV.entries()) {
    rows.push(...(sel.all(snapshot_date, vertical) as AggRow[]));
  }
  rows.sort((a, b) => a.vertical.localeCompare(b.vertical) || b.window_score - a.window_score);
  return { primarySnapshot, rows };
}
