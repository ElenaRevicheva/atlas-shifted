/**
 * angles.ts — the core intelligence: cluster the angle landscape, then find the
 * whitespace.
 *
 * Clustering tells a media buyer which lanes are SATURATED — observable directly
 * from public data (many advertisers on the same angle), no performance metrics
 * needed. Whitespace detection is the money move: ADJACENT angles almost nobody is
 * running yet — borrowing psychology heavily used in the crowded lanes, redirected
 * at an unworked persona or emotion. It is a ranked HYPOTHESIS to test, not a
 * measured winner (public ad libraries expose no CTR/spend/ROAS).
 *
 * Real mode reasons over scraped Angle DNA. Degraded mode (no Bright Data) reasons
 * over the model's market knowledge and is flagged honestly downstream.
 */
import { llmJson } from './llm.js';
import type { AngleDNA, AngleCluster, Whitespace } from './types.js';

const SYSTEM = `You are a paid-media strategist for a performance/affiliate advertiser who lives or dies by creative angles.
GROUND TRUTH: public ad libraries show what is RUNNING and how SATURATED an angle is (many advertisers on the same
angle = observable crowding) — but they show NO performance data (no CTR/CPC/spend/ROAS). So you can measure crowding,
never conversion. Treat saturation as observed fact and any performance read as inference.
You find both (a) the crowded lanes where everyone is competing, and (b) the WHITESPACE — adjacent angles almost
nobody is running yet. Whitespace is a RANKED HYPOTHESIS TO TEST, not a guaranteed winner: it borrows persuasion
psychology heavily used in the crowded lanes, then redirects it at an unworked persona, emotion, or framing.
Confidence reflects how defensibly adjacent the bet is — NOT a predicted conversion rate. Never recommend a random untested idea.`;

interface AnalysisOut {
  clusters: AngleCluster[];
  whitespace: Whitespace[];
}

const EMPTY: AnalysisOut = { clusters: [], whitespace: [] };

function dnaDigest(dna: AngleDNA[]): string {
  return dna
    .map(
      (d, i) =>
        `${i + 1}. [${d.advertiser || 'unknown'}] angle="${d.angle}" hook=${d.hookType} emotion=${d.emotion} ` +
        `claim="${d.claim}" visual="${d.visualPattern}" cta="${d.cta}" persona="${d.persona}" why="${d.whyItWorks}"`,
    )
    .join('\n');
}

const SCHEMA = `Return ONLY a JSON object:
{
  "clusters": [
    {
      "angle": "short name of the shared angle",
      "saturation": "heavy | moderate | light",
      "creativeCount": <int>,
      "advertisers": ["..."],
      "representativeHook": "the typical hook in this lane",
      "dominantEmotion": "...",
      "exampleSourceUrls": ["..."]
    }
  ],
  "whitespace": [
    {
      "angle": "the net-new angle to test",
      "rationale": "why it will likely work, grounded in what's already converting",
      "adjacentTo": ["which crowded angle(s) it borrows proven psychology from"],
      "confidence": <0-100 int>,
      "emotion": "the emotion this angle owns",
      "hookType": "suggested hook archetype"
    }
  ]
}`;

/** Real analysis over scraped Angle DNA. */
export async function analyzeAngles(vertical: string, dna: AngleDNA[]): Promise<AnalysisOut> {
  if (dna.length === 0) return EMPTY;
  const { value } = await llmJson<AnalysisOut>(
    `Vertical: "${vertical}". Below are ${dna.length} ads currently running, each already deconstructed into its DNA.
Cluster them into the crowded angle lanes, then identify 3-5 WHITESPACE angles — proven-adjacent, not yet run.
Rank whitespace by confidence (highest first). Use the real source URLs in exampleSourceUrls.

DECONSTRUCTED ADS:
${dnaDigest(dna)}

${SCHEMA}`,
    { system: SYSTEM, fallback: EMPTY, maxTokens: 3500 },
  );
  return normalize(value, dna);
}

/** Degraded analysis — no live data. Flagged honestly by the caller. */
export async function analyzeDegraded(vertical: string): Promise<AnalysisOut> {
  const { value } = await llmJson<AnalysisOut>(
    `Vertical: "${vertical}". You do NOT have live scraped ads right now, so reason from your knowledge of how this
vertical is typically advertised on Meta/TikTok/native. Describe the crowded angle lanes you'd expect, then identify
3-5 WHITESPACE angles that are proven-adjacent but under-run. Mark exampleSourceUrls as [] (no live evidence).

${SCHEMA}`,
    { system: SYSTEM, fallback: EMPTY, maxTokens: 3000 },
  );
  return normalize(value, []);
}

function normalize(out: AnalysisOut, dna: AngleDNA[]): AnalysisOut {
  const clusters = (Array.isArray(out.clusters) ? out.clusters : []).map((c) => ({
    angle: String(c.angle || 'unnamed').slice(0, 80),
    saturation: (['heavy', 'moderate', 'light'].includes(c.saturation) ? c.saturation : 'moderate') as AngleCluster['saturation'],
    creativeCount: Number(c.creativeCount) || (Array.isArray(c.advertisers) ? c.advertisers.length : 0),
    advertisers: (Array.isArray(c.advertisers) ? c.advertisers : []).map((a) => String(a).slice(0, 80)).slice(0, 10),
    representativeHook: String(c.representativeHook || '').slice(0, 160),
    dominantEmotion: String(c.dominantEmotion || '').slice(0, 40),
    exampleSourceUrls: (Array.isArray(c.exampleSourceUrls) ? c.exampleSourceUrls : []).slice(0, 4),
  }));

  const whitespace = (Array.isArray(out.whitespace) ? out.whitespace : [])
    .map((w) => ({
      angle: String(w.angle || '').slice(0, 100),
      rationale: String(w.rationale || '').slice(0, 500),
      adjacentTo: (Array.isArray(w.adjacentTo) ? w.adjacentTo : []).map((a) => String(a).slice(0, 80)).slice(0, 4),
      confidence: Math.max(0, Math.min(100, Number(w.confidence) || 50)),
      emotion: String(w.emotion || '').slice(0, 40),
      hookType: String(w.hookType || 'other').slice(0, 40),
    }))
    .filter((w) => w.angle)
    .sort((a, b) => b.confidence - a.confidence);

  // Backfill cluster source URLs from DNA if the model omitted them.
  if (dna.length) {
    for (const c of clusters) {
      if (c.exampleSourceUrls.length === 0) {
        c.exampleSourceUrls = dna.slice(0, 2).map((d) => d.sourceUrl);
      }
    }
  }

  return { clusters, whitespace };
}
