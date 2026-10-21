/**
 * brightdata.ts — live web recon, adapted from the AIdeazz fleet's
 * brightdata-enrich.ts (same /request endpoint, token+zone shape, raw format).
 *
 * Exposes the three primitives WHITESPACE needs:
 *   - bdFetch              Web Unlocker raw fetch (cheap, static/light-JS pages)
 *   - bdSerpSearch         SERP API via Web Unlocker proxy + brd_json=1
 *   - bdScrapingBrowserFetch  Web Unlocker + render:true (legacy Meta fallback)
 *   - bdBrowserApiFetch    Scraping Browser zone via CDP (best for Meta Ad Library)
 *   - bdMetaAdLibraryFetch orchestrator: Browser API → unlocker render → plain fetch
 *   - bdAdLibraryDiscover  Bright Data's own Meta Ad Library scraper (Web Scraper API, no KYC)
 *   - bdSmartFetch         orchestrator: unlock first, escalate to browser if thin
 *
 * All return null/[] on failure or when not configured, so the pipeline can
 * degrade to its synthetic-evidence path instead of crashing.
 */
import puppeteer from 'puppeteer-core';
import { config, hasBrightData, hasBrightDataBrowser } from './config.js';

const BD_API = 'https://api.brightdata.com/request';

export interface BDSerpResult {
  title: string;
  link: string;
  description?: string;
  rank?: number;
}

/**
 * Bright Data answers a refused target with 200 + an EMPTY body and the reason in x-brd-error
 * (20 Oct: "Access to this site is restricted … KYC" for facebook.com, "requires special permission"
 * for TikTok). Say it in the log instead of failing silently.
 */
async function bodyOrWhy(res: Response, tag: string, what: string): Promise<string | null> {
  const body = await res.text();
  if (!body) console.warn(`${tag} ${what} → empty body: ${(res.headers.get('x-brd-error') || 'no reason given').slice(0, 140)}`);
  return body || null;
}

/** Fetch a URL through Web Unlocker; returns raw body (HTML/markdown) or null. */
export async function bdFetch(url: string, timeoutMs = 45_000): Promise<string | null> {
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
    return bodyOrWhy(res, '[bd]', url);
  } catch (e) {
    console.warn(`[bd] fetch error ${url}:`, (e as Error).message);
    return null;
  }
}

