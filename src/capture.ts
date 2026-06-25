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
 * Run:  node dist/capture.js            (all seed verticals)
 *       node dist/capture.js solar      (one vertical id)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, appendFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBrightData } from './config.js';
import { bdScrapingBrowserFetch, bdFetch, htmlToText } from './brightdata.js';
import { llmJson } from './llm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const JSONL = join(DATA_DIR, 'captures.jsonl');

/**
 * Seed verticals — the judge's affiliate world + AIdeazz dogfood (expat_language).
 * `queries` is frozen per vertical (like the taxonomy): it defines the population
 * we measure, so changing it mid-series would corrupt velocity. expat_language
 * uses EspaLuz's real ICP keywords (relocators with language anxiety), not generic
 * "learn spanish", so the dogfood signal is about the market EspaLuz actually serves.
 */
const SEED_VERTICALS: Array<{ id: string; queries: string[] }> = [
  { id: 'auto_insurance', queries: ['auto insurance'] },
  { id: 'solar', queries: ['solar panels'] },
  { id: 'debt_finance', queries: ['debt relief'] },
  { id: 'health_supplements', queries: ['health supplement'] },
  {
    id: 'expat_language',
    queries: ['learn spanish', 'move abroad spanish', 'spanish for expats', 'relocation language'],
  },
];

const META_LIBRARY = (q: string) =>
  `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&media_type=all&q=${encodeURIComponent(
    q,
  )}&search_type=keyword_unordered`;

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
  platform: 'meta';
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

/** Extract as many ads as possible from the scraped Ad Library page (over-capture). */
async function extractAds(rawHtml: string, vertical: string): Promise<RawAd[]> {
  const text = htmlToText(rawHtml, 30_000);
  const { value } = await llmJson<RawAd[]>(
    `Extract EVERY distinct advertisement you can find in this scraped Meta Ad Library page for the vertical "${vertical}".
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

  for (const query of v.queries) {
    const url = META_LIBRARY(query);
    const html = (await bdScrapingBrowserFetch(url)) || (await bdFetch(url));
    if (!html) {
      console.warn(`  [${v.id}] no HTML for query "${query}"`);
      continue;
    }
    const ads = (await extractAds(html, v.id)).filter((a) => a && typeof a.copy === 'string' && a.copy.trim().length > 8);
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
        platform: 'meta',
        query,
        advertiser_ref,
        advertiser_name: advertiserName,
        ad_ref,
        ad_text: copy,
        landing_url: a.landingUrl?.toString().slice(0, 500) || null,
        activity_signal: a.activitySignal?.toString().slice(0, 200) || null,
        started_running: a.startedRunning?.toString().slice(0, 80) || null,
        source_url: url,
      };
      appendFileSync(JSONL, JSON.stringify(rec) + '\n');
      written++;
    }
  }
  return { found, written, dupes };
}

async function main() {
  if (!hasBrightData()) {
    console.error('FATAL: Bright Data not configured (BRIGHTDATA_API_TOKEN + BRIGHTDATA_ZONE). Cannot capture.');
    process.exit(1);
  }
  mkdirSync(DATA_DIR, { recursive: true });

  const snapshotDate = panamaDate();
  const only = process.argv[2]?.trim();
  const targets = only ? SEED_VERTICALS.filter((s) => s.id === only) : SEED_VERTICALS;
  if (targets.length === 0) {
    console.error(`unknown vertical "${only}". Known: ${SEED_VERTICALS.map((s) => s.id).join(', ')}`);
    process.exit(1);
  }

  const seenKeys = existingKeysForDate(snapshotDate);
  console.log(`ATLAS CAPTURE · snapshot_date=${snapshotDate} (Panama) · ${targets.length} verticals · ${seenKeys.size} rows already today`);

  let totalFound = 0;
  let totalWritten = 0;
  let totalDupes = 0;
  for (const v of targets) {
    try {
      const r = await captureVertical(v, snapshotDate, seenKeys);
      totalFound += r.found;
      totalWritten += r.written;
      totalDupes += r.dupes;
      console.log(`  [${v.id}] found=${r.found} written=${r.written} dupes=${r.dupes}`);
    } catch (e) {
      console.error(`  [${v.id}] ERROR: ${(e as Error).message?.slice(0, 160)}`);
    }
  }

  const totalRows = existsSync(JSONL) ? readFileSync(JSONL, 'utf8').split('\n').filter((l) => l.trim()).length : 0;
  const sizeKb = existsSync(JSONL) ? Math.round(statSync(JSONL).size / 1024) : 0;
  // ACTION line — verify from logs, not config.
  console.log(
    `ATLAS CAPTURE DONE · found=${totalFound} written=${totalWritten} dupes=${totalDupes} · jsonl=${totalRows} rows (${sizeKb}KB) · ${JSONL}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
