/**
 * server.ts — the live demo. Serves the UI and streams a run over SSE so judges
 * can watch the agent work in real time, then renders the battle plan.
 *
 *   GET  /                 → the single-page UI
 *   GET  /healthz          → readiness + which providers are wired
 *   GET  /api/run?vertical → Server-Sent Events stream of RunEvents
 */
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config, hasBrightData, hasAnthropic, hasAnyLlm, hasTelegram, hasBrightDataBrowser, hasMetaAdLibraryApi } from './config.js';
import { runWhitespace } from './agent.js';
import { breakerState } from './llm.js';
import { buildIntelligence, angleHistory, laneEvidence } from './intelligence.js';
import { readTrackedVerticals, SEED_IDS } from './verticals.js';
import type { RunEvent, RunMode } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const DATA_DIR = join(__dirname, '..', 'data');
const ROOT = join(__dirname, '..');
const execFileAsync = promisify(execFile);
const TRACK_LOCK = join(DATA_DIR, '.track.lock');
const TRACK_LOCK_MAX_MS = 30 * 60 * 1000;

type SseSend = (stage: string, message: string, extra?: Record<string, unknown>) => void;

function acquireTrackLock(): boolean {
  try {
    if (existsSync(TRACK_LOCK)) {
      const age = Date.now() - statSync(TRACK_LOCK).mtimeMs;
      if (age < TRACK_LOCK_MAX_MS) return false;
      unlinkSync(TRACK_LOCK);
    }
    writeFileSync(TRACK_LOCK, `${process.pid} ${new Date().toISOString()}`);
    return true;
  } catch {
    return false;
  }
}

function releaseTrackLock(): void {
  try {
    if (existsSync(TRACK_LOCK)) unlinkSync(TRACK_LOCK);
  } catch { /* ignore */ }
}

function sseHeaders(res: express.Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

async function runClassifyBrief(send?: SseSend): Promise<void> {
  send?.('classify', 'Rebuilding angle radar from captures…', { pct: 72 });
  await execFileAsync('node', [join(ROOT, 'dist', 'classify.js')], { cwd: ROOT });
  send?.('brief', 'Writing daily MOVE brief…', { pct: 88 });
  await execFileAsync('node', [join(ROOT, 'dist', 'brief.js')], { cwd: ROOT });
}

const app = express();
app.disable('x-powered-by');
app.use(express.static(PUBLIC_DIR));
// Generated creative assets (Atuona Producer output) — served for the dashboard.
app.use('/assets', express.static(join(DATA_DIR, 'assets')));

app.get('/healthz', (_req, res) => {
  res.json({
    ok: hasAnyLlm(),
    brightData: hasBrightData(),
    brightDataBrowser: hasBrightDataBrowser(),
    metaAdLibraryApi: hasMetaAdLibraryApi(),
    anthropic: hasAnthropic(),
    llm: hasAnyLlm(),
    maxCreatives: config.maxCreatives,
    breaker: breakerState(),
    telegram: hasTelegram(),
  });
});

/** Atlas dashboard data: the radar board + daily brief + generated concepts. */
app.get('/api/atlas', (_req, res) => {
  const out: Record<string, unknown> = { ok: true, board: [], brief: null, concepts: {}, snapshot_date: null, total_rows: 0, distinct_days: 0 };
  const sqlitePath = join(DATA_DIR, 'radar.sqlite');
  try {
    if (existsSync(sqlitePath)) {
      const db = new DatabaseSync(sqlitePath);
      const latest = (db.prepare('SELECT MAX(snapshot_date) d FROM angle_daily_agg').get() as { d: string } | undefined)?.d ?? null;
      out.snapshot_date = latest;
      out.total_rows = (db.prepare('SELECT COUNT(*) c FROM angle_snapshots').get() as { c: number }).c;
      out.distinct_days = (db.prepare('SELECT COUNT(DISTINCT snapshot_date) c FROM angle_snapshots').get() as { c: number }).c;
      const rows = db.prepare('SELECT * FROM angle_daily_agg WHERE snapshot_date=? ORDER BY vertical, window_score DESC').all(latest) as Array<Record<string, unknown>>;
      const byV: Record<string, Array<Record<string, unknown>>> = {};
      for (const r of rows) (byV[r.vertical as string] ??= []).push(r);
      out.board = Object.entries(byV).map(([vertical, angles]) => ({ vertical, angles }));
      db.close();
    }
  } catch (e) {
    out.board_error = (e as Error).message;
  }
  try {
    const p = join(DATA_DIR, 'brief.json');
    if (existsSync(p)) out.brief = JSON.parse(readFileSync(p, 'utf8'));
  } catch { /* ignore */ }
  try {
    const p = join(DATA_DIR, 'concepts.json');
    if (existsSync(p)) out.concepts = JSON.parse(readFileSync(p, 'utf8'));
  } catch { /* ignore */ }
  try {
    const p = join(DATA_DIR, 'intelligence.json');
    if (existsSync(p)) out.intelligence = JSON.parse(readFileSync(p, 'utf8'));
    else if (existsSync(sqlitePath) && out.snapshot_date) {
      out.intelligence = buildIntelligence(sqlitePath, out.snapshot_date as string);
    }
  } catch { /* ignore */ }
  try {
    out.tracked_verticals = readTrackedVerticals();
    out.seed_verticals = [...SEED_IDS];
  } catch { /* ignore */ }
  res.json(out);
});

app.get('/api/atlas/history', (req, res) => {
  const vertical = String(req.query.vertical || '').trim();
  const angle = String(req.query.angle || '').trim();
  if (!vertical || !angle) {
    res.status(400).json({ error: 'vertical and angle required' });
    return;
  }
  const sqlitePath = join(DATA_DIR, 'radar.sqlite');
  res.json({ ok: true, vertical, angle, history: angleHistory(sqlitePath, vertical, angle) });
});

app.get('/api/atlas/evidence', (req, res) => {
  const vertical = String(req.query.vertical || '').trim();
  const angle = String(req.query.angle || '').trim();
  const date = String(req.query.date || '').trim();
  if (!vertical || !angle) {
    res.status(400).json({ error: 'vertical and angle required' });
    return;
  }
  const sqlitePath = join(DATA_DIR, 'radar.sqlite');
  let snapshot = date;
  if (!snapshot && existsSync(sqlitePath)) {
    const db = new DatabaseSync(sqlitePath);
    snapshot =
      (db.prepare('SELECT MAX(snapshot_date) d FROM angle_snapshots').get() as { d: string } | undefined)?.d ?? '';
    db.close();
  }
  res.json({
    ok: true,
    vertical,
    angle,
    snapshot_date: snapshot,
    evidence: laneEvidence(sqlitePath, snapshot, vertical, angle),
  });
});

app.get('/api/run', async (req, res) => {
  const vertical = String(req.query.vertical || '').trim();
  const mode: RunMode = String(req.query.mode || '') === 'content' ? 'content' : 'media_buyer';
  if (!vertical) {
    res.status(400).json({ error: 'missing vertical' });
    return;
  }

  sseHeaders(res);

  const send = (e: RunEvent) => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  };

  const ka = setInterval(() => res.write(': keep-alive\n\n'), 15_000);

  try {
    await runWhitespace(vertical, send, mode);
  } catch (e) {
    send({ stage: 'error', message: (e as Error).message || 'run failed' });
  } finally {
    clearInterval(ka);
    res.write('event: close\ndata: {}\n\n');
    res.end();
  }
});

