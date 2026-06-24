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
import { bdScrapingBrowserFetch, bdFetch, bdSmartFetch, bdSerpSearch, htmlToText } from './brightdata.js';
import { llmJson } from './llm.js';
import type { AdCreative } from './types.js';

const META_LIBRARY = (q: string) =>
  `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&media_type=all&q=${encodeURIComponent(
    q,
  )}&search_type=keyword_unordered`;

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
- activitySignal: any runtime/impressions/"active" signal text (else null)
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
      sourceUrl,
    }));
}

/** Recon Meta Ad Library for a vertical. */
export async function reconMeta(vertical: string): Promise<AdCreative[]> {
  if (!hasBrightData()) return [];
  const url = META_LIBRARY(vertical);
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
): Promise<{ creatives: AdCreative[]; sources: string[]; degraded: boolean }> {
  if (!hasBrightData()) {
    onProgress?.('Bright Data not configured — degrading to LLM market-knowledge mode (flagged).');
    return { creatives: [], sources: [], degraded: true };
  }

  onProgress?.(`Searching what ranks for "${topic}"…`);
  const serp = await bdSerpSearch(`${topic} marketing OR services OR agency`, { num: 10 }).catch(() => []);
  onProgress?.(`Found ${serp.length} ranking competitors. Reading their positioning…`);

  const top = serp.slice(0, config.maxCreatives);
  const out: AdCreative[] = [];
  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    if (!r) continue;
    const html = await bdSmartFetch(r.link).catch(() => null);
    if (!html) continue;
    const advertiser = r.title?.split(/[-|–:]/)[0]?.trim() || new URL(r.link).hostname.replace(/^www\./, '');
    const c = await extractContentAngle(html, topic, advertiser, r.link, i).catch(() => null);
    if (c) out.push(c);
    if (out.length >= config.maxCreatives) break;
  }

  onProgress?.(`Captured positioning from ${out.length} competitors.`);
  return {
    creatives: out,
    sources: out.length ? ['Google SERP', 'Competitor sites'] : [],
    degraded: out.length === 0,
  };
}

/** Run all sources, merge + dedupe by (advertiser+copy), cap to maxCreatives. */
export async function reconAllSources(
  vertical: string,
  onProgress?: (msg: string) => void,
): Promise<{ creatives: AdCreative[]; sources: string[]; degraded: boolean }> {
  if (!hasBrightData()) {
    onProgress?.('Bright Data not configured — degrading to LLM market-knowledge mode (flagged).');
    return { creatives: [], sources: [], degraded: true };
  }

  onProgress?.('Scanning Meta Ad Library…');
  const meta = await reconMeta(vertical).catch(() => []);
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
