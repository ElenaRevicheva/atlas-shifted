/**
 * brightdata.ts — live web recon, adapted from the AIdeazz fleet's
 * brightdata-enrich.ts (same /request endpoint, token+zone shape, raw format).
 *
 * Exposes the three primitives WHITESPACE needs:
 *   - bdFetch              Web Unlocker raw fetch (cheap, static/light-JS pages)
 *   - bdSerpSearch         SERP API via Web Unlocker proxy + brd_json=1
 *   - bdScrapingBrowserFetch  full headless render for JS-gated ad libraries
 *   - bdSmartFetch         orchestrator: unlock first, escalate to browser if thin
 *
 * All return null/[] on failure or when not configured, so the pipeline can
 * degrade to its synthetic-evidence path instead of crashing.
 */
import { config, hasBrightData } from './config.js';

const BD_API = 'https://api.brightdata.com/request';

export interface BDSerpResult {
  title: string;
  link: string;
  description?: string;
  rank?: number;
}

/** Fetch a URL through Web Unlocker; returns raw body (HTML/markdown) or null. */
export async function bdFetch(url: string, timeoutMs = 25_000): Promise<string | null> {
  if (!hasBrightData()) return null;
  try {
    const res = await fetch(BD_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.brightDataToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: config.brightDataZone, url, format: 'raw' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.warn(`[bd] ${url} → ${res.status}: ${(await res.text()).slice(0, 160)}`);
      return null;
    }
    return res.text();
  } catch (e) {
    console.warn(`[bd] fetch error ${url}:`, (e as Error).message);
    return null;
  }
}

/** Full headless render — for JS-gated ad libraries (Meta/TikTok). */
export async function bdScrapingBrowserFetch(url: string, timeoutMs = 50_000): Promise<string | null> {
  if (!hasBrightData()) return null;
  try {
    const res = await fetch(BD_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.brightDataToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: config.brightDataZone, url, format: 'raw', render: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.warn(`[bd-browser] ${url} → ${res.status}: ${(await res.text()).slice(0, 160)}`);
      return null;
    }
    return res.text();
  } catch (e) {
    console.warn(`[bd-browser] fetch error ${url}:`, (e as Error).message);
    return null;
  }
}

/** Unlock first; escalate to Scraping Browser when the body is thin/JS-gated. */
export async function bdSmartFetch(url: string): Promise<string | null> {
  const fast = await bdFetch(url);
  if (fast && fast.length > 800 && !/please\s+enable\s+javascript|<noscript>/i.test(fast)) return fast;
  if (fast) console.log(`[bd-smart] thin/JS-gated ${url} — escalating to browser`);
  return bdScrapingBrowserFetch(url);
}

/** Google SERP via Bright Data (brd_json=1). Used for native/Taboola spy discovery. */
export async function bdSerpSearch(
  query: string,
  opts: { num?: number; gl?: string; hl?: string } = {},
): Promise<BDSerpResult[]> {
  if (!hasBrightData()) return [];
  const params = new URLSearchParams({
    q: query,
    hl: opts.hl ?? 'en',
    gl: opts.gl ?? 'us',
    num: String(opts.num ?? 10),
    brd_json: '1',
  });
  const url = `https://www.google.com/search?${params.toString()}`;
  try {
    const res = await fetch(BD_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.brightDataToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: config.brightDataZone, url, format: 'raw' }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.warn(`[bd-serp] ${query.slice(0, 40)} → ${res.status}`);
      return [];
    }
    const text = await res.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      return [];
    }
    const organic: any[] = parsed.organic || parsed.organic_results || [];
    return organic
      .map((r: any, i: number) => ({
        title: r.title || '',
        link: r.link || r.url || '',
        description: r.description || r.snippet || '',
        rank: r.rank || i + 1,
      }))
      .filter((r: BDSerpResult) => r.link);
  } catch (e) {
    console.warn(`[bd-serp] error "${query.slice(0, 40)}":`, (e as Error).message);
    return [];
  }
}

export interface BDSerpAd {
  advertiser: string;
  title: string;
  description: string;
  link: string;
}

/**
 * Google SEARCH ads (paid results) for a query, via the Bright Data SERP API
 * (brd_json=1). This is the reliable Google signal: the Ads Transparency Center
 * is a JS SPA that yields nothing to a static scrape, but the live SERP exposes
 * the actual advertisers bidding on the vertical right now. Returns [] on failure.
 */
export async function bdSerpAds(query: string, opts: { num?: number; gl?: string; hl?: string } = {}): Promise<BDSerpAd[]> {
  if (!hasBrightData()) return [];
  const params = new URLSearchParams({
    q: query,
    hl: opts.hl ?? 'en',
    gl: opts.gl ?? 'us',
    num: String(opts.num ?? 20),
    brd_json: '1',
  });
  const url = `https://www.google.com/search?${params.toString()}`;
  try {
    const res = await fetch(BD_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.brightDataToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: config.brightDataZone, url, format: 'raw' }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.warn(`[bd-serp-ads] ${query.slice(0, 40)} → ${res.status}`);
      return [];
    }
    let parsed: any;
    try {
      parsed = JSON.parse(await res.text());
    } catch {
      return [];
    }
    // Bright Data SERP exposes paid ads under a few shapes; gather them all.
    let raw: any[] = [];
    if (Array.isArray(parsed.ads)) raw = parsed.ads;
    else if (parsed.ads && (parsed.ads.top || parsed.ads.bottom)) raw = [...(parsed.ads.top || []), ...(parsed.ads.bottom || [])];
    else if (Array.isArray(parsed.ads_results)) raw = parsed.ads_results;
    return raw
      .map((a: any) => {
        const link = a.link || a.url || a.display_link || '';
        let host = a.advertiser || a.source || a.display_link || '';
        if (!host && link) {
          try {
            host = new URL(link.startsWith('http') ? link : `https://${link}`).hostname.replace(/^www\./, '');
          } catch {
            host = '';
          }
        }
        return {
          advertiser: String(host || 'unknown').slice(0, 80),
          title: String(a.title || '').slice(0, 200),
          description: String(a.description || a.snippet || '').slice(0, 400),
          link: String(link).slice(0, 400),
        };
      })
      .filter((a: BDSerpAd) => a.title || a.description);
  } catch (e) {
    console.warn(`[bd-serp-ads] error "${query.slice(0, 40)}":`, (e as Error).message);
    return [];
  }
}

/** Strip tags + collapse whitespace; cap length for token efficiency. */
export function htmlToText(html: string, cap = 12_000): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, cap);
}

export { hasBrightData };
