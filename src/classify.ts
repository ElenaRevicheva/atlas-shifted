/**
 * classify.ts — Atlas AIPA, DAY 1. Turn raw captures into the angle time-series.
 *
 * Pipeline (all rebuilt from captures.jsonl — the JSONL is truth, this is derived):
 *   1. Freeze an 8-angle ontology (v1). Each angle has a prototype whose embedding
 *      is its centroid. Centroids are cached per angle_version and NEVER retuned
 *      mid-version — that's what keeps velocity real instead of reclassification noise.
 *   2. Embed every captured ad's text (OpenAI text-embedding-3-small, deterministic).
 *   3. Assign each ad to the nearest centroid (cosine) → angle_id + confidence.
 *   4. Project into SQLite: angle_snapshots (one row per ad) + angle_daily_agg
 *      (distinct advertisers, 7-day new entrants, entry velocity, window state).
 *
 * SQLite is a DISPOSABLE projection: we DROP and rebuild it from the JSONL every
 * run, so changing the ontology or scoring never corrupts the irreplaceable log.
 *
 * Run:  node dist/classify.js
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { embedBatch } from './llm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const JSONL = join(DATA_DIR, 'captures.jsonl');
const SQLITE = join(DATA_DIR, 'radar.sqlite');

export const ANGLE_VERSION = 'v1';
const CENTROIDS_CACHE = join(DATA_DIR, `centroids.${ANGLE_VERSION}.json`);

/** Frozen 8-angle ontology. The prototype text becomes the centroid (embedded once). */
const ONTOLOGY: Array<{ id: string; prototype: string }> = [
  { id: 'pain_point', prototype: 'Tired of overpaying? Sick of the hassle and stress? Stop struggling with this frustrating problem that costs you money and time every single month.' },
  { id: 'social_proof', prototype: 'Join over 50,000 happy customers. Rated 5 stars by thousands. Trusted by millions. See why everyone is switching and what our reviews say.' },
  { id: 'urgency_scarcity', prototype: 'Limited time offer ends tonight. Only a few spots left. Act now before this deal expires. Last chance — enrollment closes soon, don\'t miss out.' },
  { id: 'authority', prototype: 'Recommended by experts and doctors. Backed by science and certified professionals. As featured in major publications. Industry-leading, award-winning, accredited.' },
  { id: 'curiosity_gap', prototype: 'This one weird trick they don\'t want you to know. The secret most people never discover. You won\'t believe what happens next. Find out the surprising truth.' },
  { id: 'transformation', prototype: 'From before to after — see the incredible results. Transform your life in 30 days. Real people, real change. Get the body, the score, the savings you always wanted.' },
  { id: 'fear_loss', prototype: 'Don\'t make this costly mistake. Are you at risk? Protect yourself before it\'s too late. What you don\'t know could hurt you and your family. Avoid losing everything.' },
  { id: 'novelty', prototype: 'Introducing the first ever breakthrough. A revolutionary new way nobody has tried. The next generation, just launched. Brand new technology that changes everything.' },
];

interface CaptureRecord {
  snapshot_date: string;
  vertical: string;
  platform: string;
  advertiser_ref: string;
  advertiser_name: string;
  ad_ref: string;
  ad_text: string;
  landing_url: string | null;
  started_running: string | null;
  source_url: string;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function loadCaptures(): CaptureRecord[] {
  if (!existsSync(JSONL)) return [];
  const rows: CaptureRecord[] = [];
  for (const line of readFileSync(JSONL, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as CaptureRecord);
    } catch {
      /* skip malformed line */
    }
  }
  return rows;
}

/** Centroids are frozen per angle_version: compute once, cache, reuse. */
async function getCentroids(): Promise<Record<string, number[]>> {
  if (existsSync(CENTROIDS_CACHE)) {
    try {
      return JSON.parse(readFileSync(CENTROIDS_CACHE, 'utf8')) as Record<string, number[]>;
    } catch {
      /* fall through to recompute */
    }
  }
  const vecs = await embedBatch(ONTOLOGY.map((o) => o.prototype));
  if (vecs.length !== ONTOLOGY.length || vecs.some((v) => !v)) {
    throw new Error('failed to embed ontology centroids (OpenAI embeddings unavailable)');
  }
  const centroids: Record<string, number[]> = {};
  ONTOLOGY.forEach((o, i) => (centroids[o.id] = vecs[i]!));
  writeFileSync(CENTROIDS_CACHE, JSON.stringify(centroids));
  return centroids;
}

