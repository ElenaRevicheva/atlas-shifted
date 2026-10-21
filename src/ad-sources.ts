/**
 * ad-sources.ts — live, PUBLIC ad-market recon.
 *
 * The whole demo runs on data anyone can see, so it works on day one with zero
 * access to It's Today Media's ad accounts:
 *   - Meta Ad Library       (facebook.com/ads/library) — every active ad, public by law
 *   - TikTok Creative Center (ads.tiktok.com/.../inspiration/topads) — public Top Ads
 *
 * We fetch via Bright Data (Scraping Browser for these JS-gated libraries), then
 * use the LLM to extract structure from the messy rendered HTML — the same
 * "LLM over scraped text" pattern the fleet's research-agent uses. Image URLs are
 * additionally regex-harvested from the raw HTML so the vision stage has real
 * creatives to deconstruct.
 *
 * If Bright Data isn't configured, recon returns [] and the agent degrades to an
 * LLM market-knowledge pass that is CLEARLY flagged (meta.degraded = true). We
 * never present synthesized ads as if they were scraped evidence.
 */
import { config, hasBrightData } from './config.js';
import { bdAdLibraryDiscover, bdScrapingBrowserFetch, bdFetch, bdSmartFetch, bdSerpSearch, htmlToText, type BDAdLibraryAd } from './brightdata.js';
import { llmJson } from './llm.js';
import type { AdCreative } from './types.js';

// country (19 Oct 2026): the public one-shot scan can look at a LatAm market (PA, CR, CO…).
// The weekly capture (capture.ts) keeps its own US URL.
const META_LIBRARY = (q: string, country = 'US') =>
  `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${encodeURIComponent(
    country,
  )}&media_type=all&q=${encodeURIComponent(q)}&search_type=keyword_unordered`;

const TIKTOK_TOPADS = (q: string) =>
  `https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?keyword=${encodeURIComponent(q)}`;

/** Harvest image/thumbnail URLs straight from raw HTML (CDN patterns). */
function harvestImageUrls(rawHtml: string): string[] {
  const urls = new Set<string>();
  const re =
    /https?:\/\/[^\s"'\\)]+?(?:fbcdn\.net|cdninstagram\.com|tiktokcdn[^\s"'\\)]*|byteimg\.com|ibyteimg\.com)[^\s"'\\)]*\.(?:jpe?g|png|webp)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawHtml)) !== null) {
    const u = m[0].replace(/&amp;/g, '&');
    if (!/spacer|blank|1x1|emoji|static\/images\/icons/i.test(u)) urls.add(u);
    if (urls.size >= 40) break;
  }
  return [...urls];
}

interface ExtractedAd {
  advertiser: string | null;
  copy: string;
  landingUrl: string | null;
  activitySignal: string | null;
  imageUrl: string | null;
}

async function extractAdsFromHtml(
  rawHtml: string,
  vertical: string,
  source: AdCreative['source'],
  sourceUrl: string,
): Promise<AdCreative[]> {
  const text = htmlToText(rawHtml, 28_000);
  const images = harvestImageUrls(rawHtml);

  const { value } = await llmJson<ExtractedAd[]>(
    `You are extracting ADVERTISEMENTS from the scraped text of a public ad library page for the vertical "${vertical}".
From the page text below, extract up to 12 distinct ads. For each ad return:
- advertiser: the brand/page name running it (null if not visible)
- copy: the ad's primary text / headline / caption (the persuasive words)
- landingUrl: destination URL if present (else null)
- activitySignal: any runtime/impressions/"active" signal text, including the ad's "Library ID: <digits>" exactly as shown (else null)
- imageUrl: null (images are handled separately)

Return ONLY a JSON array. Skip navigation, cookie banners, and UI chrome. If you cannot find real ads, return [].

PAGE TEXT:
---
${text}
---`,
    { fallback: [], maxTokens: 4096 },
  );

  const ads = Array.isArray(value) ? value : [];
  // Attach harvested images round-robin so the vision stage has real creatives.
  return ads
    .filter((a) => a && typeof a.copy === 'string' && a.copy.trim().length > 8)
    .slice(0, config.maxCreatives)
    .map((a, i) => ({
      id: `${source}-${i + 1}`,
      source,
      advertiser: a.advertiser?.toString().slice(0, 80) || null,
      imageUrl: images[i] ?? null,
      copy: a.copy.toString().slice(0, 600),
      landingUrl: a.landingUrl?.toString().slice(0, 300) || null,
      activitySignal: a.activitySignal?.toString().slice(0, 120) || null,
      sourceUrl: adPermalink(a.activitySignal, text, source) || sourceUrl,
    }));
}

