/**
 * meta-api.ts — official Meta Ad Library Graph API (when token is configured).
 *
 * Honest scope: the public `ads_archive` endpoint returns political/social-issue ads
 * and US special categories (housing, employment, credit). General US commercial
 * affiliate ads (solar, supplements, etc.) are visible in the browser UI but NOT
 * returned by this API. EU commercial ads have broader coverage post-DSA.
 *
 * We try API first when configured — structured JSON, no LLM extraction — then
 * fall back to Bright Data browser scrape for US commercial verticals.
 */
import { config, hasMetaAdLibraryApi } from './config.js';

const GRAPH = `https://graph.facebook.com/${config.metaGraphVersion}/ads_archive`;

export interface MetaApiRawAd {
  advertiser: string | null;
  copy: string;
  landingUrl: string | null;
  activitySignal: string | null;
  startedRunning: string | null;
}

interface AdsArchiveRow {
  id?: string;
  page_name?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_snapshot_url?: string;
  ad_delivery_start_time?: string;
  publisher_platforms?: string[];
}

function rowToAd(row: AdsArchiveRow): MetaApiRawAd | null {
  const body = (row.ad_creative_bodies || []).join(' ').trim();
  const title = (row.ad_creative_link_titles || []).join(' ').trim();
  const copy = [title, body].filter(Boolean).join(' — ').trim();
  if (copy.length < 9) return null;
  return {
    advertiser: row.page_name?.slice(0, 120) || null,
    copy: copy.slice(0, 1000),
    landingUrl: row.ad_snapshot_url?.slice(0, 500) || null,
    activitySignal: row.publisher_platforms?.length
      ? `platforms: ${row.publisher_platforms.join(', ')}`
      : 'Meta Ad Library API',
    startedRunning: row.ad_delivery_start_time?.slice(0, 80) || null,
  };
}

/** Search Meta Ad Library via Graph API. Returns [] when unconfigured or no matches. */
export async function metaApiSearchAds(query: string): Promise<MetaApiRawAd[]> {
  if (!hasMetaAdLibraryApi()) return [];

  const countries = config.metaApiCountries;
  const fields =
    'id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_delivery_start_time,ad_snapshot_url,publisher_platforms';
  const ads: MetaApiRawAd[] = [];
  let nextUrl: string | null = null;
  let pages = 0;
  const maxPages = config.metaApiMaxPages;

  const baseParams = new URLSearchParams({
    access_token: config.metaAdLibraryToken,
    search_terms: query,
    ad_reached_countries: JSON.stringify(countries),
    ad_type: 'ALL',
    ad_active_status: 'ACTIVE',
    fields,
    limit: String(config.metaApiPageSize),
  });

  try {
    do {
      const url = nextUrl || `${GRAPH}?${baseParams.toString()}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        const err = (await res.text()).slice(0, 200);
        console.warn(`[meta-api] ${query.slice(0, 40)} → ${res.status}: ${err}`);
        break;
      }
      const json = (await res.json()) as { data?: AdsArchiveRow[]; paging?: { next?: string } };
      for (const row of json.data || []) {
        const ad = rowToAd(row);
        if (ad) ads.push(ad);
      }
      nextUrl = json.paging?.next || null;
      pages++;
    } while (nextUrl && pages < maxPages);
  } catch (e) {
    console.warn(`[meta-api] error "${query.slice(0, 40)}":`, (e as Error).message);
  }

  return ads;
}

export { hasMetaAdLibraryApi };
