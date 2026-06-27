/**
 * verticals.ts — seed + user-tracked verticals for daily capture.
 * "Add to radar" registers here; cron captures all of them every morning.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const TRACKED_FILE = join(DATA_DIR, 'tracked-verticals.json');
const JSONL = join(DATA_DIR, 'captures.jsonl');

export type VerticalDef = { id: string; queries: string[] };

export const SEED_VERTICALS: VerticalDef[] = [
  { id: 'auto_insurance', queries: ['auto insurance'] },
  { id: 'solar', queries: ['solar panels'] },
  { id: 'debt_finance', queries: ['debt relief'] },
  { id: 'health_supplements', queries: ['health supplement'] },
  {
    id: 'expat_language',
    queries: ['learn spanish', 'move abroad spanish', 'spanish for expats', 'relocation language'],
  },
];

export const SEED_IDS = new Set(SEED_VERTICALS.map((v) => v.id));

const VERTICAL_ORDER = ['solar', 'auto_insurance', 'debt_finance', 'health_supplements', 'expat_language'];

export interface TrackedVertical {
  id: string;
  label: string;
  added_at: string;
}

interface TrackedStore {
  verticals: TrackedVertical[];
}

function readStore(): TrackedStore {
  if (!existsSync(TRACKED_FILE)) return { verticals: [] };
  try {
    const raw = JSON.parse(readFileSync(TRACKED_FILE, 'utf8')) as TrackedStore;
    return { verticals: Array.isArray(raw.verticals) ? raw.verticals : [] };
  } catch {
    return { verticals: [] };
  }
}

function writeStore(store: TrackedStore): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(TRACKED_FILE, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

/** Slug for UI-typed vertical labels. */
export function verticalSlug(label: string): string {
  const s = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return (s || 'custom').slice(0, 48);
}

/** Register a user vertical for daily cron (idempotent). */
export function registerTrackedVertical(label: string): { id: string; isNew: boolean; isSeed: boolean } {
  const q = label.trim();
  const id = verticalSlug(q);
  if (!q) throw new Error('empty vertical');
  if (SEED_IDS.has(id)) return { id, isNew: false, isSeed: true };

  const store = readStore();
  const existing = store.verticals.find((v) => v.id === id);
  if (existing) return { id, isNew: false, isSeed: false };

  store.verticals.push({ id, label: q, added_at: new Date().toISOString() });
  store.verticals.sort((a, b) => a.id.localeCompare(b.id));
  writeStore(store);
  return { id, isNew: true, isSeed: false };
}

export function readTrackedVerticals(): TrackedVertical[] {
  return readStore().verticals;
}

/** Backfill tracked list from captures.jsonl for verticals captured before persistence existed. */
function discoverFromJsonl(): VerticalDef[] {
  if (!existsSync(JSONL)) return [];
  const byId = new Map<string, string>();
  for (const line of readFileSync(JSONL, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as { vertical?: string; query?: string };
      if (!r.vertical || SEED_IDS.has(r.vertical) || byId.has(r.vertical)) continue;
      byId.set(r.vertical, (r.query || r.vertical.replace(/_/g, ' ')).trim());
    } catch {
      /* skip bad line */
    }
  }
  return [...byId.entries()].map(([id, query]) => ({ id, queries: [query] }));
}

/** One-time-safe sync: persist jsonl orphans into tracked-verticals.json (called at cron start only). */
export function syncTrackedOrphansFromJsonl(): number {
  const store = readStore();
  let added = 0;
  for (const d of discoverFromJsonl()) {
    if (store.verticals.some((v) => v.id === d.id)) continue;
    store.verticals.push({ id: d.id, label: d.queries[0]!, added_at: new Date().toISOString() });
    added++;
  }
  if (added > 0) {
    store.verticals.sort((a, b) => a.id.localeCompare(b.id));
    writeStore(store);
  }
  return added;
}

function mergeQueries(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

/** All verticals the daily cron should capture (seed + tracked + jsonl orphans). */
export function getCaptureTargets(only?: string): VerticalDef[] {
  const byId = new Map<string, VerticalDef>();

  for (const v of SEED_VERTICALS) byId.set(v.id, { ...v, queries: [...v.queries] });

  for (const t of readStore().verticals) {
    if (SEED_IDS.has(t.id)) continue;
    const prev = byId.get(t.id);
    byId.set(t.id, prev ? { id: t.id, queries: mergeQueries(prev.queries, [t.label]) } : { id: t.id, queries: [t.label] });
  }

  for (const d of discoverFromJsonl()) {
    if (SEED_IDS.has(d.id)) continue;
    const prev = byId.get(d.id);
    byId.set(d.id, prev ? { id: d.id, queries: mergeQueries(prev.queries, d.queries) } : d);
  }

  let targets = [...byId.values()];
  if (only) targets = targets.filter((v) => v.id === only);
  return orderVerticals(targets);
}

export function orderVerticals(targets: VerticalDef[]): VerticalDef[] {
  return [...targets].sort((a, b) => {
    const ia = VERTICAL_ORDER.indexOf(a.id);
    const ib = VERTICAL_ORDER.indexOf(b.id);
    const sa = ia === -1 ? 1000 : ia;
    const sb = ib === -1 ? 1000 : ib;
    return sa - sb || a.id.localeCompare(b.id);
  });
}

export function knownVerticalIds(): string[] {
  return getCaptureTargets().map((v) => v.id);
}
