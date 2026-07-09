/**
 * capture.ts — Atlas AIPA, DAY 0. The only irreplaceable step.
 *
 * The dumbest thing that works: for each seed vertical, fetch the public Meta Ad
 * Library, extract every ad we can, and APPEND each as one line to an
 * append-only JSONL log with the full payload we observed. Classifier, scoring,
 * and UI all rebuild from this log later — we can re-derive features forever, but
 * we can NEVER re-fetch a day we didn't capture. So the time-series starts tonight.
 *
 * Principles (from the roadmap, non-negotiable):
 *   - Over-capture: store everything observed, slice features later.
 *   - Idempotent: dedup key = advertiser_ref + ad_ref + snapshot_date, so a
 *     double-run or restart can't double-count entrants (= fake velocity, the
 *     HubSpot duplicate-loop failure class).
 *   - Panama time (UTC-5, no DST) is THE snapshot day-boundary. One constant.
 *   - Capture must not depend on a single LLM provider — Groq→OpenAI failover,
 *     Claude skipped once its credit breaker trips.
 *
 * Run:  node dist/capture.js            (all seed + tracked verticals)
 *       node dist/capture.js solar      (one vertical id)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, appendFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBrightData, config } from './config.js';
import { bdMetaAdLibraryFetch, bdSerpAds, htmlToText } from './brightdata.js';
import { metaApiSearchAds } from './meta-api.js';
import { llmJson } from './llm.js';
import {
  getCaptureTargets,
  knownVerticalIds,
  orderVerticals,
  registerTrackedVertical,
  syncTrackedOrphansFromJsonl,
  verticalSlug,
  type VerticalDef,
} from './verticals.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const JSONL = join(DATA_DIR, 'captures.jsonl');

/**
 * Seed verticals live in verticals.ts (also user-tracked + jsonl backfill for daily cron).
 */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const META_LIBRARY = (q: string) =>
  `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&media_type=all&q=${encodeURIComponent(
    q,
  )}&search_type=keyword_unordered`;

// Google Ads Transparency Center — public, DSA/transparency-mandated. Best-effort
// (JS-heavy, advertiser-centric), so we attempt one query per vertical and never
// let a thin Google result block the Meta spine.
// Google signal = live SEARCH ads via the SERP API (the Transparency Center is a
// JS SPA that yields nothing to a static scrape). The search URL is the evidence link.
const GOOGLE_SEARCH = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

/** Panama (UTC-5, no DST) calendar date — the snapshot day-boundary. */
function panamaDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Panama',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
}

function adRef(advertiser: string, copy: string): string {
  return createHash('sha1').update(`${norm(advertiser)}::${copy.slice(0, 120).toLowerCase().trim()}`).digest('hex').slice(0, 16);
}

interface RawAd {
  advertiser: string | null;
  copy: string;
  landingUrl: string | null;
  activitySignal: string | null;
  startedRunning: string | null;
}

interface CaptureRecord {
  snapshot_date: string;
  captured_at: string;
  vertical: string;
  platform: 'meta' | 'google';
  query: string;
  advertiser_ref: string;
  advertiser_name: string;
  ad_ref: string;
  ad_text: string;
  landing_url: string | null;
  activity_signal: string | null;
  started_running: string | null;
  source_url: string;
}

/** Extract as many ads as possible from a scraped ad-library page (over-capture). */
async function extractAds(rawHtml: string, vertical: string, sourceName: string): Promise<RawAd[]> {
  const text = htmlToText(rawHtml, 30_000);
  const { value } = await llmJson<RawAd[]>(
    `Extract EVERY distinct advertisement you can find in this scraped ${sourceName} page for the vertical "${vertical}".
Return up to 40 ads. For each, a JSON object:
- advertiser: brand/page name running it (null if not visible)
- copy: the ad's primary text / headline / caption (the persuasive words)
- landingUrl: destination URL if present (else null)
- activitySignal: any "Active" / impressions / library-id text (else null)
- startedRunning: any "Started running on <date>" text (else null)

Return ONLY a JSON array. Skip nav, cookie banners, filters, and UI chrome. If none found, return [].

PAGE TEXT:
---
${text}
---`,
    { fallback: [], maxTokens: 6000 },
  );
  return Array.isArray(value) ? value : [];
}

/** Fetch Meta Ad Library HTML with retries + pause between attempts. */
async function fetchMetaHtml(verticalId: string, query: string, url: string): Promise<string | null> {
  const retries = config.metaFetchRetries;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const html = await bdMetaAdLibraryFetch(url);
    if (html && html.length > 800) return html;
    console.warn(`  [${verticalId}] meta "${query}" attempt ${attempt}/${retries} — no usable HTML`);
    if (attempt < retries) await sleep(config.metaFetchPauseMs);
  }
  return null;
}

/** Load dedup keys already present for a given snapshot_date (idempotency). */
function existingKeysForDate(snapshotDate: string): Set<string> {
  const keys = new Set<string>();
  if (!existsSync(JSONL)) return keys;
  const lines = readFileSync(JSONL, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as CaptureRecord;
      if (r.snapshot_date === snapshotDate) keys.add(`${r.advertiser_ref}::${r.ad_ref}::${r.snapshot_date}`);
    } catch {
      /* skip malformed line — never let one bad line stop capture */
    }
  }
  return keys;
}

