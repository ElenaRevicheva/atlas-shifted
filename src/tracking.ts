/**
 * tracking.ts — stable join keys between Atlas creatives and AIdeazz performance hub.
 *
 * Every exported campaign gets the same UTM shape so GA4, business_leads, postbacks,
 * and Meta/Google ads can be correlated back to concept_id + vertical + angle.
 */
const LANDING = (process.env.ATLAS_LANDING_BASE || 'https://aideazz.xyz').replace(/\/$/, '');
const INGEST = (process.env.ATLAS_PERFORMANCE_INGEST_URL || 'https://webhook.aideazz.xyz/cto/api/performance-event').trim();
const CRM = (process.env.ATLAS_CRM_EVENT_URL || 'https://webhook.aideazz.xyz/cto/api/crm-event').trim();

/** Per-vertical landing path/hash — EspaLuz → #espaluz; client verticals → inquiry form. */
const VERTICAL_LANDING_SUFFIX: Record<string, string> = {
  expat_language: '#espaluz',
  ai_marketing_studios: '#inquiry-form',
};

const DEFAULT_CLIENT_LANDING_HASH = '#inquiry-form';

function buildLandingUrl(vertical: string, params: URLSearchParams): string {
  const suffix = VERTICAL_LANDING_SUFFIX[vertical]
    || process.env[`ATLAS_LANDING_${vertical.toUpperCase()}`]?.trim()
    || (vertical !== 'expat_language' ? DEFAULT_CLIENT_LANDING_HASH : '');
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
  crm_event_url: string;
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
    crm_event_url: CRM,
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
    `CRM hub (HubSpot): POST ${t.crm_event_url}`,
    '  (Bearer OUTREACH_SECRET — fleet agents + EspaLuz bots)',
    '  ESPALUZ → source=espaluz_telegram|espaluz_whatsapp, pipeline=client, userId, atlas_concept_id',
    '  CLIENT → pipeline=client, source=..., utm_campaign=atlas_{vertical}',
    '  HIRING → pipeline=hiring, jobTitle, company (VJH)',
  ].join('\n');
}

