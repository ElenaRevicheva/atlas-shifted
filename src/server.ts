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
import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync, appendFileSync, mkdirSync, renameSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
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
  hasOwnerToken,
} from './config.js';
import { sendTelegramMessage } from './telegram.js';
import { runWhitespace } from './agent.js';
import { breakerState, withOutputLanguage } from './llm.js';
import { buildIntelligence, angleHistory, laneEvidence } from './intelligence.js';
import { readTrackedVerticals, SEED_IDS } from './verticals.js';
import { loadBoardByVertical } from './radar-board.js';
import type { RunEvent, RunMode } from './types.js';
import { enrichConceptTracking } from './tracking.js';
import { fetchPerformanceSummary } from './performance-hub.js';
import { hasPerformanceHub } from './config.js';
import { readPipelineStatus, panamaDate } from './pipeline-status.js';

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
/** The 7 shipped creatives on the public Examples gallery — never re-rendered or overwritten. */
const PROTECTED_EXAMPLES = new Set([
  'geo_aeo_tech_seo_makers', 'ai_marketing_studios', 'ai_augmented_product_building', 'expat_language',
  'debt_finance', 'auto_insurance', 'medicare_advantage_enrollment',
]);

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

// ── Owner gate + visitor identity (19 Oct 2026) ────────────────────────────────
// Every route that SPENDS (ship renders, track captures) or REVEALS (CRM ids, pipeline
// counts) is the owner's. The gate fails closed: no ATLAS_OWNER_TOKEN ⇒ nobody passes.
// EventSource cannot send headers, so the browser presents the token as ?token=.
const sha = (s: string) => createHash('sha256').update(s).digest();

function presentedToken(req: express.Request): string {
  const a = String(req.headers.authorization || '');
  return /^bearer /i.test(a) ? a.slice(7).trim() : String(req.query.token || '').trim();
}

function isOwner(req: express.Request): boolean {
  const want = config.ownerToken;
  const got = presentedToken(req);
  return !!want && !!got && timingSafeEqual(sha(got), sha(want));
}

// nginx OVERWRITES X-Real-IP with the socket address; the first X-Forwarded-For entry is
// whatever the visitor typed, so it is never trusted. A loopback socket gets NO privilege:
// any service on this box that fetches a URL for a visitor would otherwise hand the visitor
// owner rights (19 Oct 2026 review). A script that needs owner rights sends
// `Authorization: Bearer $ATLAS_OWNER_TOKEN`; without it, it is metered like a visitor.
function clientIp(req: express.Request): string {
  const r = req.headers['x-real-ip'];
  if (typeof r === 'string' && r.trim()) return r.trim();
  return req.socket.remoteAddress || 'unknown';
}
/** Logs keep a salted hash, never the visitor's address. */
const ipHash = (ip: string) => createHash('sha256').update(`${ip}|${config.ownerToken || 'ws'}`).digest('hex').slice(0, 12);

/** Countries the one-shot scan can look at (Meta Ad Library country codes). */
// 21 Oct 2026: all of Latin America (Brasil searched in Portuguese — see localAdPhrase in ad-sources.ts) + Spain + US.
const COUNTRIES = new Set(['PA', 'CR', 'CO', 'MX', 'DO', 'PR', 'GT', 'SV', 'HN', 'NI', 'EC', 'PE', 'BO', 'CL', 'AR', 'UY', 'PY', 'VE', 'BR', 'ES', 'US']);
const normCountry = (v: unknown): string => {
  const c = String(v || '').trim().toUpperCase();
  return COUNTRIES.has(c) ? c : 'US';
};

/** Cut by code point, so an emoji is never split (Telegram rejects half a surrogate pair). */
const clip = (s: unknown, n: number) => Array.from(String(s ?? '').trim()).slice(0, n).join('');

/**
 * The public /api/atlas payload: what the page draws, nothing of the CRM behind it.
 * Drops raw performance events, HubSpot deal ids and per-stream counts (HIRING included),
 * and the internal Bearer endpoints. NEVER touches asset/video: that is how the creatives render.
 */
