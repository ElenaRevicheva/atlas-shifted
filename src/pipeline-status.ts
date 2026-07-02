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
  brief: 'writing daily brief',
  concept: 'generating campaign copy',
  backup: 'pushing backup',
};

export function pipelineStageLabel(stage: PipelineStage): string {
  return STAGE_LABELS[stage] ?? stage;
}

/** Infer morning pipeline state from capture.log tail + sqlite snapshot date. */
export function readPipelineStatus(dataDir: string, sqliteSnapshot: string | null): PipelineStatus {
  const expected = panamaDate();
  const logPath = join(dataDir, 'capture.log');
  let in_progress = false;
  let stage: PipelineStage = 'idle';
  let started_at: string | null = null;
  let last_done_at: string | null = null;
  let stale_reason: string | null = null;

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
      if (startPanama === expected && !hasDoneAfter) {
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
    if (in_progress) {
      stale_reason = `Morning refresh in progress (${pipelineStageLabel(stage)}) - snapshot updates after classify finishes (~20 min from 9 AM Panama).`;
    } else {
      stale_reason =
        "Today's radar snapshot is missing — the 9 AM cron may have failed. On Oracle: tail data/capture.log && bash scripts/atlas-capture-cron.sh";
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