/** Capture a UI-typed vertical → classify → brief → refresh radar board. Append-only; never deletes captures. */
app.get('/api/atlas/track', async (req, res) => {
  const vertical = String(req.query.vertical || '').trim();
  if (!vertical) {
    res.status(400).json({ error: 'missing vertical' });
    return;
  }
  if (!hasBrightData()) {
    res.status(503).json({ error: 'Bright Data not configured' });
    return;
  }
  if (!acquireTrackLock()) {
    res.status(409).json({ error: 'Another track capture is in progress — try again in a few minutes.' });
    return;
  }

  sseHeaders(res);
  const send: SseSend = (stage, message, extra) => {
    res.write(`data: ${JSON.stringify({ stage, message, ...extra })}\n\n`);
  };
  const ka = setInterval(() => res.write(': keep-alive\n\n'), 15_000);

  try {
    send('register', `Registering "${vertical}" for daily radar capture…`, { pct: 4 });
    send('capture', `Capturing live ads for "${vertical}"…`, { pct: 8 });
    const { captureAdHoc } = await import('./capture-adhoc.js');
    const cap = await captureAdHoc(vertical);
    send('capture', `Captured ${cap.written} ads (${cap.found} found) → vertical id "${cap.id}"`, { pct: 55, vertical_id: cap.id });
    send('register', `Saved to daily cron — "${cap.id}" refreshes every morning at 9 AM Panama`, { pct: 62, vertical_id: cap.id });
    if (cap.written === 0) {
      send('error', 'No ads captured — Meta may have timed out. Try Live scan instead.', { pct: 100 });
      return;
    }
    await runClassifyBrief(send);
    send('done', `Radar updated — look for "${cap.id}" on the board`, { pct: 100, vertical_id: cap.id });
  } catch (e) {
    send('error', (e as Error).message || 'track failed', { pct: 100 });
  } finally {
    releaseTrackLock();
    clearInterval(ka);
    res.write('event: close\ndata: {}\n\n');
    res.end();
  }
});

app.get('/', (_req, res) => res.sendFile(join(PUBLIC_DIR, 'index.html')));

app.listen(config.port, () => {
  console.log(`\n  WHITESPACE → http://localhost:${config.port}`);
  console.log(`  providers: LLM=${hasAnyLlm() ? activeProviders() : 'NONE'} · BrightData=${hasBrightData() ? 'on' : 'off'}`);
  if (!hasAnyLlm()) console.log('  ⚠  no LLM key set — copy .env.example to .env and add at least ANTHROPIC_API_KEY');
  if (!hasBrightData()) console.log('  ℹ  Bright Data off — runs in LLM market-knowledge mode until BRIGHTDATA_* are set');
});

function activeProviders(): string {
  const p: string[] = [];
  if (config.anthropicKey) p.push('Claude');
  if (config.groqKey) p.push('Groq');
  if (config.openaiKey) p.push('OpenAI');
  return p.join('+');
}