function sanitizePublic(out: Record<string, unknown>): void {
  const perf = out.performance as { concepts?: Record<string, Record<string, unknown>> } | undefined;
  for (const c of Object.values(perf?.concepts || {})) {
    if (!c || typeof c !== 'object') continue;
    // Totals count every stream's HubSpot links; the public sees CLIENT deals only.
    const evs = Array.isArray(c.events) ? (c.events as Array<{ source?: string }>) : [];
    const otherStream = evs.filter((e) => /^hubspot_/.test(String(e?.source || '')) && e.source !== 'hubspot_client').length;
    const tot = c.totals as Record<string, number> | undefined;
    const clientDeals = Number((c.hubspot as { client?: unknown } | undefined)?.client) || 0;
    if (tot) {
      if (typeof tot.event_count === 'number') tot.event_count = Math.max(0, tot.event_count - otherStream);
      if (tot.hubspot_deals != null) tot.hubspot_deals = clientDeals;
    }
    delete c.events;
    // CLIENT deals only: the raw list mixes the espaluz and hiring streams.
    const hs = c.hubspot as { client?: unknown } | undefined;
    if (hs) c.hubspot = { deals: Number(hs.client) || 0 };
  }
  const concepts = out.concepts as Record<string, Record<string, unknown>> | undefined;
  for (const c of Object.values(concepts || {})) {
    if (!c || typeof c !== 'object') continue;
    const t = c.tracking as Record<string, unknown> | undefined;
    if (t) {
      delete t.crm_event_url;
      delete t.performance_ingest_url;
    }
    delete c.producer_brief;
  }
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
  send?.('brief', 'Writing the MOVE brief…', { pct: 88 });
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
      ownerConfigured: hasOwnerToken(),
    },
    performanceHub: hasPerformanceHub(),
  });
});

/** Atlas dashboard data: the radar board + daily brief + generated concepts. */
app.get('/api/atlas', async (req, res) => {
  const out: Record<string, unknown> = { ok: true, board: [], brief: null, concepts: {}, snapshot_date: null, total_rows: 0, distinct_days: 0, first_snapshot_date: null };
  const sqlitePath = join(DATA_DIR, 'radar.sqlite');
  try {
    if (existsSync(sqlitePath)) {
      const db = new DatabaseSync(sqlitePath);
      const { primarySnapshot, board } = loadBoardByVertical(db);
      out.snapshot_date = primarySnapshot;
      out.total_rows = (db.prepare('SELECT COUNT(*) c FROM angle_snapshots').get() as { c: number }).c;
      out.distinct_days = (db.prepare('SELECT COUNT(DISTINCT snapshot_date) c FROM angle_snapshots').get() as { c: number }).c;
      // The first capture ever. The page counts "days tracked" from it to today, so the number grows every day;
      // distinct_days counts capture days only (captures went weekly on 20 Jul 2026), which read as "33 days".
      out.first_snapshot_date = (db.prepare('SELECT MIN(snapshot_date) d FROM angle_snapshots').get() as { d: string | null }).d;
      out.board = board.map(({ vertical, snapshot_date, angles }) => ({ vertical, snapshot_date, angles }));
      // Lanes measured in the last 14 days (19 Oct 2026). 'Today's move' is chosen from these,
      // GEO/AEO first, so the page never leads with a July lane again.
      if (primarySnapshot) {
        const cut = new Date(`${panamaDate()}T00:00:00Z`);
        cut.setUTCDate(cut.getUTCDate() - 14);
        const since = cut.toISOString().slice(0, 10);
        out.fresh_verticals = board
          .filter((b) => b.snapshot_date >= since)
          .sort((a, b) =>
            a.vertical === 'geo_aeo_tech_seo_makers' ? -1 : b.vertical === 'geo_aeo_tech_seo_makers' ? 1 : b.snapshot_date.localeCompare(a.snapshot_date),
          )
          .map((b) => ({ vertical: b.vertical, snapshot_date: b.snapshot_date }));
      }
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
  out.owner = isOwner(req);
  if (!out.owner) sanitizePublic(out);
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

    // Prefer Elena's active service lanes (WHITESPACE_CAPTURE_ONLY) — the brief also
    // holds stale historical verticals, and a fallback should pitch HER services.
    const allow = new Set(config.captureAllow || []);
    const mine = allow.size ? verticals.filter((v) => allow.has(v.vertical)) : verticals;
    const pool = mine.length ? mine : verticals;

    let matchedBy: 'exact' | 'industry' | 'fallback' = 'fallback';
    let match = verticals.find((v) => v.vertical === exactId);
    if (match) matchedBy = 'exact';
    if (!match && want) {
      const wantTokens = new Set(want.split(' ').filter(Boolean));
      let best: Record<string, any> | undefined;
      let bestScore = 0;
      for (const v of pool) {
        const vt = new Set(norm(v.vertical).split(' '));
        let overlap = 0;
        for (const t of wantTokens) if (vt.has(t)) overlap++;
        if (overlap > bestScore) { bestScore = overlap; best = v; }
      }
      if (best && bestScore > 0) { match = best; matchedBy = 'industry'; }
    }
    if (!match) {
      match = pool.find((v) => v.move?.state === 'ENTER')
        || pool.find((v) => v.move?.state === 'WATCH')
        || pool[0] || verticals[0];
      matchedBy = 'fallback';
    }

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
      matched_by: matchedBy,
      // #4: real CRM outcomes for this lane (staged/sent/replied/won) — what converts.
      // Owner/box/token only since 19 Oct 2026: they are her sales pipeline, not a public stat.
      outcomes: (() => {
        const ot = (process.env.ATLAS_OUTCOMES_TOKEN || '').trim();
        if (!isOwner(req) && !(ot && req.headers.authorization === `Bearer ${ot}`)) return undefined;
        try {
          const p = join(DATA_DIR, 'outcomes.json');
          if (!existsSync(p)) return null;
          const o = JSON.parse(readFileSync(p, 'utf8')) as { outcomes?: Record<string, unknown> };
          return (o.outcomes && (o.outcomes as any)[match.vertical]) || null;
        } catch { return null; }
      })(),
    });
  } catch (e) {
    res.json({ ok: false, reason: (e as Error).message });
  }
});

