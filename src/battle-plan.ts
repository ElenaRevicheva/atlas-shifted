/**
 * battle-plan.ts — turn the top whitespace angle into a ready-to-ship brief.
 *
 * This is the artifact a media buyer (or It's Today Media's existing video/LP
 * generator) consumes directly: the recommended angle, ad-copy variants, a
 * landing-page hook, the crowded lanes to avoid, and a sourced evidence trail.
 */
import { llmJson } from './llm.js';
import type { AngleCluster, Whitespace, AngleDNA, BattlePlan } from './types.js';

interface CopyOut {
  adCopy: Array<{ headline: string; primaryText: string; cta: string }>;
  landingPage: { hook: string; subhead: string; heroConcept: string };
}

const EMPTY: CopyOut = {
  adCopy: [],
  landingPage: { hook: '', subhead: '', heroConcept: '' },
};

export async function buildBattlePlan(args: {
  vertical: string;
  clusters: AngleCluster[];
  whitespace: Whitespace[];
  dna: AngleDNA[];
  meta: BattlePlan['meta'];
}): Promise<BattlePlan> {
  const { vertical, clusters, whitespace, dna, meta } = args;
  const top = whitespace[0];

  let copy: CopyOut = EMPTY;
  if (top) {
    const { value } = await llmJson<CopyOut>(
      `You are a direct-response copywriter. For the vertical "${vertical}", write launch-ready creative for this NEW angle:

ANGLE: ${top.angle}
WHY IT SHOULD WORK: ${top.rationale}
EMOTION TO OWN: ${top.emotion}
HOOK ARCHETYPE: ${top.hookType}

Return ONLY JSON:
{
  "adCopy": [
    { "headline": "<=60 chars", "primaryText": "1-2 punchy sentences", "cta": "short CTA" }
  ],   // exactly 3 distinct variants
  "landingPage": {
    "hook": "above-the-fold headline that matches the ad promise",
    "subhead": "one supporting line",
    "heroConcept": "one sentence describing the hero visual to generate"
  }
}
Make it specific to the angle, compliant (no false claims, no guaranteed-income language), and scroll-stopping.`,
      { fallback: EMPTY, maxTokens: 1500 },
    );
    copy = value;
  }

  // Evidence trail: pull the most distinct deconstructed ads as proof points.
  const evidence = dna.slice(0, 6).map((d) => ({
    advertiser: d.advertiser,
    insight: `${d.angle} — ${d.whyItWorks || d.claim}`.slice(0, 220),
    sourceUrl: d.sourceUrl,
  }));

  return {
    vertical,
    generatedAt: new Date().toISOString(),
    recommendation:
      top ?? {
        angle: 'Insufficient data to recommend a whitespace angle',
        rationale: 'No live creatives could be analyzed for this vertical in this run.',
        adjacentTo: [],
        confidence: 0,
        emotion: '',
        hookType: '',
      },
    adCopy: Array.isArray(copy.adCopy) ? copy.adCopy.slice(0, 3) : [],
    landingPage: copy.landingPage || EMPTY.landingPage,
    crowdedLanes: clusters,
    alternativeBets: whitespace.slice(1, 4),
    evidence,
    meta,
  };
}