/** Web Unlocker with render:true — legacy fallback when Scraping Browser zone is absent. */
export async function bdScrapingBrowserFetch(url: string, timeoutMs = config.metaFetchTimeoutMs): Promise<string | null> {
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
    return bodyOrWhy(res, '[bd-browser]', url);
  } catch (e) {
    console.warn(`[bd-browser] fetch error ${url}:`, (e as Error).message);
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Bright Data Scraping Browser (CDP) — recommended for Meta Ad Library. */
export async function bdBrowserApiFetch(url: string, timeoutMs = config.metaFetchTimeoutMs): Promise<string | null> {
  if (!hasBrightDataBrowser()) return null;
  const auth = config.brightDataBrowserAuth;
  let browser;
  try {
    browser = await puppeteer.connect({ browserWSEndpoint: `wss://${auth}@brd.superproxy.io:9222` });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(timeoutMs);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    // Meta Ad Library lazy-loads ad cards after initial paint.
    await page.waitForSelector('div[role="article"], [data-testid], div.x1yztbdb', { timeout: 20_000 }).catch(() => {});
    await sleep(6_000);
    const html = await page.content();
    return html.length > 800 ? html : null;
  } catch (e) {
    console.warn(`[bd-browser-api] fetch error ${url}:`, (e as Error).message);
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}

/**
 * Meta Ad Library fetch chain: Scraping Browser zone → unlocker render → plain fetch.
 * Callers should retry (see capture.ts).
 */
export async function bdMetaAdLibraryFetch(url: string, timeoutMs = config.metaFetchTimeoutMs): Promise<string | null> {
  // Scraping Browser is the priciest BD product. Cheap-mode (default) skips it and
  // uses Web Unlocker render, which is ~10x cheaper. Set WHITESPACE_META_USE_BROWSER=1
  // to re-enable the browser path for best ad yield when the account is funded.
  if (config.metaUseBrowser && hasBrightDataBrowser()) {
    const browserHtml = await bdBrowserApiFetch(url, timeoutMs);
    if (browserHtml) {
      console.log(`[bd-meta] Browser API OK (${browserHtml.length} bytes)`);
      return browserHtml;
    }
    console.warn('[bd-meta] Browser API failed — falling back to Web Unlocker render');
  }
  const rendered = await bdScrapingBrowserFetch(url, timeoutMs);
  if (rendered && rendered.length > 800) return rendered;
  return bdFetch(url, Math.min(timeoutMs, 45_000));
}

export interface BDAdLibraryAd {
  library_id?: string;
  advertiser_name?: string;
  title?: string;
  description?: string;
  caption?: string;
  link_url?: string;
  image_url?: string;
  start_date?: string;
  end_date?: string;
  is_active?: boolean;
  error?: string;
}

const AD_LIBRARY_DATASET = 'gd_mtveskb62h7q65ftgz'; // Bright Data "Meta - Ad Library" (Web Scraper API)

/**
 * Real Meta ads by keyword + country from Bright Data's OWN Ad Library scraper (Web Scraper API).
 * 21 Oct 2026: facebook.com through Web Unlocker / Scraping Browser needs KYC; this product does not.
 * Measured: "clinica dental" PA → 10 active ads with Library IDs in ~2 min. Free 5K records/month, then $1.5/1K.
 * Bright Data answers a slow job with a snapshot id instead of rows, so this polls until ready or maxWaitMs.
 */
export async function bdAdLibraryDiscover(
  keyword: string, country: string, limit = 12, maxWaitMs = 210_000, onWait?: (seconds: number) => void,
): Promise<BDAdLibraryAd[]> {
  if (!hasBrightData()) return [];
  const headers = { Authorization: `Bearer ${config.brightDataToken}`, 'Content-Type': 'application/json' };
  const qs = new URLSearchParams({
    dataset_id: AD_LIBRARY_DATASET, format: 'json', include_errors: 'true',
    type: 'discover_new', discover_by: 'keyword', limit_per_input: String(limit),
  });
  // The whole call fits in maxWaitMs, the POST included; each request gets only what is left of it.
  const t0 = Date.now();
  const left = () => Math.max(1_000, maxWaitMs - (Date.now() - t0));
  let snapshot: string | undefined;
  try {
    const res = await fetch(`https://api.brightdata.com/datasets/v3/scrape?${qs}`, {
      method: 'POST', headers,
      body: JSON.stringify({ input: [{ keyword, country: country.toUpperCase(), ad_type: 'All ads' }] }),
      signal: AbortSignal.timeout(Math.min(90_000, left())),
    });
    let body: any = await res.json().catch(() => null);
    snapshot = body && !Array.isArray(body) ? body.snapshot_id : undefined;
    while (snapshot && !Array.isArray(body) && Date.now() - t0 < maxWaitMs - 10_000) {
      await sleep(10_000);
      onWait?.(Math.round((Date.now() - t0) / 1000));
      // One bad poll (5xx, gateway HTML, slow answer) never throws away a job that is still running and billed.
      const p: any = await fetch(`https://api.brightdata.com/datasets/v3/progress/${snapshot}`, { headers, signal: AbortSignal.timeout(Math.min(30_000, left())) })
        .then((r) => r.json()).catch(() => null);
      if (p?.status === 'failed') break;
      if (p?.status === 'ready') {
        body = await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${snapshot}?format=json`, { headers, signal: AbortSignal.timeout(Math.min(60_000, left())) })
          .then((r) => r.json()).catch(() => null);
        if (!Array.isArray(body)) break; // ready but no rows (empty job): stop, do not re-download until the deadline
      }
    }
    if (!Array.isArray(body)) {
      if (snapshot) {
        // A job we stop waiting for is cancelled, so it is not billed for rows nobody reads.
        await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${snapshot}/cancel`, { method: 'POST', headers, signal: AbortSignal.timeout(15_000) }).catch(() => null);
      }
      console.warn(`[bd-adlib] "${keyword}" ${country}: no rows after ${Math.round((Date.now() - t0) / 1000)} s (${snapshot || JSON.stringify(body).slice(0, 160)})`);
      return [];
    }
    // Only ads still running are proof of today's market (the keyword search also returns stopped ones).
    const now = Date.now();
    const ads = (body as BDAdLibraryAd[]).filter((r) => r && !r.error && /^\d{8,20}$/.test(String(r.library_id || ''))
      && r.is_active !== false && !(r.end_date && Date.parse(r.end_date) < now));
    console.log(`[bd-adlib] "${keyword}" ${country}: ${ads.length} live ads of ${body.length} rows in ${Math.round((now - t0) / 1000)} s`);
    return ads;
  } catch (e) {
    console.warn(`[bd-adlib] "${keyword}" ${country} error:`, (e as Error).message);
    return [];
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
    // One retry with a longer wait: a single slow SERP answer left a free scan with no evidence (20 Oct).
    let res!: Response;
    for (const ms of [30_000, 45_000]) {
      try {
        res = await fetch(BD_API, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.brightDataToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ zone: config.brightDataZone, url, format: 'raw' }),
          signal: AbortSignal.timeout(ms),
        });
        break;
      } catch (e) {
        if (ms === 45_000) throw e;
        console.warn(`[bd-serp] retry "${query.slice(0, 40)}":`, (e as Error).message);
      }
    }
    if (!res.ok) {
      console.warn(`[bd-serp] ${query.slice(0, 40)} → ${res.status}`);
      return [];
    }
    const text = (await bodyOrWhy(res, '[bd-serp]', query.slice(0, 40))) || '';
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
    // Bright Data SERP exposes paid ads as top_ads / bottom_ads (+ shopping).
    const raw: any[] = [
      ...(Array.isArray(parsed.top_ads) ? parsed.top_ads : []),
      ...(Array.isArray(parsed.bottom_ads) ? parsed.bottom_ads : []),
      ...(Array.isArray(parsed.ads) ? parsed.ads : []),
      ...(Array.isArray(parsed.shopping) ? parsed.shopping : []),
    ];
    return raw
      .map((a: any) => {
        const link = a.link || a.url || '';
        let host = String(a.display_link || a.advertiser || a.source || link || '');
        try {
          host = new URL(host.startsWith('http') ? host : `https://${host}`).hostname.replace(/^www\./, '');
        } catch {
          /* keep raw host string */
        }
        return {
          advertiser: (host || 'unknown').slice(0, 80),
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

export { hasBrightData, hasBrightDataBrowser };