// #4 feedback loop (July 20 2026): cto-aipa pushes real CRM outcomes per service lane
// (staged/sent/replied/won from [CLIENT-MANUAL] + [ATLAS-RADAR] deals) so Atlas learns
// which lanes CONVERT, not just which are open. Stored in data/outcomes.json; the angle
// endpoint serves them back. Token-gated, additive, never touches capture/brief.
app.post('/api/atlas/outcomes', express.json({ limit: '256kb' }), (req, res) => {
  const token = (process.env.ATLAS_OUTCOMES_TOKEN || '').trim();
  if (!token || req.headers.authorization !== `Bearer ${token}`) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  const body = req.body as { outcomes?: Record<string, unknown>; source?: string };
  if (!body?.outcomes || typeof body.outcomes !== 'object') {
    res.status(400).json({ ok: false, error: 'outcomes object required' });
    return;
  }
  try {
    writeFileSync(
      join(DATA_DIR, 'outcomes.json'),
      JSON.stringify({ updated_at: new Date().toISOString(), source: body.source || 'cto-aipa', outcomes: body.outcomes }, null, 2),
    );
    res.json({ ok: true, lanes: Object.keys(body.outcomes).length });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
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

// Free public scan (19 Oct 2026). Order: validate → cache → quota → one-at-a-time → run.
// Every refusal is an SSE 'error' event with a code, so the page can turn it into a call to
// action; a plain 429 would reach the browser's EventSource as a bare "stream closed".
const RUN_CACHE_DIR = join(DATA_DIR, 'run-cache');
const runQuota = { day: '', global: 0, perIp: new Map<string, number>() };
let runInflight = 0;
const PAID_CTA = 'https://aideazz.xyz/pay/analisis-tecnico?sku=diagnostic_call&lng=es';

/** The whole query, normalised (NFKC, case, spacing) — never stripped to ASCII, so two markets
 *  can never share a cache entry and nobody can plant a result under a chip's key. */
const normQuery = (v: string) => v.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
/** What is actually searched: NFKC, no zero-width/BOM characters, single spaces (case kept). */
const scanText = (v: string) => v.normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
function runCacheKey(vertical: string, mode: RunMode, country: string, lang: 'es' | 'en' = 'en'): string {
  // English keeps its old key (existing cached scans stay valid); a Spanish result is its own entry.
  return createHash('sha1').update(`${mode}|${country}|${normQuery(vertical)}${lang === 'es' ? '|es' : ''}`).digest('hex');
}
/** A result worth keeping: a real recommendation AND its copy — not the empty fallback an LLM
 *  outage leaves in either of the two LLM calls (angles, then copy). */
function usableResult(out: unknown): boolean {
  const o = out as {
    kind?: string; recommendation?: { confidence?: number }; adCopy?: unknown[]; blog?: { title?: string };
  };
  if (!o?.recommendation || !(Number(o.recommendation.confidence) > 0)) return false;
  if (o.kind === 'content') return !!String(o.blog?.title || '').trim();
  return Array.isArray(o.adCopy) && o.adCopy.some((c) => !!String((c as { headline?: unknown } | null)?.headline || '').trim());
}

function logRun(rec: Record<string, unknown>): void {
  try {
    appendFileSync(join(DATA_DIR, 'run-log.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), ...rec })}\n`);
  } catch { /* the log is a record, never a reason to fail the scan */ }
}

app.get('/api/run', async (req, res) => {
  const vertical = scanText(clip(req.query.vertical, 120));
  const mode: RunMode = String(req.query.mode || '') === 'content' ? 'content' : 'media_buyer';
  const country = normCountry(req.query.country);
  if (!vertical || !/[\p{L}\p{N}]/u.test(vertical)) {
    res.status(400).json({ error: 'missing vertical' });
    return;
  }

  sseHeaders(res);
  const send = (e: RunEvent) => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  const close = () => {
    res.write('event: close\ndata: {}\n\n');
    res.end();
  };

  const privileged = isOwner(req);
  const ip = ipHash(clientIp(req));
  const lang: 'es' | 'en' = String(req.query.lang || '') === 'es' ? 'es' : 'en';
  const key = runCacheKey(vertical, mode, country, lang);
  const cachePath = join(RUN_CACHE_DIR, `${key}.json`);
  const t0 = Date.now();

  // 1. Cache: the same market + mode + country is bought once a week, not once a visitor.
  if (!(privileged && String(req.query.fresh || '') === '1')) {
    try {
      if (existsSync(cachePath)) {
        const hit = JSON.parse(readFileSync(cachePath, 'utf8')) as {
          at: string; degraded?: boolean; vertical?: string; mode?: string; country?: string; out: Record<string, unknown>;
        };
        // A no-evidence (degraded) result is never served again: the next visitor gets a fresh live try.
        const same = normQuery(String(hit.vertical || '')) === normQuery(vertical) && hit.mode === mode && hit.country === country;
        if (!hit.degraded && same && Date.now() - Date.parse(hit.at) < config.runCacheDays * 86_400_000) {
          send({ stage: 'start', message: `Scan from ${hit.at.slice(0, 10)} (${country}) — served from this week's cache`, pct: 2 });
          send({ stage: 'done', message: 'Deliverable ready (cached).', data: { ...hit.out, cached: { at: hit.at } }, pct: 100 });
          logRun({ ip, vertical, mode, country, result: 'cache' });
          close();
          return;
        }
      }
    } catch { /* a bad cache file is a miss */ }
  }

  // 2. Free quota (Panama day), skipped for the owner and for scripts on the box.
  if (!privileged) {
    const day = panamaDate();
    if (runQuota.day !== day) {
      runQuota.day = day;
      runQuota.global = 0;
      runQuota.perIp.clear();
    }
    const mine = runQuota.perIp.get(ip) || 0;
    const globalFull = runQuota.global >= config.runGlobalPerDay;
    if (mine >= config.runFreePerIpDay || globalFull) {
      send({
        stage: 'error',
        // quota_global: today's shared free scans are taken (not this visitor's own two)
        code: globalFull ? 'quota_global' : 'quota',
        message: globalFull
          ? "Today's free scans are all taken. Leave your email and we get back to you about this market."
          : 'Your free scans for today are used. Leave your email and we get back to you about this market.',
        cta_url: PAID_CTA,
      });
      logRun({ ip, vertical, mode, country, result: 'quota' });
      close();
      return;
    }
  }

  // 3. One paid scan at a time.
  if (!privileged && runInflight >= config.runMaxConcurrent) {
    send({ stage: 'error', code: 'busy', message: 'Another scan is running right now — try again in a couple of minutes.' });
    logRun({ ip, vertical, mode, country, result: 'busy' });
    close();
    return;
  }

  if (!privileged) {
    runQuota.global++;
    runQuota.perIp.set(ip, (runQuota.perIp.get(ip) || 0) + 1);
    void sendTelegramMessage(
      `🔎 WHITESPACE free scan\n${clip(vertical, 80)} · ${mode} · ${country}\nvisitor ${ip} · ${runQuota.perIp.get(ip)}/${config.runFreePerIpDay} today · ${runQuota.global}/${config.runGlobalPerDay} global`,
    );
  }

  // A failed or empty scan gives the visitor nothing, so it does not cost them one of their free
  // scans. The GLOBAL count is never given back: recon was already paid, and that cap is the
  // ceiling on spend — during an outage scans stop at it instead of looping all day.
  const refund = () => {
    if (privileged || runQuota.day !== panamaDate()) return;
    runQuota.perIp.set(ip, Math.max(0, (runQuota.perIp.get(ip) || 1) - 1));
  };
  runInflight++;
  const ka = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
  try {
    // Hold the final 'done' until we know the result is usable: an empty one must not be shown
    // as "Deliverable ready" (and it is not charged).
    let doneEv: RunEvent | null = null;
    const emit = (e: RunEvent) => {
      if (e.stage === 'done') doneEv = e;
      else send(e);
    };
    const out = await withOutputLanguage(lang, () => runWhitespace(vertical, emit, mode, country));
    const degraded = !!(out as { meta?: { degraded?: boolean } }).meta?.degraded;
    const usable = usableResult(out);
    // Elena, 20 Oct: a free result without live, clickable proof makes no sense. The owner still sees knowledge mode.
    const noProof = usable && degraded && !privileged;
    if (usable && !noProof) send(doneEv || { stage: 'done', message: 'Deliverable ready.', data: out, pct: 100 });
    else if (noProof) {
      send({
        stage: 'error',
        code: 'no_proof',
        message: 'The live ad libraries did not answer for this market right now, so there is no proof to show. It did not use one of your free scans.',
      });
    } else {
      send({
        stage: 'error',
        code: 'empty',
        message: 'The analysis came back empty this time. It did not use one of your free scans — try again in a few minutes.',
      });
    }
    if (usable && !degraded) {
      try {
        mkdirSync(RUN_CACHE_DIR, { recursive: true });
        const tmp = `${cachePath}.tmp`;
        writeFileSync(tmp, JSON.stringify({ key, vertical, mode, country, at: new Date().toISOString(), degraded, out }));
        renameSync(tmp, cachePath);
      } catch { /* uncached is still a delivered scan */ }
    } else {
      // empty, or no live evidence (the page promises clickable proof): never cached, never charged
      refund();
    }
    logRun({
      ip, vertical, mode, country, result: noProof ? 'no_proof' : usable ? 'live' : 'empty', degraded, ms: Date.now() - t0,
      creatives: (out as { meta?: { creativesScanned?: number } }).meta?.creativesScanned ?? null,
    });
  } catch (e) {
    refund();
    send({ stage: 'error', message: (e as Error).message || 'run failed' });
    logRun({ ip, vertical, mode, country, result: 'error', ms: Date.now() - t0 });
  } finally {
    runInflight--;
    clearInterval(ka);
    close();
  }
});

/** Capture a UI-typed vertical → classify → brief → refresh radar board. Append-only; never deletes captures. */
app.get('/api/atlas/track', async (req, res) => {
  // A paid capture + classify + brief + concept: owner (or a script on the box) only.
  // The public asks for weekly tracking through POST api/atlas/lead instead.
  if (!isOwner(req)) {
    res.status(403).json({ error: 'owner only — request weekly tracking with the form instead' });
    return;
  }
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
    send('register', `Registering "${vertical}" on the radar…`, { pct: 4 });
    send('capture', `Capturing live ads for "${vertical}"…`, { pct: 8 });
    const { captureAdHoc } = await import('./capture-adhoc.js');
    const cap = await captureAdHoc(vertical);
    send('capture', `Captured ${cap.written} ads (${cap.found} found) → vertical id "${cap.id}"`, { pct: 55, vertical_id: cap.id });
    // Honest cadence: the capture cron is WEEKLY (Monday 9 AM Panama) and only refreshes ids in
    // WHITESPACE_CAPTURE_ONLY when that allowlist is set. Say so, and remind the owner.
    const weekly = !config.captureAllow.length || config.captureAllow.includes(cap.id);
    send(
      'register',
      weekly
        ? `Saved — "${cap.id}" refreshes every Monday at 9 AM Panama`
        : `Captured now. A weekly refresh needs "${cap.id}" in WHITESPACE_CAPTURE_ONLY`,
      { pct: 62, vertical_id: cap.id },
    );
    if (!weekly) void sendTelegramMessage(`🛰️ Atlas: "${cap.id}" was captured once. Add it to WHITESPACE_CAPTURE_ONLY for the Monday refresh.`);
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
  const force = String(req.query.force || '') === '1';
  const stage = String(req.query.stage || 'all').trim();

  if (!vertical || !VERTICAL_ID.test(vertical)) {
    res.status(400).json({ error: 'invalid vertical id' });
    return;
  }
  // Owner only (19 Oct 2026): a render is paid, and force=1 overwrites the shipped files.
  if (!isOwner(req)) {
    res.status(403).json({ error: 'owner only' });
    return;
  }
  // The 7 creatives shipped in June–July are the public Examples gallery (skin.js). produce/video
  // write fixed names (assets/<vertical>.jpg|mp4), so any render for these ids would replace them.
  if (PROTECTED_EXAMPLES.has(vertical)) {
    res.status(409).json({ error: 'protected example creative — it is never re-rendered' });
    return;
  }
  const entry = readConceptEntry(vertical);
  if (!entry) {
    res.status(404).json({ error: `no concept for "${vertical}" — add to radar or wait for the Monday capture` });
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

// ── Lead capture (19 Oct 2026) ──────────────────────────────────────────────────
// The public's way in: "track my market", "my free scans ran out", "the managed service".
// Saved on the box, relayed to the fleet CRM hub as a HubSpot CLIENT deal (no emails are sent
// to the address typed), then pinged to Telegram WITH the CRM outcome so a failed relay is seen.
const leadHits = new Map<string, number[]>();
const LEAD_KINDS = new Set(['weekly_tracking', 'diagnostic', 'scan_quota', 'scan_no_proof', 'contact']);
const leadRelay = {
  day: '',
  count: 0,
  capPinged: false,
  fails: 0,
  emails: new Map<string, Set<string>>(), // email -> kinds already relayed today
  perIp: new Map<string, number>(),
  ipPinged: new Set<string>(),
};
const LEAD_RELAY_PER_IP_DAY = 2;

/** Neutralise anything shaped like a domain or a link (with or without a scheme), so visitor text
 *  can never make the CRM hub start paid enrichment (it pattern-matches linkedin/crunchbase paths). */
const noEnrichTriggers = (s: string) =>
  s.replace(/(?:https?:\/*)?(?:[\w-]+\.)+[a-z]{2,}(?:\/\S*)?/gi, '[link removed]');

type RelayResult = 'ok' | 'nodeal' | 'slow' | 'dupe' | 'cap' | 'ipcap' | 'fail';

async function relayLead(rec: Record<string, string>, ipKey: string, message: string): Promise<RelayResult> {
  const day = panamaDate();
  if (leadRelay.day !== day) {
    leadRelay.day = day;
    leadRelay.count = 0;
    leadRelay.capPinged = false;
    leadRelay.fails = 0;
    leadRelay.emails.clear();
    leadRelay.perIp.clear();
    leadRelay.ipPinged.clear();
  }
  const em = rec.email.toLowerCase();
  if (leadRelay.emails.has(em)) return 'dupe';
  if ((leadRelay.perIp.get(ipKey) || 0) >= LEAD_RELAY_PER_IP_DAY) return 'ipcap';
  if (leadRelay.count >= config.leadRelayPerDay) return 'cap';
  if (!config.performanceHubSecret) return 'fail';
  // Reserve synchronously, BEFORE the await: concurrent POSTs cannot all pass the caps.
  leadRelay.emails.set(em, new Set([rec.kind]));
  leadRelay.count++;
  leadRelay.perIp.set(ipKey, (leadRelay.perIp.get(ipKey) || 0) + 1);
  const release = () => {
    leadRelay.emails.delete(em);
    leadRelay.count = Math.max(0, leadRelay.count - 1);
    leadRelay.perIp.set(ipKey, Math.max(0, (leadRelay.perIp.get(ipKey) || 1) - 1));
  };
  try {
    const r = await fetch(config.crmEventUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.performanceHubSecret}` },
      body: JSON.stringify({
        source: 'whitespace_tool',
        type: 'inquiry',
        pipeline: 'client',
        sourcePrefix: 'CLIENT-CTO-INQUIRY',
        email: rec.email,
        ...(rec.name ? { name: noEnrichTriggers(rec.name) } : {}),
        context: noEnrichTriggers(
          `[WHITESPACE ${rec.kind}] market: ${rec.market || '—'} · country: ${rec.country || '—'} · lang: ${rec.lang}` +
            (rec.whatsapp ? ` · WhatsApp: ${rec.whatsapp}` : '') +
            (message ? `\n${message}` : ''),
        ),
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!r.ok) {
      release(); // a definite refusal: nothing was written, the slot goes back
      return 'fail';
    }
    const j = (await r.json().catch(() => null)) as { hubspot?: { dealId?: string | null } | null } | null;
    return j?.hubspot?.dealId ? 'ok' : 'nodeal';
  } catch (e) {
    const name = (e as { name?: string })?.name || '';
    // A timeout is not a refusal: the hub keeps working after we stop waiting, so the lead is
    // probably in HubSpot. Keep the reservation and say "check", never "NOT in HubSpot".
    if (name === 'TimeoutError' || name === 'AbortError') return 'slow';
    release();
    return 'fail';
  }
}

app.post('/api/atlas/lead', express.json({ limit: '16kb' }), async (req, res) => {
  const ip = clientIp(req);
  const now = Date.now();
  if (leadHits.size > 5_000) {
    for (const [k, v] of leadHits) if (!v.some((t) => now - t < 3_600_000)) leadHits.delete(k);
  }
  const hits = (leadHits.get(ip) || []).filter((t) => now - t < 3_600_000);
  if (hits.length >= 5) {
    res.status(429).json({ ok: false, error: 'too_many' });
    return;
  }
  hits.push(now);
  leadHits.set(ip, hits);
  const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  if (clip(b.website_hp, 10)) {
    res.json({ ok: true }); // honeypot: a bot filled the hidden field
    return;
  }
  const email = clip(b.email, 160);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    res.status(400).json({ ok: false, error: 'email' });
    return;
  }
  const lang = b.lang === 'en' ? 'en' : 'es';
  const rawCountry = String(b.country || '').trim().toUpperCase();
  const rec = {
    ts: new Date().toISOString(),
    kind: LEAD_KINDS.has(String(b.kind)) ? String(b.kind) : 'contact',
    email,
    name: clip(b.name, 80),
    market: clip(b.market, 120),
    country: COUNTRIES.has(rawCountry) ? rawCountry : '', // '' = the visitor did not choose one
    whatsapp: clip(b.whatsapp, 30),
    lang,
    ip: ipHash(ip),
  };
  try {
    appendFileSync(join(DATA_DIR, 'leads.jsonl'), `${JSON.stringify(rec)}\n`);
  } catch { /* the relay below still carries it */ }
  const crm = await relayLead(rec, rec.ip, clip(b.message, 800));
  // Telegram, bounded but never silent: each relayed lead; a same-email lead only when it asks for
  // something new; ONE line per IP and one per day for the caps; at most 5 failure lines a day.
  const head =
    `🧲 WHITESPACE lead · ${rec.kind}\n${rec.name || '—'} <${rec.email}>\nmarket: ${rec.market || '—'} · ${rec.country || '—'}` +
    (rec.whatsapp ? `\nWA: ${rec.whatsapp}` : '');
  let ping = '';
  if (crm === 'ok') ping = `${head}\nHubSpot ✓`;
  else if (crm === 'nodeal') ping = `${head}\n⚠️ hub answered but no HubSpot deal`;
  else if (crm === 'slow') ping = `${head}\n⏳ hub slow — probably in HubSpot, check`;
  else if (crm === 'fail' && ++leadRelay.fails <= 5) ping = `${head}\n⚠️ NOT in HubSpot (relay failed)`;
  else if (crm === 'dupe') {
    const kinds = leadRelay.emails.get(rec.email.toLowerCase());
    if (kinds && !kinds.has(rec.kind)) {
      kinds.add(rec.kind);
      ping = `${head}\n(same email already in HubSpot today — new request type)`;
    }
  } else if (crm === 'ipcap' && !leadRelay.ipPinged.has(rec.ip)) {
    leadRelay.ipPinged.add(rec.ip);
    ping = `${head}\n⚠️ 3rd+ lead from one address today — held in data/leads.jsonl, not in HubSpot`;
  } else if (crm === 'cap' && !leadRelay.capPinged) {
    leadRelay.capPinged = true;
    ping = `⚠️ WHITESPACE: today's lead relay cap (${config.leadRelayPerDay}) is reached. Later leads are in data/leads.jsonl only.`;
  }
  if (ping) void sendTelegramMessage(ping);
  console.log(`[lead] ${rec.kind} ${rec.ip} crm=${crm}`);
  res.json({ ok: true, next: `https://aideazz.xyz/pay/analisis-tecnico?sku=diagnostic_call&lng=${lang}` });
});

app.get('/', (_req, res) => res.sendFile(join(PUBLIC_DIR, 'index.html')));

// JSON errors only (19 Oct 2026). NODE_ENV is unset under PM2, so Express's default page
// would show a stack trace with file paths for a malformed body.
app.use((err: { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err?.status || 500).json({ ok: false, error: err?.type === 'entity.parse.failed' ? 'bad_json' : 'error' });
});

app.listen(config.port, () => {
  console.log(`\n  WHITESPACE → http://localhost:${config.port}`);
  console.log(`  providers: LLM=${hasAnyLlm() ? activeProviders() : 'NONE'} · BrightData=${hasBrightData() ? 'on' : 'off'}`);
  if (!hasAnyLlm()) console.log('  ⚠  no LLM key set — copy .env.example to .env and add at least ANTHROPIC_API_KEY');
  if (!hasBrightData()) console.log('  ℹ  Bright Data off — runs in LLM market-knowledge mode until BRIGHTDATA_* are set');
  if (!hasOwnerToken()) console.log('  ⚠  ATLAS_OWNER_TOKEN unset — ship/track refuse everyone (fail closed)');
  if (!config.performanceHubSecret) console.log('  ⚠  no ATLAS_PERFORMANCE_SECRET — WHITESPACE leads reach Telegram only, not HubSpot');
});

/**
 * The startup banner's provider list. Kept in PROFILE_QUALITY order and covering
 * ALL five, because this line is the first thing anyone reads about the chain.
 *
 * It said "Claude+Groq+OpenAI" on 2026-08-17 while the chain had five providers
 * and Groq's model was 404ing — a banner claiming three, one of them dead. If a
 * key is absent the provider is genuinely not in the chain, so omitting it is
 * correct; silently omitting two that ARE configured is not.
 */
function activeProviders(): string {
  const present: Array<[string, string]> = [
    [config.anthropicKey, 'Claude'],
    [config.openaiKey, 'OpenAI'],
    [config.geminiKey, 'Gemini'],
    [config.xaiKey, 'Grok'],
    [config.groqKey, 'Groq'],
  ];
  return present.filter(([key]) => !!key).map(([, name]) => name).join('+');
}
