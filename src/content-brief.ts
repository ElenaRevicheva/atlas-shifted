/**
 * content-brief.ts — AIdeazz-flavored synthesis (content mode).
 *
 * Same whitespace IP as the media-buyer battle plan, but the deliverable is what
 * the AIdeazz marketing engine actually consumes: a blog brief (Dev.to /
 * aideazz.xyz pipeline), per-channel social atoms (Buffer: LinkedIn / IG / X),
 * and a one-line HubSpot campaign angle. So WHITESPACE runs "in full force" for
 * AIdeazz's own growth even if the contest never converts to a job.
 */
import { llmJson } from './llm.js';
import type { AngleCluster, Whitespace, AngleDNA, ContentBrief, BattlePlan } from './types.js';

interface BriefOut {
  blog: { title: string; targetKeyword: string; outline: string[]; aeoHint: string };
  social: { linkedin: string; instagram: string; xThreadHook: string };
  hubspotCampaignAngle: string;
}

const EMPTY: BriefOut = {
  blog: { title: '', targetKeyword: '', outline: [], aeoHint: '' },
  social: { linkedin: '', instagram: '', xThreadHook: '' },
  hubspotCampaignAngle: '',
};

export async function buildContentBrief(args: {
  vertical: string;
  clusters: AngleCluster[];
  whitespace: Whitespace[];
  dna: AngleDNA[];
  meta: BattlePlan['meta'];
}): Promise<ContentBrief> {
  const { vertical, clusters, whitespace, dna, meta } = args;
  const top = whitespace[0];

  let out: BriefOut = EMPTY;
  if (top) {
    const { value } = await llmJson<BriefOut>(
      `You are the content strategist for AIdeazz (founder Elena Revicheva) — a builder of production AI agents and an
AI marketing engine. Competitors writing about "${vertical}" all crowd the same angles. Here is the WHITESPACE angle
nobody is publishing yet:

ANGLE: ${top.angle}
WHY IT WINS: ${top.rationale}
EMOTION TO OWN: ${top.emotion}

Produce a content package that lands this angle across AIdeazz channels. Return ONLY JSON:
{
  "blog": {
    "title": "an SEO+AEO blog title for aideazz.xyz / Dev.to",
    "targetKeyword": "the primary keyword to rank for",
    "outline": ["4-7 section headings"],
    "aeoHint": "one note on schema / answer-engine framing (FAQPage, HowTo, direct-answer intro)"
  },
  "social": {
    "linkedin": "a LinkedIn post (founder voice, 3-5 short paragraphs, no hashtags spam)",
    "instagram": "an Instagram caption (punchy, 1-3 lines + a soft CTA)",
    "xThreadHook": "the first post of an X thread that earns the click"
  },
  "hubspotCampaignAngle": "one line naming this campaign angle for the HubSpot hub"
}
Keep it true to a credible technical founder — concrete, no hype, no false claims.`,
      { fallback: EMPTY, maxTokens: 2000 },
    );
    out = value;
  }

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
        angle: 'Insufficient data to recommend a content whitespace angle',
        rationale: 'No competitor content could be analyzed for this topic in this run.',
        adjacentTo: [],
        confidence: 0,
        emotion: '',
        hookType: '',
      },
    blog: out.blog || EMPTY.blog,
    social: out.social || EMPTY.social,
    hubspotCampaignAngle: out.hubspotCampaignAngle || '',
    crowdedLanes: clusters,
    alternativeBets: whitespace.slice(1, 4),
    evidence,
    meta,
  };
}
