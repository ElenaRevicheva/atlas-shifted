/**
 * tracking.ts — stable join keys between Atlas creatives and AIdeazz performance hub.
 *
 * Every exported campaign gets the same UTM shape so GA4, business_leads, postbacks,
 * and Meta/Google ads can be correlated back to concept_id + vertical + angle.
 */
const LANDING = (process.env.ATLAS_LANDING_BASE || 'https://aideazz.xyz').replace(/\/$/, '');
const INGEST = (process.env.ATLAS_PERFORMANCE_INGEST_URL || 'https://webhook.aideazz.xyz/cto/api/performance-event').trim();

/** Per-vertical landing path/hash — EspaLuz dogfood lands on #espaluz, not generic hero. */
const VERTICAL_LANDING_SUFFIX: Record<string, string> = {
  expat_language: '#espaluz',
};

function buildLandingUrl(vertical: string, params: URLSearchParams): string {
  const suffix = VERTICAL_LANDING_SUFFIX[vertical] || process.env[`ATLAS_LANDING_${vertical.toUpperCase()}`]?.trim() || '';
  if (suffix.startsWith('#')) {
    return `${LANDING}/?${params}${suffix}`;
  }
  if (suffix.startsWith('http')) {
    const u = new URL(suffix);
    for (const [k, v] of params) u.searchParams.set(k, v);
    return u.toString();
  }
  if (suffix) {
    return `${LANDING}/${suffix.replace(/^\//, '')}?${params}`;
  }
  return `${LANDING}/?${params}`;
}

export interface AtlasTracking {
  concept_id: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  landing_url: string;
  performance_ingest_url: string;
}

export function buildAtlasTracking(vertical: string, snapshotDate: string, angleId: string): AtlasTracking {
  const concept_id = `${vertical}_${snapshotDate}`;
  const utm_campaign = `atlas_${vertical}`;
  const utm_content = angleId;
  const utm_term = concept_id;
  const params = new URLSearchParams({
    utm_source: 'meta',
    utm_medium: 'paid',
    utm_campaign: utm_campaign,
    utm_content: utm_content,
    utm_term: utm_term,
  });
  return {
    concept_id,
    utm_source: 'meta',
    utm_medium: 'paid',
    utm_campaign,
    utm_content,
    utm_term,
    landing_url: buildLandingUrl(vertical, params),
    performance_ingest_url: INGEST,
  };
}

/** Backfill tracking on concepts loaded from disk (older entries pre-bridge). */
export function enrichConceptTracking(concepts: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [vertical, entry] of Object.entries(concepts)) {
    if (!entry || typeof entry !== 'object') {
      out[vertical] = entry;
      continue;
    }
    const snap = String(entry.snapshot_date || '').trim();
    const angle = String(entry.move?.angle || entry.producer_brief?.angle || 'unknown').trim();
    out[vertical] = {
      ...entry,
      tracking: snap ? buildAtlasTracking(vertical, snap, angle) : entry.tracking,
    };
  }
  return out;
}

export function formatTrackingExportBlock(t: AtlasTracking): string {
  return [
    '',
    '── TRACKING (wire into ad + landing URL) ──',
    `concept_id: ${t.concept_id}`,
    `utm_campaign: ${t.utm_campaign}`,
    `utm_content: ${t.utm_content}`,
    `utm_term: ${t.utm_term}`,
    `utm_source: ${t.utm_source}`,
    `utm_medium: ${t.utm_medium}`,
    `Landing URL: ${t.landing_url}`,
    `Performance ingest: POST ${t.performance_ingest_url}`,
    '  (Bearer OUTREACH_SECRET — same as CTO AIPA fleet hub)',
  ].join('\n');
}

