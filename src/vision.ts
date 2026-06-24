/**
 * vision.ts — deconstruct creatives into Angle DNA.
 *
 * For each creative we ask the model: WHY does this ad work? It returns a
 * structured AngleDNA row (angle, hook archetype, emotion, claim, visual
 * pattern, CTA, persona, mechanism). When a real creative image URL exists we
 * use the vision path (Claude → OpenAI); otherwise we reason over the ad copy
 * alone. This is the layer that turns raw market noise into a comparable schema.
 */
import { llmVision, llmJson } from './llm.js';
import type { AdCreative, AngleDNA } from './types.js';

const SYSTEM = `You are a direct-response creative strategist who reverse-engineers winning paid ads.
You think in terms of persuasion mechanics: the angle, the hook archetype, the emotional lever,
the core claim, the visual device, the CTA, and the exact persona being targeted.
You are precise and never invent details that aren't supported by the creative or its copy.`;

interface RawDNA {
  angle: string;
  hookType: string;
  emotion: string;
  claim: string;
  visualPattern: string;
  cta: string;
  persona: string;
  whyItWorks: string;
}

const EMPTY: RawDNA = {
  angle: '',
  hookType: '',
  emotion: '',
  claim: '',
  visualPattern: '',
  cta: '',
  persona: '',
  whyItWorks: '',
};

function prompt(creative: AdCreative): string {
  return `Deconstruct this paid ad into its persuasion DNA. Return ONLY a JSON object with these string fields:
{
  "angle": "the persuasion angle in 2-5 words",
  "hookType": "hook archetype: shocking-stat | curiosity-gap | us-vs-them | before-after | authority | social-proof | fear-loss | aspiration | pattern-interrupt | other",
  "emotion": "the single dominant emotion it pulls on",
  "claim": "the core promise/claim made",
  "visualPattern": "the visual device (e.g. split-screen, talking-head UGC, data overlay, text-on-image). If no image was provided, infer from copy and say so briefly.",
  "cta": "the call to action",
  "persona": "who this ad is written for",
  "whyItWorks": "one sentence on the mechanism that makes it convert"
}

ADVERTISER: ${creative.advertiser || 'unknown'}
AD COPY: ${creative.copy}
${creative.landingUrl ? `LANDING: ${creative.landingUrl}` : ''}
${creative.activitySignal ? `ACTIVITY: ${creative.activitySignal}` : ''}`;
}

/** Deconstruct a single creative. Uses vision when an image URL is available. */
export async function deconstructOne(creative: AdCreative): Promise<AngleDNA | null> {
  const p = prompt(creative);
  let raw: RawDNA;

  if (creative.imageUrl) {
    const ans = await llmVision(p, [creative.imageUrl], { system: SYSTEM, maxTokens: 1200 });
    const { extractJson } = await import('./llm.js');
    raw = extractJson<RawDNA>(ans.text) ?? EMPTY;
  } else {
    const { value } = await llmJson<RawDNA>(p, { system: SYSTEM, fallback: EMPTY, maxTokens: 1000 });
    raw = value;
  }

  if (!raw.angle && !raw.claim) return null;
  return {
    creativeId: creative.id,
    advertiser: creative.advertiser,
    angle: (raw.angle || 'unclassified').slice(0, 80),
    hookType: (raw.hookType || 'other').slice(0, 40),
    emotion: (raw.emotion || 'unknown').slice(0, 40),
    claim: (raw.claim || '').slice(0, 240),
    visualPattern: (raw.visualPattern || '').slice(0, 120),
    cta: (raw.cta || '').slice(0, 80),
    persona: (raw.persona || '').slice(0, 120),
    whyItWorks: (raw.whyItWorks || '').slice(0, 240),
    sourceUrl: creative.sourceUrl,
  };
}

/** Deconstruct a batch with bounded concurrency (gentle on rate limits). */
export async function deconstructAll(
  creatives: AdCreative[],
  onProgress?: (done: number, total: number) => void,
  concurrency = 3,
): Promise<AngleDNA[]> {
  const out: AngleDNA[] = [];
  let done = 0;
  for (let i = 0; i < creatives.length; i += concurrency) {
    const batch = creatives.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((c) => deconstructOne(c).catch(() => null)));
    for (const r of results) if (r) out.push(r);
    done += batch.length;
    onProgress?.(Math.min(done, creatives.length), creatives.length);
  }
  return out;
}