/** Link the proof to the ad itself, never the search page — only when its Library ID is verbatim on the page. */
function adPermalink(signal: unknown, pageText: string, source: AdCreative['source']): string | null {
  const id = /Library ID:?\s*(\d{8,20})/i.exec(String(signal || ''))?.[1];
  return source === 'meta_ad_library' && id && pageText.includes(id) ? `https://www.facebook.com/ads/library/?id=${id}` : null;
}

/** Bright Data Ad Library rows → creatives whose evidence link is the ad itself. */
function adLibraryCreatives(ads: BDAdLibraryAd[]): AdCreative[] {
  return ads
    .map((a, i): AdCreative => ({
      id: `meta_ad_library-${i + 1}`,
      source: 'meta_ad_library',
      advertiser: a.advertiser_name?.slice(0, 80) || null,
      imageUrl: a.image_url || null,
      copy: [a.title, a.description || a.caption].filter(Boolean).join(' — ').slice(0, 600),
      landingUrl: a.link_url?.slice(0, 300) || null,
      activitySignal: `${a.start_date ? `Started running on ${a.start_date.slice(0, 10)} · ` : ''}Library ID: ${a.library_id}`,
      sourceUrl: `https://www.facebook.com/ads/library/?id=${a.library_id}`,
    }))
    .filter((c) => c.copy.length > 8);
}

/** Recon Meta Ad Library for a vertical. */
export async function reconMeta(vertical: string, country = 'US', onProgress?: (msg: string) => void): Promise<AdCreative[]> {
  if (!hasBrightData()) return [];
  // Bright Data's own Ad Library scraper first: real ads, each linked to itself (21 Oct 2026). The page-reading path
  // below needs KYC for facebook.com and stays only as a fallback.
  // Bright Data's job took 101-200+ s on 21 Oct for the same kind of search; 330 s keeps real proof within reach (the SSE
  // stream stays open on its 15 s keep-alives, the page shows the running seconds).
  const found = adLibraryCreatives(await bdAdLibraryDiscover(vertical, country, config.maxCreatives, 330_000,
    (s) => onProgress?.(`Meta Ad Library still collecting live ads (${s} s)…`)).catch(() => []));
  if (found.length) return found;
  const url = META_LIBRARY(vertical, country);
  const html = (await bdScrapingBrowserFetch(url)) || (await bdFetch(url));
  if (!html) return [];
  return extractAdsFromHtml(html, vertical, 'meta_ad_library', url);
}

/** Recon TikTok Creative Center Top Ads for a vertical. */
export async function reconTikTok(vertical: string): Promise<AdCreative[]> {
  if (!hasBrightData()) return [];
  const url = TIKTOK_TOPADS(vertical);
  const html = (await bdScrapingBrowserFetch(url)) || (await bdFetch(url));
  if (!html) return [];
  return extractAdsFromHtml(html, vertical, 'tiktok_creative_center', url);
}

// ── Content-mode recon (AIdeazz) ───────────────────────────────────────────
// Instead of ad libraries, mine what competitors PUBLISH for a topic: the top
// SERP results + their on-page messaging. Reuses the fleet's research-agent
// pattern (SERP discovery → scrape → LLM extraction). Each result becomes an
// AdCreative whose "copy" is the page's headline/positioning, so the same
// vision/clustering/whitespace core applies unchanged.
async function extractContentAngle(
  rawHtml: string,
  topic: string,
  advertiser: string,
  sourceUrl: string,
  idx: number,
): Promise<AdCreative | null> {
  const text = htmlToText(rawHtml, 16_000);
  const { value } = await llmJson<{ headline: string; positioning: string; cta: string | null }>(
    `From this competitor page about "${topic}", extract its marketing message. Return ONLY JSON:
{ "headline": "the main headline / value prop", "positioning": "1-2 sentence summary of the angle they take", "cta": "their primary CTA or null" }

PAGE TEXT:
---
${text}
---`,
    { fallback: { headline: '', positioning: '', cta: null }, maxTokens: 600 },
  );
  const copy = [value.headline, value.positioning].filter(Boolean).join(' — ').trim();
  if (copy.length < 12) return null;
  return {
    id: `content-${idx + 1}`,
    source: 'competitor_content',
    advertiser: advertiser.slice(0, 80),
    imageUrl: null,
    copy: copy.slice(0, 600),
    landingUrl: sourceUrl,
    activitySignal: 'ranking on Google',
    sourceUrl,
  };
}