/** Shift a YYYY-MM-DD date string by N days (UTC-safe, calendar arithmetic). */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface Snapshot {
  snapshot_date: string;
  vertical: string;
  platform: string;
  angle_id: string;
  advertiser_ref: string;
  ad_ref_url: string;
  first_seen_date: string | null;
  raw_text_hash: string;
  confidence: number;
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const rows = loadCaptures();
  if (rows.length === 0) {
    console.error('no captures to classify — run capture first');
    process.exit(1);
  }

  const centroids = await getCentroids();
  const angleIds = Object.keys(centroids);

  // Embed every ad once, assign nearest centroid.
  const embeds = await embedBatch(rows.map((r) => r.ad_text));
  if (embeds.length !== rows.length || embeds.some((v) => !v)) {
    throw new Error('failed to embed captured ads (OpenAI embeddings unavailable)');
  }

  const snapshots: Snapshot[] = rows.map((r, i) => {
    let best = angleIds[0]!;
    let bestSim = -1;
    for (const id of angleIds) {
      const sim = cosine(embeds[i]!, centroids[id]!);
      if (sim > bestSim) {
        bestSim = sim;
        best = id;
      }
    }
    return {
      snapshot_date: r.snapshot_date,
      vertical: r.vertical,
      platform: r.platform,
      angle_id: best,
      advertiser_ref: r.advertiser_ref,
      ad_ref_url: r.source_url,
      first_seen_date: r.started_running,
      raw_text_hash: createHash('sha1').update(r.ad_text).digest('hex').slice(0, 16),
      confidence: Math.round(bestSim * 1000) / 1000,
    };
  });

  // ── Rebuild SQLite from scratch (disposable projection) ──────────────────
  const db = new DatabaseSync(SQLITE);
  db.exec('DROP TABLE IF EXISTS angle_snapshots; DROP TABLE IF EXISTS angle_daily_agg;');
  db.exec(`
    CREATE TABLE angle_snapshots (
      snapshot_date TEXT, vertical TEXT, platform TEXT,
      angle_id TEXT, angle_version TEXT,
      advertiser_ref TEXT, ad_ref_url TEXT,
      first_seen_date TEXT, raw_text_hash TEXT, confidence REAL
    );
    CREATE TABLE angle_daily_agg (
      snapshot_date TEXT, vertical TEXT, platform TEXT,
      angle_id TEXT, angle_version TEXT,
      distinct_advertisers INTEGER,
      new_entrants_7d INTEGER,
      entry_velocity REAL,
      window_state TEXT,
      window_score REAL
    );
  `);

  const insSnap = db.prepare(
    `INSERT INTO angle_snapshots VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const s of snapshots) {
    insSnap.run(s.snapshot_date, s.vertical, s.platform, s.angle_id, ANGLE_VERSION, s.advertiser_ref, s.ad_ref_url, s.first_seen_date, s.raw_text_hash, s.confidence);
  }

  // ── Aggregate: distinct advertisers + 7-day entrants + velocity + window ──
  // advertiser sets keyed by date|vertical|angle, for entrant diffing.
  const advByKey = new Map<string, Set<string>>();
  for (const s of snapshots) {
    const k = `${s.snapshot_date}|${s.vertical}|${s.angle_id}`;
    (advByKey.get(k) ?? advByKey.set(k, new Set()).get(k)!).add(s.advertiser_ref);
  }

  // saturation reference: max distinct advertisers in any angle within a vertical/date.
  const maxAdvByVerticalDate = new Map<string, number>();
  for (const [k, set] of advByKey) {
    const [date, vertical] = k.split('|');
    const vk = `${date}|${vertical}`;
    maxAdvByVerticalDate.set(vk, Math.max(maxAdvByVerticalDate.get(vk) ?? 0, set.size));
  }

  const insAgg = db.prepare(
    `INSERT INTO angle_daily_agg VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );

  let aggRows = 0;
  for (const [k, set] of advByKey) {
    const [snapshot_date, vertical, angle_id] = k.split('|') as [string, string, string];
    const distinct = set.size;

    // 7-day entrants: advertisers present now, absent 7 days ago (same vertical/angle).
    const priorKey = `${addDays(snapshot_date, -7)}|${vertical}|${angle_id}`;
    const prior = advByKey.get(priorKey);
    let newEntrants: number | null = null;
    let velocity: number | null = null;
    if (prior) {
      newEntrants = [...set].filter((a) => !prior.has(a)).length;
      velocity = Math.round((newEntrants / 7) * 1000) / 1000;
    }

    // window scoring (documented heuristic — §7; calibrated as data accrues):
    //   inverse_saturation = 1 - distinct/maxInVertical   (0 = most crowded, 1 = empty lane)
    //   velocity_norm      = min(1, velocity / 1)          (entrants/day, capped)
    //   window_score = 0.5*velocity_norm + 0.5*inverse_saturation   (until adjacency lands Day 2)
    const maxAdv = maxAdvByVerticalDate.get(`${snapshot_date}|${vertical}`) ?? distinct;
    const inverseSaturation = maxAdv ? 1 - distinct / maxAdv : 0;
    const velocityNorm = velocity == null ? 0 : Math.min(1, velocity / 1);
    const windowScore = Math.round((0.5 * velocityNorm + 0.5 * inverseSaturation) * 1000) / 1000;

    // state: until a 7-day baseline exists, we can only describe saturation → STABLE.
    let state = 'STABLE';
    if (velocity != null) {
      const heating = velocity >= 0.3;
      const crowded = distinct / (maxAdv || 1) >= 0.6;
      if (heating && crowded) state = 'AVOID';
      else if (heating) state = 'WATCH';
      else if (inverseSaturation >= 0.6) state = 'ENTER';
    }

    insAgg.run(snapshot_date, vertical, 'meta', angle_id, ANGLE_VERSION, distinct, newEntrants, velocity, state, windowScore);
    aggRows++;
  }

  // ── Report (ACTION line — verify from logs) ──────────────────────────────
  const byAngle = new Map<string, number>();
  for (const s of snapshots) byAngle.set(s.angle_id, (byAngle.get(s.angle_id) ?? 0) + 1);
  const dist = [...byAngle.entries()].sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a}:${n}`).join(' ');
  const dates = [...new Set(snapshots.map((s) => s.snapshot_date))].sort();
  db.close();

  console.log(`ATLAS CLASSIFY DONE · ${snapshots.length} ads → ${aggRows} angle/day cells · version=${ANGLE_VERSION}`);
  console.log(`  dates: ${dates.join(', ')}`);
  console.log(`  angle distribution: ${dist}`);
  console.log(`  sqlite: ${SQLITE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
