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

/** Parse Meta's "Started running on Dec 22, 2025" → "2025-12-22" (else null). */
function parseStarted(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return null;
  const d = new Date(`${m[1]} ${m[2]}, ${m[3]} UTC`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
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
  advertiser_name: string;
  ad_text: string;
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
      advertiser_name: r.advertiser_name,
      ad_text: r.ad_text,
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
      first_seen_date TEXT, raw_text_hash TEXT, confidence REAL,
      advertiser_name TEXT, ad_text TEXT
    );
    CREATE TABLE angle_daily_agg (
      snapshot_date TEXT, vertical TEXT, platform TEXT,
      angle_id TEXT, angle_version TEXT,
      distinct_advertisers INTEGER,
      new_entrants_7d INTEGER,        -- OBSERVED (present now, absent at t-7); null until a 7-day baseline exists
      entry_velocity REAL,            -- observed entrants/day
      recent_launch_30d INTEGER,      -- PROXY: advertisers whose earliest ad in this angle launched <=30d before snapshot (Meta start dates)
      launch_share REAL,              -- recent_launch_30d / distinct_advertisers (fraction of lane that is freshly launched)
      saturation REAL,                -- distinct / max-in-vertical (0..1)
      adjacency REAL,                 -- co-occurrence strength to the hottest heating angle (0..1)
      window_state TEXT,              -- ENTER | WATCH | AVOID | STABLE
      window_score REAL,
      signal_basis TEXT,              -- observed | launch_proxy | saturation_only
      adjacency_note TEXT
    );
  `);

  const insSnap = db.prepare(
    `INSERT INTO angle_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const s of snapshots) {
    insSnap.run(s.snapshot_date, s.vertical, s.platform, s.angle_id, ANGLE_VERSION, s.advertiser_ref, s.ad_ref_url, s.first_seen_date, s.raw_text_hash, s.confidence, s.advertiser_name, s.ad_text);
  }

  // ── Aggregate per (date, vertical) ──────────────────────────────────────
  // Signal stack, leading → lagging:
  //   1. launch proxy  — fraction of a lane's advertisers whose ad LAUNCHED in the
  //      last 30d (from Meta "Started running on" dates). Observable from ONE
  //      snapshot, so motion shows immediately instead of waiting for day 7.
  //   2. observed 7d   — advertisers present now, absent at t-7 (real once a 7-day
  //      baseline exists ~Jul 1). Preferred over the proxy when available.
  //   3. adjacency     — co-occurrence: a low-saturation lane whose advertisers also
  //      run a HEATING lane is an open window adjacent to live demand.
  const PROXY_DAYS = 30;

  // global per date|vertical|angle advertiser sets, for the observed t-7 diff.
  const advByKey = new Map<string, Set<string>>();
  for (const s of snapshots) {
    const k = `${s.snapshot_date}|${s.vertical}|${s.angle_id}`;
    (advByKey.get(k) ?? advByKey.set(k, new Set()).get(k)!).add(s.advertiser_ref);
  }

  // group snapshots by date|vertical.
  const groups = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    const gk = `${s.snapshot_date}|${s.vertical}`;
    (groups.get(gk) ?? groups.set(gk, []).get(gk)!).push(s);
  }

  const insAgg = db.prepare(`INSERT INTO angle_daily_agg VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let aggRows = 0;
  const HEAT = 0.4; // heating threshold on normalized velocity/launch-share

  for (const [gk, rowsG] of groups) {
    const [snapshot_date, vertical] = gk.split('|') as [string, string];

    const angleAdv = new Map<string, Set<string>>();           // angle -> advertisers
    const firstLaunch = new Map<string, string>();             // angle|adv -> earliest launch date
    for (const s of rowsG) {
      (angleAdv.get(s.angle_id) ?? angleAdv.set(s.angle_id, new Set()).get(s.angle_id)!).add(s.advertiser_ref);
      const launched = parseStarted(s.first_seen_date);
      if (launched) {
        const fk = `${s.angle_id}|${s.advertiser_ref}`;
        const cur = firstLaunch.get(fk);
        if (!cur || launched < cur) firstLaunch.set(fk, launched);
      }
    }
    const hasLaunch = firstLaunch.size > 0;
    const maxAdv = Math.max(1, ...[...angleAdv.values()].map((s) => s.size));

    // per-angle: recent-launch proxy + the velocity used for heating/scoring.
    const recentLaunch = new Map<string, number>();
    const launchShare = new Map<string, number>();
    const velForScore = new Map<string, number>();
    const observed7d = new Map<string, number | null>();
    const observedVel = new Map<string, number | null>();
    const basis = new Map<string, string>();
    for (const [angle, advs] of angleAdv) {
      let recent = 0;
      for (const adv of advs) {
        const launched = firstLaunch.get(`${angle}|${adv}`);
        if (launched) {
          const age = daysBetween(snapshot_date, launched);
          if (age >= 0 && age <= PROXY_DAYS) recent++;
        }
      }
      recentLaunch.set(angle, recent);
      const share = advs.size ? recent / advs.size : 0;
      launchShare.set(angle, share);

      const prior = advByKey.get(`${addDays(snapshot_date, -7)}|${vertical}|${angle}`);
      if (prior) {
        const ne = [...advs].filter((a) => !prior.has(a)).length;
        observed7d.set(angle, ne);
        const v = Math.round((ne / 7) * 1000) / 1000;
        observedVel.set(angle, v);
        velForScore.set(angle, Math.min(1, v / 1));
        basis.set(angle, 'observed');
      } else {
        observed7d.set(angle, null);
        observedVel.set(angle, null);
        velForScore.set(angle, share);
        basis.set(angle, hasLaunch ? 'launch_proxy' : 'saturation_only');
      }
    }

    const heatingAngles = [...velForScore.entries()].filter(([, v]) => v >= HEAT).map(([a]) => a);

    for (const [angle, advs] of angleAdv) {
      const distinct = advs.size;
      const saturation = distinct / maxAdv;
      const inverseSat = 1 - saturation;
      const vel = velForScore.get(angle) ?? 0;

      // adjacency to demand: strongest advertiser-overlap with any HEATING angle.
      let adjacency = 0;
      let adjNote = '';
      for (const A of heatingAngles) {
        if (A === angle) continue;
        const aSet = angleAdv.get(A)!;
        let overlap = 0;
        for (const adv of advs) if (aSet.has(adv)) overlap++;
        const strength = distinct ? overlap / distinct : 0;
        if (strength > adjacency) {
          adjacency = strength;
          adjNote = `adjacent to heating ${A} (${Math.round(strength * 100)}% co-occurrence)`;
        }
      }

      const heating = vel >= HEAT;
      const crowded = saturation >= 0.6;
      let state = 'STABLE';
      if (heating && crowded) state = 'AVOID';
      else if (heating) state = 'WATCH';
      else if (inverseSat >= 0.5 && adjacency >= 0.3) state = 'ENTER';

      // documented heuristic: 40% momentum + 40% open-lane + 20% adjacency-to-demand.
      const windowScore = Math.round((0.4 * vel + 0.4 * inverseSat + 0.2 * adjacency) * 1000) / 1000;

      insAgg.run(
        snapshot_date, vertical, 'meta', angle, ANGLE_VERSION,
        distinct, observed7d.get(angle) ?? null, observedVel.get(angle) ?? null,
        recentLaunch.get(angle) ?? 0, Math.round((launchShare.get(angle) ?? 0) * 1000) / 1000,
        Math.round(saturation * 1000) / 1000, Math.round(adjacency * 1000) / 1000,
        state, windowScore, basis.get(angle) ?? 'saturation_only', adjNote || null,
      );
      aggRows++;
    }
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