async function captureVertical(
  v: { id: string; queries: string[] },
  snapshotDate: string,
  seenKeys: Set<string>,
): Promise<{ found: number; written: number; dupes: number }> {
  let found = 0;
  let written = 0;
  let dupes = 0;
  const capturedAt = new Date().toISOString();

  // Sources: Meta spine (all queries) + Google Ads Transparency (best-effort, first
  // query only so a slow/thin Google scrape never blocks the Meta capture).
  const sources: Array<{ platform: 'meta' | 'google'; name: string; query: string; url: string }> = [
    ...v.queries.map((q) => ({ platform: 'meta' as const, name: 'Meta Ad Library', query: q, url: META_LIBRARY(q) })),
    // Comparison-intent query surfaces Google's paid block far more reliably than
    // the bare keyword (empirically: "compare auto insurance" returns ads, "auto
    // insurance" often returns none). Still best-effort — Google's ad block is auction-timed.
    ...(v.queries[0] ? [{ platform: 'google' as const, name: 'Google Search Ads', query: `compare ${v.queries[0]}`, url: GOOGLE_SEARCH(`compare ${v.queries[0]}`) }] : []),
  ];

  for (const src of sources) {
    let ads: RawAd[];
    if (src.platform === 'google') {
      // Google's paid block is auction-timed and intermittently returned — retry
      // a few times so we catch it when present (best-effort by design).
      let serp: Awaited<ReturnType<typeof bdSerpAds>> = [];
      for (let attempt = 0; attempt < 3 && serp.length === 0; attempt++) {
        serp = await bdSerpAds(src.query).catch(() => []);
      }
      ads = serp.map((s) => ({
        advertiser: s.advertiser,
        copy: [s.title, s.description].filter(Boolean).join(' — '),
        landingUrl: s.link || null,
        activitySignal: 'Google search ad',
        startedRunning: null,
      }));
      console.log(`  [${v.id}] google: ${ads.length} search ads`);
    } else {
      // Official API first (structured; works for political/EU commercial — US affiliate often empty).
      const apiAds = await metaApiSearchAds(src.query);
      if (apiAds.length > 0) {
        ads = apiAds;
        console.log(`  [${v.id}] meta-api: ${ads.length} ads for "${src.query}"`);
      } else {
        const html = await fetchMetaHtml(v.id, src.query, src.url);
        if (!html) {
          console.warn(`  [${v.id}] no HTML for ${src.platform} "${src.query}" after ${config.metaFetchRetries} attempts`);
          continue;
        }
        ads = await extractAds(html, v.id, src.name);
        console.log(`  [${v.id}] meta-scrape: ${ads.length} ads for "${src.query}"`);
      }
      // Stagger Meta calls so Bright Data isn't hammered back-to-back.
      await sleep(config.metaFetchPauseMs);
    }
    ads = ads.filter((a) => a && typeof a.copy === 'string' && a.copy.trim().length > 8);
    found += ads.length;

    for (const a of ads) {
      const advertiserName = (a.advertiser || 'unknown').toString().slice(0, 120);
      const copy = a.copy.toString().slice(0, 1000);
      const advertiser_ref = norm(advertiserName) || 'unknown';
      const ad_ref = adRef(advertiserName, copy);
      const key = `${advertiser_ref}::${ad_ref}::${snapshotDate}`;
      if (seenKeys.has(key)) {
        dupes++;
        continue;
      }
      seenKeys.add(key);
      const rec: CaptureRecord = {
        snapshot_date: snapshotDate,
        captured_at: capturedAt,
        vertical: v.id,
        platform: src.platform,
        query: src.query,
        advertiser_ref,
        advertiser_name: advertiserName,
        ad_ref,
        ad_text: copy,
        landing_url: a.landingUrl?.toString().slice(0, 500) || null,
        activity_signal: a.activitySignal?.toString().slice(0, 200) || null,
        started_running: a.startedRunning?.toString().slice(0, 80) || null,
        source_url: src.url,
      };
      appendFileSync(JSONL, JSON.stringify(rec) + '\n');
      written++;
    }
  }
  return { found, written, dupes };
}

/** Slug for ad-hoc verticals typed in the UI (not in seed list). Re-exported for API consumers. */
export { verticalSlug } from './verticals.js';

/** Capture one UI-typed vertical into today's snapshot (Meta + Google best-effort). */
export async function captureAdHoc(label: string): Promise<{ id: string; found: number; written: number; dupes: number }> {
  if (!hasBrightData()) throw new Error('Bright Data not configured');
  const q = label.trim();
  if (!q) throw new Error('empty vertical');
  registerTrackedVertical(q);
  mkdirSync(DATA_DIR, { recursive: true });
  const snapshotDate = panamaDate();
  const id = verticalSlug(q);
  const v = getCaptureTargets(id)[0] ?? { id, queries: [q] };
  const seenKeys = existingKeysForDate(snapshotDate);
  let r = await captureVertical(v, snapshotDate, seenKeys);
  if (r.written === 0) {
    await sleep(config.metaVerticalPauseMs * 2);
    r = await captureVertical(v, snapshotDate, seenKeys);
  }
  return { id: v.id, ...r };
}

