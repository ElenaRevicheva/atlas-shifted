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
import {
  config,
  hasBrightData,
  hasAnthropic,
  hasAnyLlm,
  hasTelegram,
  hasBrightDataBrowser,
  hasMetaAdLibraryApi,
  hasImageProviders,
  hasVideoProviders,
  shipTokenRequired,
} from './config.js';
import { runWhitespace } from './agent.js';
import { breakerState } from './llm.js';
import { buildIntelligence, angleHistory, laneEvidence } from './intelligence.js';
import { readTrackedVerticals, SEED_IDS } from './verticals.js';
import { loadBoardByVertical } from './radar-board.js';
import type { RunEvent, RunMode } from './types.js';
import { enrichConceptTracking } from './tracking.js';
import { fetchPerformanceSummary } from './performance-hub.js';
import { hasPerformanceHub } from './config.js';
import { readPipelineStatus } from './pipeline-status.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const DATA_DIR = join(__dirname, '..', 'data');
const ROOT = join(__dirname, '..');
const execFileAsync = promisify(execFile);
const TRACK_LOCK = join(DATA_DIR, '.track.lock');
const TRACK_LOCK_MAX_MS = 30 * 60 * 1000;
const SHIP_LOCK = join(DATA_DIR, '.ship.lock');
const SHIP_LOCK_MAX_MS = 25 * 60 * 1000;
const VERTICAL_ID = /^[a-z][a-z0-9_]{0,47}$/;

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

function acquireShipLock(): boolean {
  try {
    if (existsSync(SHIP_LOCK)) {
      const age = Date.now() - statSync(SHIP_LOCK).mtimeMs;
      if (age < SHIP_LOCK_MAX_MS) return false;
      unlinkSync(SHIP_LOCK);
    }
    writeFileSync(SHIP_LOCK, `${process.pid} ${new Date().toISOString()}`);
    return true;
  } catch {
    return false;
  }
}

function releaseShipLock(): void {
  try {
    if (existsSync(SHIP_LOCK)) unlinkSync(SHIP_LOCK);
  } catch { /* ignore */ }
}

function readConceptEntry(vertical: string): Record<string, unknown> | null {
  const p = join(DATA_DIR, 'concepts.json');
  if (!existsSync(p)) return null;
  try {
    const all = JSON.parse(readFileSync(p, 'utf8')) as Record<string, Record<string, unknown>>;
    return all[vertical] ?? null;
  } catch {
    return null;
  }
}

function shipTokenOk(token: string): boolean {
  if (!shipTokenRequired()) return true;
  return token === config.shipToken;
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
    ship: {
      image: hasImageProviders(),
      video: hasVideoProviders(),
      tokenRequired: shipTokenRequired(),
    },
    performanceHub: hasPerformanceHub(),
  });
});