export async function reconContentSources(
  topic: string,
  onProgress?: (msg: string) => void,
  country = 'US',
): Promise<{ creatives: AdCreative[]; sources: string[]; degraded: boolean }> {
  if (!hasBrightData()) {
    onProgress?.('Bright Data not configured — degrading to LLM market-knowledge mode (flagged).');
    return { creatives: [], sources: [], degraded: true };
  }

  // Who pays to advertise this topic here: real Meta ads, read in parallel with the search below (21 Oct 2026).
  const metaP = bdAdLibraryDiscover(topic, country, 6).catch(() => []);
  onProgress?.(`Searching what ranks for "${topic}" and who advertises it on Meta…`);
  const q = `${topic} marketing OR services OR agency`;
  let serp = await bdSerpSearch(q, { num: 10, gl: country.toLowerCase() }).catch(() => []);
  // Bright Data sometimes answers a niche local query with an empty body (20 Oct: PA empty twice, US 8 results);
  // fall back to US results rather than hand the visitor a scan with no clickable proof.
  let serpGl = country.toUpperCase();
  if (!serp.length && serpGl !== 'US') {
    onProgress?.(`No ${serpGl} results answered — reading what ranks in the US instead…`);
    serp = await bdSerpSearch(q, { num: 10, gl: 'us' }).catch(() => []);
    serpGl = 'US';
  }
  onProgress?.(`Found ${serp.length} ranking competitors. Reading their positioning…`);

  // Parallelize with bounded concurrency — sequential heavy fetches were the
  // main time sink. Use the fast Web Unlocker fetch (no browser escalation):
  // competitor marketing pages are server-rendered enough to extract positioning.
  // Bright Data refuses these hosts without KYC (21 Oct: 2 of 3 picks were YouTube), so the slots go to pages it can read.
  const refused = /(^|\.)(youtube\.com|youtu\.be|facebook\.com|instagram\.com|tiktok\.com)$/i;
  const top = serp.filter((r) => { try { return !refused.test(new URL(r.link).hostname); } catch { return false; } }).slice(0, config.maxCreatives);
  const out: AdCreative[] = [];
  const concurrency = 4;
  for (let i = 0; i < top.length; i += concurrency) {
    const batch = top.slice(i, i + concurrency);
    const settled = await Promise.all(
      batch.map(async (r, j) => {
        if (!r) return null;
        const html = await bdFetch(r.link, 18_000).catch(() => null);
        if (!html || html.length < 400) return null;
        const advertiser = r.title?.split(/[-|–:]/)[0]?.trim() || new URL(r.link).hostname.replace(/^www\./, '');
        return extractContentAngle(html, topic, advertiser, r.link, i + j).catch(() => null);
      }),
    );
    for (const c of settled) if (c) out.push(c);
    onProgress?.(`Read ${Math.min(i + concurrency, top.length)}/${top.length} competitors…`);
    if (out.length >= config.maxCreatives) break;
  }

  onProgress?.(`Captured positioning from ${out.length} competitors.`);
  // The Meta job gets at most 45 s more once the search part is done; late ads are dropped, the visitor is not held.
  const ads = adLibraryCreatives(await Promise.race([metaP, new Promise<BDAdLibraryAd[]>((r) => setTimeout(() => r([]), 45_000))]));
  onProgress?.(`Meta Ad Library (${country.toUpperCase()}): ${ads.length} live ads for this topic.`);
  const sources = [...(out.length ? [`Google SERP (${serpGl})`, 'Competitor sites'] : []), ...(ads.length ? ['Meta Ad Library'] : [])];
  return {
    creatives: [...out.slice(0, Math.max(0, config.maxCreatives - ads.length)), ...ads],
    sources,
    degraded: out.length + ads.length === 0,
  };
}

/** Run all sources, merge + dedupe by (advertiser+copy), cap to maxCreatives. */
export async function reconAllSources(
  vertical: string,
  onProgress?: (msg: string) => void,
  country = 'US',
): Promise<{ creatives: AdCreative[]; sources: string[]; degraded: boolean }> {
  if (!hasBrightData()) {
    onProgress?.('Bright Data not configured — degrading to LLM market-knowledge mode (flagged).');
    return { creatives: [], sources: [], degraded: true };
  }

  onProgress?.(`Scanning Meta Ad Library (${country})…`);
  const meta = await reconMeta(vertical, country, onProgress).catch(() => []);
  onProgress?.(`Meta Ad Library: ${meta.length} creatives.`);

  onProgress?.('Scanning TikTok Creative Center…');
  const tiktok = await reconTikTok(vertical).catch(() => []);
  onProgress?.(`TikTok Creative Center: ${tiktok.length} creatives.`);

  const seen = new Set<string>();
  const merged: AdCreative[] = [];
  for (const c of [...meta, ...tiktok]) {
    const key = `${(c.advertiser || '').toLowerCase()}::${c.copy.slice(0, 60).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
    if (merged.length >= config.maxCreatives) break;
  }

  const sources: string[] = [];
  if (meta.length) sources.push('Meta Ad Library');
  if (tiktok.length) sources.push('TikTok Creative Center');

  return { creatives: merged, sources, degraded: merged.length === 0 };
}