async function main() {
  if (!hasBrightData()) {
    console.error('FATAL: Bright Data not configured (BRIGHTDATA_API_TOKEN + BRIGHTDATA_ZONE). Cannot capture.');
    process.exit(1);
  }
  mkdirSync(DATA_DIR, { recursive: true });

  const orphanSync = syncTrackedOrphansFromJsonl();
  if (orphanSync > 0) console.log(`ATLAS CAPTURE · synced ${orphanSync} tracked vertical(s) from captures.jsonl`);

  const snapshotDate = panamaDate();
  const only = process.argv[2]?.trim();
  const targets = orderVerticals(only ? getCaptureTargets(only) : getCaptureTargets());
  if (targets.length === 0) {
    console.error(`unknown vertical "${only}". Known: ${knownVerticalIds().join(', ')}`);
    process.exit(1);
  }

  const seenKeys = existingKeysForDate(snapshotDate);
  console.log(
    `ATLAS CAPTURE · snapshot_date=${snapshotDate} (Panama) · ${targets.length} verticals (${targets.map((v) => v.id).join(', ')}) · ${seenKeys.size} rows already today`,
  );

  let totalFound = 0;
  let totalWritten = 0;
  let totalDupes = 0;
  const zeroWriteVerticals: VerticalDef[] = [];

  for (const v of targets) {
    try {
      const before = seenKeys.size;
      const r = await captureVertical(v, snapshotDate, seenKeys);
      totalFound += r.found;
      totalWritten += r.written;
      totalDupes += r.dupes;
      console.log(`  [${v.id}] found=${r.found} written=${r.written} dupes=${r.dupes}`);
      if (!only && r.written === 0 && seenKeys.size === before) zeroWriteVerticals.push(v);
      if (!only) await sleep(config.metaVerticalPauseMs);
    } catch (e) {
      console.error(`  [${v.id}] ERROR: ${(e as Error).message?.slice(0, 160)}`);
      if (!only) zeroWriteVerticals.push(v);
    }
  }

  // Second pass: Meta timeouts often hit one vertical per run — retry empties after a cool-down.
  if (!only && zeroWriteVerticals.length > 0) {
    console.log(
      `RETRY PASS · ${zeroWriteVerticals.length} vertical(s) wrote 0 today: ${zeroWriteVerticals.map((v) => v.id).join(', ')}`,
    );
    await sleep(config.metaVerticalPauseMs * 2);
    for (const v of zeroWriteVerticals) {
      try {
        const r = await captureVertical(v, snapshotDate, seenKeys);
        totalFound += r.found;
        totalWritten += r.written;
        totalDupes += r.dupes;
        console.log(`  [${v.id}] retry found=${r.found} written=${r.written} dupes=${r.dupes}`);
        await sleep(config.metaVerticalPauseMs);
      } catch (e) {
        console.error(`  [${v.id}] retry ERROR: ${(e as Error).message?.slice(0, 160)}`);
      }
    }
  }

  const totalRows = existsSync(JSONL) ? readFileSync(JSONL, 'utf8').split('\n').filter((l) => l.trim()).length : 0;
  const sizeKb = existsSync(JSONL) ? Math.round(statSync(JSONL).size / 1024) : 0;
  // ACTION line — verify from logs, not config.
  console.log(
    `ATLAS CAPTURE DONE · found=${totalFound} written=${totalWritten} dupes=${totalDupes} · jsonl=${totalRows} rows (${sizeKb}KB) · ${JSONL}`,
  );

  // Outage guard (July 9 2026, earned from the Jul 6-9 Bright Data account-invalid
  // incident): found=0 across ALL verticals on a full run is an outage signature
  // (dead Bright Data balance/zone), not a quiet market — the cron exits 0 either
  // way, so without this alert the radar goes stale silently. Fail-open.
  if (!only && totalFound === 0) {
    try {
      const { sendTelegramMessage } = await import('./telegram.js');
      const sent = await sendTelegramMessage(
        [
          '⚠️ ATLAS CAPTURE OUTAGE — 0 ads found across ALL verticals',
          `snapshot ${snapshotDate} · radar will go stale if this repeats`,
          'Likely cause: Bright Data balance/account (Scraping Browser 403s).',
          'Diagnose: curl api.brightdata.com/zone?zone=atlas_scraping_browser -H "Authorization: Bearer $BRIGHTDATA_API_TOKEN"',
          '422 "Customer has invalid status" = top up at brightdata.com/cp',
        ].join('\n'),
      );
      console.log(sent ? '  Telegram: outage alert sent ✓' : '  Telegram: outage alert NOT sent (no creds or API fail)');
    } catch (e) {
      console.warn('  Telegram outage alert failed:', (e as Error).message?.slice(0, 120));
    }
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
