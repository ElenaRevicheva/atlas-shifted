/**
 * pipeline-status.ts — honest freshness for Atlas UI.
 *
 * The daily cron (9 AM Panama) runs capture → classify → brief → concept.
 * Capture alone can take 15–25 min for 10 verticals. SQLite (and snapshot_date)
 * only updates after classify, so the board looks "stale" every morning until
 * the pipeline finishes — even when cron is healthy.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function panamaDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Panama',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Minutes since midnight in America/Panama (for pre-cron / grace windows). */
export function panamaMinutesSinceMidnight(d = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Panama',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

/** The weekly capture cron fires Monday 9:00 AM Panama; hide ops banners until then (+ grace). */
const CRON_START_MINUTES = 9 * 60;
const CRON_GRACE_MINUTES = 45; // 9:00–9:45 — normal pipeline window, no alarm banner

export type PipelineStage = 'idle' | 'capture' | 'classify' | 'brief' | 'concept' | 'backup';

export interface PipelineStatus {
  expected_snapshot_date: string;
  sqlite_snapshot: string | null;
  in_progress: boolean;
  stage: PipelineStage;
  started_at: string | null;
  last_done_at: string | null;
  stale_reason: string | null;
}

const STAGE_LABELS: Record<PipelineStage, string> = {
  idle: 'idle',
  capture: 'capturing ads',
  classify: 'classifying angles',
  brief: 'writing the brief',
  concept: 'generating campaign copy',
  backup: 'pushing backup',
};

export function pipelineStageLabel(stage: PipelineStage): string {
  return STAGE_LABELS[stage] ?? stage;
}

/**
 * The Monday (Panama) on or before `today`. The capture cron is weekly since 19 Jul
 * (`0 14 * * 1`), so a Monday snapshot is current all week. Until 19 Oct 2026 this file still
 * expected a snapshot EVERY day and told visitors "Today's market scan is still completing"
 * from Tuesday to Sunday.
 */
export function lastMonday(today = panamaDate()): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Infer this week's pipeline state from capture.log tail + sqlite snapshot date. */
export function readPipelineStatus(dataDir: string, sqliteSnapshot: string | null): PipelineStatus {
  const today = panamaDate();
  const expected = lastMonday(today);
  const logPath = join(dataDir, 'capture.log');
  let in_progress = false;
  let stage: PipelineStage = 'idle';
  let started_at: string | null = null;
  let last_done_at: string | null = null;
  let stale_reason: string | null = null;
  let finishedThisWeek = false; // a run this week that wrote its done line

  if (existsSync(logPath)) {
    const tail = readFileSync(logPath, 'utf8').slice(-16_000);
    const doneMatches = [...tail.matchAll(/=== ([0-9T:+-]+Z?) : done ===/g)];
    if (doneMatches.length) last_done_at = doneMatches[doneMatches.length - 1]![1] ?? null;

    const startMatches = [...tail.matchAll(/=== ([0-9T:+-]+Z?) UTC \| ([0-9-]+) Panama : start ===/g)];
    const lastStart = startMatches[startMatches.length - 1];
    if (lastStart) {
      started_at = lastStart[1] ?? null;
      const startPanama = lastStart[2] ?? '';
      const startIdx = tail.lastIndexOf(lastStart[0]);
      const afterStart = tail.slice(startIdx);
      const hasDoneAfter = /: done ===/.test(afterStart);
      finishedThisWeek = startPanama >= expected && hasDoneAfter;
      // A start with no done line is a live run only while it is young: a killed or hung run
      // must not read as "refreshing" for the rest of the week.
      const young = !!started_at && Date.now() - Date.parse(started_at) < 3 * 3_600_000;
      // Any young run this week counts (a manual re-run on Wednesday too), not only Monday's.
      if (startPanama >= expected && startPanama <= today && !hasDoneAfter && young) {
        in_progress = true;
        if (/backup push/.test(afterStart)) stage = 'backup';
        else if (/dist\/concept|concept\.js/.test(afterStart)) stage = 'concept';
        else if (/ATLAS CLASSIFY DONE/.test(afterStart)) stage = 'brief';
        else if (/ATLAS CAPTURE DONE/.test(afterStart)) stage = 'classify';
        else stage = 'capture';
      }
    }
  }

  if (sqliteSnapshot && sqliteSnapshot < expected) {
    const mins = panamaMinutesSinceMidnight();
    // Only Monday morning is the normal run window; any later day the run is genuinely late.
    const inMorningWindow = today === expected && mins < CRON_START_MINUTES + CRON_GRACE_MINUTES;

    if (in_progress) {
      stale_reason = `Refreshing this week's ad market (${pipelineStageLabel(stage)}) — new angles in about 20 minutes.`;
    } else if (inMorningWindow || today !== expected || finishedThisWeek) {
      // Monday before 9:45, or any later day: no "still completing" claim. A run that never
      // finished shows as the server's honest stale (>9 days) "Radar paused" banner instead.
      stale_reason = null;
    } else {
      // After grace, still stale — client-safe copy only (no server/Oracle instructions).
      stale_reason =
        "This week's market scan is still completing. You're viewing the most recent snapshot.";
    }
  }

  return {
    expected_snapshot_date: expected,
    sqlite_snapshot: sqliteSnapshot,
    in_progress,
    stage,
    started_at,
    last_done_at,
    stale_reason,
  };
}
