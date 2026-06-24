/**
 * agent.ts — the WHITESPACE orchestrator.
 *
 * Runs the full funnel for one vertical and streams progress events so the live
 * UI can show the agent "thinking". ONE shared core, two modes:
 *
 *   recon → vision deconstruction (Claude) → angle clustering + whitespace → synth
 *
 *   - media_buyer : ad-library recon  → battle plan        (It's Today Media)
 *   - content     : competitor-content recon → content brief (AIdeazz engine)
 *
 * Honest degradation: if Bright Data isn't configured or returns nothing, the run
 * still completes via an LLM market-knowledge pass, with meta.degraded = true.
 */
import { hasBrightData, hasAnyLlm } from './config.js';
import { reconAllSources, reconContentSources } from './ad-sources.js';
import { deconstructAll } from './vision.js';
import { analyzeAngles, analyzeDegraded } from './angles.js';
import { buildBattlePlan } from './battle-plan.js';
import { buildContentBrief } from './content-brief.js';
import { activeLlmLabel } from './llm.js';
import type { RunMode, RunOutput, RunEvent, BattlePlan } from './types.js';

export type Emit = (e: RunEvent) => void;

export async function runWhitespace(vertical: string, emit: Emit, mode: RunMode = 'media_buyer'): Promise<RunOutput> {
  const started = Date.now();
  const notes: string[] = [];
  const v = vertical.trim();
  const label = mode === 'content' ? 'content angle' : 'ad angle';

  emit({ stage: 'start', message: `WHITESPACE [${mode}] engaging: "${v}"`, pct: 2 });

  if (!hasAnyLlm()) {
    emit({ stage: 'error', message: 'No LLM provider configured (set ANTHROPIC_API_KEY / GROQ_API_KEY / OPENAI_API_KEY).' });
    throw new Error('no_llm_configured');
  }

  const mkMeta = (creativesScanned: number, sources: string[], degraded: boolean): BattlePlan['meta'] => ({
    creativesScanned,
    sources,
    durationMs: Date.now() - started,
    llmProvider: activeLlmLabel(),
    degraded,
    notes,
  });

  const synth = async (
    clusters: Awaited<ReturnType<typeof analyzeAngles>>['clusters'],
    whitespace: Awaited<ReturnType<typeof analyzeAngles>>['whitespace'],
    dna: Awaited<ReturnType<typeof deconstructAll>>,
    meta: BattlePlan['meta'],
  ): Promise<RunOutput> => {
    if (mode === 'content') {
      const brief = await buildContentBrief({ vertical: v, clusters, whitespace, dna, meta });
      return { kind: 'content', ...brief };
    }
    const plan = await buildBattlePlan({ vertical: v, clusters, whitespace, dna, meta });
    return { kind: 'media_buyer', ...plan };
  };

  // ── 1. Recon ──────────────────────────────────────────────────────────────
  emit({ stage: 'recon', message: mode === 'content' ? 'Mining competitor content…' : 'Mining the live ad market…', pct: 8 });
  const recon =
    mode === 'content'
      ? await reconContentSources(v, (m) => emit({ stage: 'recon', message: m }))
      : await reconAllSources(v, (m) => emit({ stage: 'recon', message: m }));
  const { creatives, sources } = recon;

  // Degraded path — no live evidence.
  if (creatives.length === 0) {
    notes.push(
      hasBrightData()
        ? 'Live recon returned no parseable units this run — switched to LLM market-knowledge mode (no live evidence trail).'
        : 'Bright Data not configured — ran in LLM market-knowledge mode (no live evidence trail). Add BRIGHTDATA_API_TOKEN + BRIGHTDATA_ZONE for live recon.',
    );
    emit({ stage: 'creatives', message: 'No live units — degrading to market-knowledge analysis.', pct: 35 });
    const { clusters, whitespace } = await analyzeDegraded(v);
    emit({ stage: 'whitespace', message: `Identified ${whitespace.length} whitespace ${label}s (knowledge mode).`, pct: 82 });
    const out = await synth(clusters, whitespace, [], mkMeta(0, [], true));
    emit({ stage: 'done', message: 'Deliverable ready (knowledge mode).', data: out, pct: 100 });
    return out;
  }

  emit({
    stage: 'creatives',
    message: `Captured ${creatives.length} live units from ${sources.join(' + ')}.`,
    data: creatives,
    pct: 30,
  });

  // ── 2. Vision / DNA deconstruction ────────────────────────────────────────
  emit({ stage: 'vision', message: 'Deconstructing each unit into Angle DNA…', pct: 38 });
  const dna = await deconstructAll(creatives, (done, total) =>
    emit({ stage: 'vision', message: `Deconstructed ${done}/${total}.`, pct: 38 + Math.round((done / total) * 30) }),
  );
  emit({ stage: 'vision', message: `Angle DNA extracted for ${dna.length} units.`, data: dna, pct: 68 });

  let degraded = false;
  if (dna.length === 0) {
    notes.push('Units were captured but none could be deconstructed; analysis ran in knowledge mode.');
    degraded = true;
  }

  // ── 3. Clustering + whitespace ────────────────────────────────────────────
  emit({ stage: 'clustering', message: 'Mapping crowded lanes…', pct: 72 });
  const { clusters, whitespace } = dna.length > 0 ? await analyzeAngles(v, dna) : await analyzeDegraded(v);
  emit({ stage: 'clustering', message: `Found ${clusters.length} crowded lanes.`, data: clusters, pct: 82 });
  emit({ stage: 'whitespace', message: `Surfaced ${whitespace.length} whitespace ${label}s.`, data: whitespace, pct: 88 });

  // ── 4. Synthesis ──────────────────────────────────────────────────────────
  emit({ stage: 'battleplan', message: mode === 'content' ? 'Synthesizing the content brief…' : 'Synthesizing the battle plan…', pct: 92 });
  const out = await synth(clusters, whitespace, dna, mkMeta(creatives.length, sources, degraded));
  emit({ stage: 'done', message: 'Deliverable ready.', data: out, pct: 100 });
  return out;
}
