/**
 * types.ts — the shared vocabulary of WHITESPACE.
 *
 * The pipeline is a funnel of transforms:
 *   vertical  →  AdCreative[]  →  AngleDNA[]  →  AngleCluster[]  →  Whitespace[]  →  BattlePlan
 *
 * Each stage narrows raw market noise into a single, defensible recommendation:
 * the high-margin angle the competition is NOT yet running.
 */

/**
 * Run mode — the ONLY thing that changes between the contest deliverable and
 * AIdeazz's own use. The recon source and the final synthesis differ; the core
 * (vision deconstruction → clustering → whitespace) is identical for both.
 *   - 'media_buyer' : It's Today Media flavor — ad libraries → ad battle plan
 *   - 'content'     : AIdeazz flavor — competitor content → omnichannel content brief
 */
export type RunMode = 'media_buyer' | 'content';

/** One ad/content unit pulled from a live public source. */
export interface AdCreative {
  id: string;
  source: 'meta_ad_library' | 'tiktok_creative_center' | 'serp' | 'competitor_content' | 'manual';
  advertiser: string | null;
  /** Direct URL to the creative image/thumbnail, if we found one (drives vision). */
  imageUrl: string | null;
  /** The ad's primary text / headline / caption as scraped. */
  copy: string;
  /** Landing/destination URL if present. */
  landingUrl: string | null;
  /** Free-text runtime/activity signal ("Active", "Started running May 3", impressions band). */
  activitySignal: string | null;
  /** Page the creative was discovered on — the evidence link. */
  sourceUrl: string;
}

/** Structured "DNA" of a single creative, produced by the vision/Claude deconstruction stage. */
export interface AngleDNA {
  creativeId: string;
  advertiser: string | null;
  /** The persuasion angle in 2-5 words, e.g. "fear of missing rates". */
  angle: string;
  /** Hook archetype, e.g. "shocking-stat", "us-vs-them", "before/after", "authority", "curiosity-gap". */
  hookType: string;
  /** Dominant emotion the ad pulls on, e.g. "anxiety", "aspiration", "greed", "relief". */
  emotion: string;
  /** The core claim/promise made. */
  claim: string;
  /** Visual pattern, e.g. "split-screen comparison", "talking-head UGC", "data chart overlay". */
  visualPattern: string;
  /** Call to action. */
  cta: string;
  /** Target persona the ad seems written for. */
  persona: string;
  /** Why this is (likely) working — the mechanism. */
  whyItWorks: string;
  sourceUrl: string;
}

/** A cluster of creatives sharing one persuasion angle — the "crowded lanes". */
export interface AngleCluster {
  angle: string;
  /** How saturated this angle is in the scanned market. */
  saturation: 'heavy' | 'moderate' | 'light';
  creativeCount: number;
  advertisers: string[];
  representativeHook: string;
  dominantEmotion: string;
  exampleSourceUrls: string[];
}

/** A whitespace opportunity — a proven-adjacent angle nobody (or almost nobody) is running. */
export interface Whitespace {
  /** The net-new angle to test. */
  angle: string;
  /** Why it's adjacent to what's already winning (the evidence-based bet). */
  rationale: string;
  /** Which crowded angle(s) it borrows heavily-used psychology from. */
  adjacentTo: string[];
  /** Hypothesis score 0-100 — how defensibly ADJACENT the bet is. NOT a predicted
   *  conversion rate (public data exposes no performance metrics). */
  confidence: number;
  /** The emotion this angle would own. */
  emotion: string;
  /** Suggested hook archetype for the new angle. */
  hookType: string;
}

/** The final deliverable — handed straight to a media buyer (or their video/LP generator). */
export interface BattlePlan {
  vertical: string;
  generatedAt: string;
  /** The single recommended angle to test first. */
  recommendation: Whitespace;
  /** Ready-to-run ad copy variants for the recommendation. */
  adCopy: Array<{ headline: string; primaryText: string; cta: string }>;
  /** Landing-page hook + above-the-fold concept matching the angle. */
  landingPage: { hook: string; subhead: string; heroConcept: string };
  /** The crowded lanes to AVOID (and why). */
  crowdedLanes: AngleCluster[];
  /** Other whitespace bets ranked below the top recommendation. */
  alternativeBets: Whitespace[];
  /** Sourced evidence trail — the live ads that justify the recommendation. */
  evidence: Array<{ advertiser: string | null; insight: string; sourceUrl: string }>;
  /** Operational metadata for trust. */
  meta: {
    creativesScanned: number;
    sources: string[];
    durationMs: number;
    llmProvider: string;
    degraded: boolean;
    notes: string[];
  };
}

/**
 * The AIdeazz-flavored deliverable (content mode). Same whitespace IP, but the
 * synthesis emits exactly what the AIdeazz marketing engine ingests:
 * a blog brief + per-channel social atoms + a HubSpot campaign angle.
 */
export interface ContentBrief {
  vertical: string;
  generatedAt: string;
  /** The content angle nobody is publishing yet. */
  recommendation: Whitespace;
  /** Blog brief — drops into the Dev.to / aideazz.xyz blog pipeline. */
  blog: {
    title: string;
    targetKeyword: string;
    outline: string[];
    aeoHint: string; // schema / answer-engine optimization note
  };
  /** Social atoms — drop into Buffer (LinkedIn / Instagram / X). */
  social: {
    linkedin: string;
    instagram: string;
    xThreadHook: string;
  };
  /** A one-line campaign angle for the HubSpot hub. */
  hubspotCampaignAngle: string;
  /** The crowded lanes to avoid (what competitors over-publish). */
  crowdedLanes: AngleCluster[];
  alternativeBets: Whitespace[];
  evidence: Array<{ advertiser: string | null; insight: string; sourceUrl: string }>;
  meta: BattlePlan['meta'];
}

/** Union of the two synthesis outputs; `kind` tells the UI which to render. */
export type RunOutput =
  | ({ kind: 'media_buyer' } & BattlePlan)
  | ({ kind: 'content' } & ContentBrief);

/** A progress event streamed to the live UI over SSE. */
export interface RunEvent {
  stage:
    | 'start'
    | 'recon'
    | 'creatives'
    | 'vision'
    | 'clustering'
    | 'whitespace'
    | 'battleplan'
    | 'done'
    | 'error';
  message: string;
  /** Optional structured payload (creatives found, partial clusters, final plan…). */
  data?: unknown;
  pct?: number;
}
