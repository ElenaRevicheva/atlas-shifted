/**
 * config.ts — env-driven configuration, loaded once at startup.
 *
 * Same discipline as the AIdeazz fleet: keys are read from .env via dotenv,
 * never hardcoded. Everything is overridable through environment variables so
 * the same bundle runs locally and on Oracle without code changes.
 */
import 'dotenv/config';

const num = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const config = {
  // LLM providers (resilient chain: Claude → Groq → OpenAI)
  anthropicKey: process.env.ANTHROPIC_API_KEY?.trim() || '',
  groqKey: process.env.GROQ_API_KEY?.trim() || '',
  openaiKey: process.env.OPENAI_API_KEY?.trim() || '',

  claudeModel: process.env.WHITESPACE_CLAUDE_MODEL?.trim() || 'claude-sonnet-4-6',
  claudeVisionModel: process.env.WHITESPACE_CLAUDE_VISION_MODEL?.trim() || 'claude-sonnet-4-6',
  groqModel: process.env.WHITESPACE_GROQ_MODEL?.trim() || 'llama-3.3-70b-versatile',
  openaiModel: process.env.WHITESPACE_OPENAI_MODEL?.trim() || 'gpt-4o-mini',
  xaiKey: process.env.XAI_API_KEY?.trim() || '',
  grokModel: process.env.WHITESPACE_GROK_MODEL?.trim() || 'grok-3',

  // Bright Data — live public ad-market recon
  brightDataToken: process.env.BRIGHTDATA_API_TOKEN?.trim() || '',
  brightDataZone: process.env.BRIGHTDATA_ZONE?.trim() || '',
  // Scraping Browser zone credentials: brd-customer-XXX-zone-YYY:password
  brightDataBrowserAuth: process.env.BRIGHTDATA_BROWSER_AUTH?.trim() || '',

  // Meta Ad Library Graph API (optional — US commercial ads still need browser scrape)
  metaAdLibraryToken: process.env.META_AD_LIBRARY_ACCESS_TOKEN?.trim() || '',
  metaGraphVersion: process.env.META_GRAPH_VERSION?.trim() || 'v21.0',
  metaApiCountries: (process.env.META_API_COUNTRIES || 'US')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean),
  metaApiPageSize: num(process.env.META_API_PAGE_SIZE, 100),
  metaApiMaxPages: num(process.env.META_API_MAX_PAGES, 3),

  // Meta page fetch tuning (Bright Data browser / unlocker)
  metaFetchTimeoutMs: num(process.env.WHITESPACE_META_FETCH_TIMEOUT_MS, 90_000),
  metaFetchRetries: num(process.env.WHITESPACE_META_FETCH_RETRIES, 3),
  metaFetchPauseMs: num(process.env.WHITESPACE_META_FETCH_PAUSE_MS, 4_000),
  metaVerticalPauseMs: num(process.env.WHITESPACE_META_VERTICAL_PAUSE_MS, 5_000),

  // Atuona Producer — image render via Replicate/Flux (the fleet's proven path)
  replicateToken: process.env.REPLICATE_API_TOKEN?.trim() || '',
  fluxModel: process.env.WHITESPACE_FLUX_MODEL?.trim() || 'black-forest-labs/flux-1.1-pro',

  // Server
  port: num(process.env.PORT, 8095),
  atlasPublicBase: (process.env.ATLAS_PUBLIC_BASE || 'https://webhook.aideazz.xyz/whitespace').replace(/\/$/, ''),

  // Telegram — fleet-compatible fallbacks (send-only; no polling conflict with CTO AIPA)
  telegramBotToken:
    process.env.ATLAS_TELEGRAM_BOT_TOKEN?.trim() ||
    process.env.TELEGRAM_BOT_TOKEN?.trim() ||
    '',
  telegramChatId:
    process.env.ATLAS_TELEGRAM_CHAT_ID?.trim() ||
    process.env.TELEGRAM_LEADS_DIGEST_CHAT_ID?.trim() ||
    process.env.TELEGRAM_DAILY_BLOG_NOTIFY_CHAT_ID?.trim() ||
    '',

  // Run controls
  maxCreatives: num(process.env.WHITESPACE_MAX_CREATIVES, 12),
  maxToolCalls: num(process.env.WHITESPACE_MAX_TOOL_CALLS, 10),
  runTimeoutMs: num(process.env.WHITESPACE_RUN_TIMEOUT_MS, 180_000),

  // Optional gate for /api/atlas/ship (Generate creative). Open when unset.
  shipToken: process.env.ATLAS_SHIP_TOKEN?.trim() || '',

  // Video providers (Runway → Luma failover in video.ts)
  runwayKey: process.env.RUNWAY_API_KEY?.trim() || '',
  lumaKey: process.env.LUMA_API_KEY?.trim() || '',
};

export const hasBrightData = (): boolean => !!(config.brightDataToken && config.brightDataZone);
export const hasBrightDataBrowser = (): boolean => !!config.brightDataBrowserAuth;
export const hasMetaAdLibraryApi = (): boolean => !!config.metaAdLibraryToken;
export const hasAnthropic = (): boolean => !!config.anthropicKey;
export const hasAnyLlm = (): boolean =>
  !!(config.anthropicKey || config.groqKey || config.openaiKey || config.xaiKey);
export const hasTelegram = (): boolean => !!(config.telegramBotToken && config.telegramChatId);
export const hasImageProviders = (): boolean => !!(config.replicateToken || config.openaiKey);
export const hasVideoProviders = (): boolean => !!(config.runwayKey || config.lumaKey);
export const shipTokenRequired = (): boolean => !!config.shipToken;