/** Atlas dashboard data: the radar board + daily brief + generated concepts. */
app.get('/api/atlas', async (_req, res) => {
  const out: Record<string, unknown> = { ok: true, board: [], brief: null, concepts: {}, snapshot_date: null, total_rows: 0, distinct_days: 0 };
  const sqlitePath = join(DATA_DIR, 'radar.sqlite');
  try {
    if (existsSync(sqlitePath)) {
      const db = new DatabaseSync(sqlitePath);
      const { primarySnapshot, board } = loadBoardByVertical(db);
      out.snapshot_date = primarySnapshot;
      out.total_rows = (db.prepare('SELECT COUNT(*) c FROM angle_snapshots').get() as { c: number }).c;
      out.distinct_days = (db.prepare('SELECT COUNT(DISTINCT snapshot_date) c FROM angle_snapshots').get() as { c: number }).c;
      out.board = board.map(({ vertical, angles }) => ({ vertical, angles }));
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
    if (existsSync(p)) out.concepts = enrichConceptTracking(JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>);
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
  out.ship = {
    image: hasImageProviders(),
    video: hasVideoProviders(),
    tokenRequired: shipTokenRequired(),
  };
  out.performance_hub = hasPerformanceHub();
  if (hasPerformanceHub()) {
    try {
      const perf = await fetchPerformanceSummary();
      if (perf?.ok) out.performance = perf;
    } catch { /* optional */ }
  }
  out.pipeline = readPipelineStatus(DATA_DIR, (out.snapshot_date as string | null) ?? null);
  // Freshness signal — so the UI shows an honest "paused" banner instead of a silently
  // stale date when capture can't reach Meta (e.g. Bright Data unfunded). Weekly cadence
  // means a snapshot up to ~7 days old is normal; >9 days ⇒ capture is genuinely stuck.
  if (out.snapshot_date) {
    const panamaNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Panama' }));
    const snap = new Date(`${out.snapshot_date as string}T00:00:00`);
    const ageDays = Math.floor((panamaNow.getTime() - snap.getTime()) / 86_400_000);
    out.snapshot_age_days = ageDays;
    out.stale = ageDays > 9;
  }
  res.json(out);
});

// GET /api/atlas/angle?vertical=<id>  OR  ?industry=<free text>
// The shared "angle intelligence" endpoint (July 20 2026) — the wedge that lets the
// Visibility API outreach and Lead Concierge both read Atlas's current market angle for
// a service/industry. Read-only: reads brief.json (move/state/evidence) + concepts.json
// (creative hook/headline/cta). Never touches the capture or existing routes.
app.get('/api/atlas/angle', (_req, res) => {
  const req = _req;
  try {
    const briefPath = join(DATA_DIR, 'brief.json');
    const conceptsPath = join(DATA_DIR, 'concepts.json');
    const brief = existsSync(briefPath) ? JSON.parse(readFileSync(briefPath, 'utf8')) : null;
    const concepts = (existsSync(conceptsPath)
      ? JSON.parse(readFileSync(conceptsPath, 'utf8'))
      : {}) as Record<string, { concept?: Record<string, unknown> }>;
    const verticals: Array<Record<string, any>> = Array.isArray(brief?.verticals) ? brief.verticals : [];
    if (!verticals.length) { res.json({ ok: false, reason: 'no_brief' }); return; }

    const norm = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const exactId = String(req.query.vertical || '').trim();
    const want = norm(req.query.vertical || req.query.industry || '');

    let match = verticals.find((v) => v.vertical === exactId);
    if (!match && want) {
      const wantTokens = new Set(want.split(' ').filter(Boolean));
      let best: Record<string, any> | undefined;
      let bestScore = 0;
      for (const v of verticals) {
        const vt = new Set(norm(v.vertical).split(' '));
        let overlap = 0;
        for (const t of wantTokens) if (vt.has(t)) overlap++;
        if (overlap > bestScore) { bestScore = overlap; best = v; }
      }
      match = best;
    }
    if (!match) match = verticals.find((v) => v.move?.state === 'ENTER') || verticals[0];

    const move = (match.move || {}) as Record<string, any>;
    const c = (concepts[match.vertical]?.concept || {}) as Record<string, any>;
    const label = String(match.vertical).replace(/_/g, ' ');
    const state = move.state || 'WATCH';
    const spark = c.hook || move.why || '';
    const one_line = state === 'ENTER'
      ? `In ${label}, the open angle is "${move.angle}" (ENTER) — ${spark}`
      : `In ${label}, watch "${move.angle}" (${state}) — ${spark}`;

    res.json({
      ok: true,
      snapshot_date: brief.snapshot_date || match.snapshot_date || null,
      vertical: match.vertical,
      state,
      angle: move.angle || null,
      score: move.score ?? null,
      why: move.why || null,
      evidence_url: move.evidence || null,
      concept: {
        name: c.concept_name || null,
        hook: c.hook || null,
        headline: c.headline || null,
        cta: c.cta || null,
      },
      one_line,
      matched_by: match.vertical === exactId ? 'exact' : want ? 'industry' : 'fallback',
    });
  } catch (e) {
    res.json({ ok: false, reason: (e as Error).message });
  }
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
    send('concept', `Generating campaign creative for "${cap.id}"…`, { pct: 92, vertical_id: cap.id });
    try {
      await execFileAsync('node', [join(ROOT, 'dist', 'concept.js'), cap.id], { cwd: ROOT });
      send('concept', `Campaign brief ready for "${cap.id}"`, { pct: 96, vertical_id: cap.id });
    } catch (e) {
      send('concept', `Campaign copy skipped: ${(e as Error).message}`, { pct: 96, vertical_id: cap.id });
    }
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

/** Render still + video for a vertical that already has concept copy (DETECT→CREATE→SHIP). */
app.get('/api/atlas/ship', async (req, res) => {
  const vertical = String(req.query.vertical || '').trim();
  const token = String(req.query.token || '').trim();
  const force = String(req.query.force || '') === '1';
  const stage = String(req.query.stage || 'all').trim();

  if (!vertical || !VERTICAL_ID.test(vertical)) {
    res.status(400).json({ error: 'invalid vertical id' });
    return;
  }
  if (!shipTokenOk(token)) {
    res.status(403).json({ error: 'ship token required or invalid' });
    return;
  }
  const entry = readConceptEntry(vertical);
  if (!entry) {
    res.status(404).json({ error: `no concept for "${vertical}" — add to radar or wait for daily capture` });
    return;
  }
  const brief = entry as {
    producer_brief?: { image_prompt?: string };
    concept?: { image_prompt?: string };
    asset?: { image_file?: string };
    video?: { video_file?: string };
  };
  const hasPrompt = !!(brief.producer_brief?.image_prompt || brief.concept?.image_prompt);
  if (!hasPrompt) {
    res.status(422).json({ error: 'concept has no image prompt — run concept first' });
    return;
  }
  if (!hasImageProviders()) {
    res.status(503).json({ error: 'image providers not configured (REPLICATE_API_TOKEN or OPENAI_API_KEY)' });
    return;
  }
  if ((stage === 'video' || stage === 'all') && !brief.asset?.image_file && stage !== 'all') {
    res.status(422).json({ error: 'no still image yet — run stage=all or produce first' });
    return;
  }
  if (!acquireShipLock()) {
    res.status(409).json({ error: 'Another creative ship is in progress — try again in a few minutes.' });
    return;
  }

  sseHeaders(res);
  const send: SseSend = (stageName, message, extra) => {
    res.write(`data: ${JSON.stringify({ stage: stageName, message, vertical, ...extra })}\n\n`);
  };
  const ka = setInterval(() => res.write(': keep-alive\n\n'), 15_000);

  let needImage = (stage === 'all' || stage === 'image') && (!brief.asset?.image_file || force);
  let needVideo =
    (stage === 'all' || stage === 'video') &&
    hasVideoProviders() &&
    (!brief.video?.video_file || force);
  let videoStatus: 'shipped' | 'partial' | 'skipped' | 'none' = 'none';

  try {
    send('start', `Shipping creative for "${vertical}"…`, { pct: 5, need_image: needImage, need_video: needVideo });

    if (needImage) {
      send('produce', 'Rendering still image (Flux → OpenAI fallback)…', { pct: 15 });
      await execFileAsync('node', [join(ROOT, 'dist', 'produce.js'), vertical], {
        cwd: ROOT,
        timeout: 180_000,
      });
      send('produce', 'Still image shipped', { pct: 55 });
      // Re-read after produce so video step sees the fresh asset on disk.
      const afterProduce = readConceptEntry(vertical) as typeof brief;
      if (afterProduce?.asset?.image_file) brief.asset = afterProduce.asset;
    } else if (brief.asset?.image_file) {
      send('produce', 'Still image already on file — skipping render', { pct: 55, skipped: true });
    }

    if (needVideo) {
      if (!brief.asset?.image_file) {
        send('error', 'No still image on file — generate the image first.', { pct: 100 });
        return;
      }
      send('video', 'Animating 5s clip (Runway → Luma → Gemini Omni → Veo)…', { pct: 60 });
      try {
        await execFileAsync('node', [join(ROOT, 'dist', 'video.js'), vertical], {
          cwd: ROOT,
          timeout: 600_000,
        });
        videoStatus = 'shipped';
        send('video', 'Video shipped', { pct: 95 });
      } catch (e) {
        const code = (e as { code?: number }).code;
        if (code === 2) {
          videoStatus = 'partial';
          send('video', 'Video unavailable — Runway/Luma/Gemini dry. Still image stands.', {
            pct: 95,
            partial: true,
          });
        } else {
          throw e;
        }
      }
    } else if (brief.video?.video_file) {
      videoStatus = 'skipped';
      send('video', 'Video already on file — skipping render', { pct: 95, skipped: true });
    } else if (!hasVideoProviders()) {
      videoStatus = 'partial';
      send('video', 'Video providers not configured — still image only.', { pct: 95, partial: true });
    }

    const finalEntry = readConceptEntry(vertical) as { video?: { video_file?: string } } | null;
    const hasVideoNow = !!finalEntry?.video?.video_file;
    if (needVideo && !hasVideoNow && videoStatus !== 'partial') videoStatus = 'partial';

    send('done', `Creative ready for "${vertical}" — refresh card below`, {
      pct: 100,
      video_status: hasVideoNow ? 'shipped' : videoStatus,
      has_video: hasVideoNow,
      has_image: !!((readConceptEntry(vertical) as { asset?: { image_file?: string } } | null)?.asset?.image_file),
    });
  } catch (e) {
    send('error', (e as Error).message || 'ship failed', { pct: 100 });
  } finally {
    releaseShipLock();
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
