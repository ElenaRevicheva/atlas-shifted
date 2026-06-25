/**
 * produce.ts — Atlas AIPA, Layer 4: the Producer (Atuona seam). DETECT→CREATE→SHIP.
 *
 * Takes the Creative Director's producer_brief.image_prompt and renders an ACTUAL
 * image via Replicate/Flux — the same proven path the AIdeazz Atuona film studio
 * uses (black-forest-labs/flux-1.1-pro, REPLICATE_API_TOKEN). Saves the asset to
 * data/assets/<vertical>.jpg and records it in concepts.json so the /atlas
 * dashboard renders the generated creative next to the angle that drove it.
 *
 * This is the "fire, not promise" step: a real file on disk, not a description.
 * Flux 1.1 Pro → Flux dev fallback so a single model hiccup can't block the ship.
 *
 * Run:  node dist/produce.js               (defaults to expat_language — the dogfood)
 *       node dist/produce.js auto_insurance
 */
import Replicate from 'replicate';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const ASSETS_DIR = join(DATA_DIR, 'assets');
const CONCEPTS = join(DATA_DIR, 'concepts.json');

const FLUX_CHAIN = [config.fluxModel, 'black-forest-labs/flux-dev'];

/** Render via Replicate/Flux → return image bytes, or null on failure. */
async function renderViaFlux(prompt: string): Promise<{ buffer: Buffer; model: string } | null> {
  if (!config.replicateToken) return null;
  const replicate = new Replicate({ auth: config.replicateToken });
  for (const model of FLUX_CHAIN) {
    try {
      console.log(`[produce] rendering via ${model}…`);
      const output: unknown = await replicate.run(model as `${string}/${string}`, {
        input: { prompt, aspect_ratio: '4:5', output_format: 'jpg' },
      });
      const first: any = Array.isArray(output) ? output[0] : output;
      let url: string | undefined;
      if (typeof first === 'string') url = first;
      else if (first && typeof first.url === 'function') url = first.url().toString();
      else if (first && first.url) url = String(first.url);
      if (!url) continue;
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.ok) return { buffer: Buffer.from(await res.arrayBuffer()), model };
    } catch (e) {
      console.warn(`[produce] ${model} failed:`, (e as Error).message?.slice(0, 140));
    }
  }
  return null;
}

/** Render via OpenAI images — the "shrug" failover when Replicate is dry. */
async function renderViaOpenAI(prompt: string): Promise<{ buffer: Buffer; model: string } | null> {
  if (!config.openaiKey) return null;
  const attempts: Array<{ model: string; size: string }> = [
    { model: 'gpt-image-1', size: '1024x1536' },
    { model: 'dall-e-3', size: '1024x1792' },
  ];
  for (const a of attempts) {
    try {
      console.log(`[produce] rendering via OpenAI ${a.model}…`);
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openaiKey}` },
        body: JSON.stringify({ model: a.model, prompt: prompt.slice(0, 3800), size: a.size, n: 1 }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        console.warn(`[produce] OpenAI ${a.model} ${res.status}: ${(await res.text()).slice(0, 140)}`);
        continue;
      }
      const d = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
      const item = d.data?.[0];
      if (item?.b64_json) return { buffer: Buffer.from(item.b64_json, 'base64'), model: a.model };
      if (item?.url) {
        const img = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
        if (img.ok) return { buffer: Buffer.from(await img.arrayBuffer()), model: a.model };
      }
    } catch (e) {
      console.warn(`[produce] OpenAI ${a.model} failed:`, (e as Error).message?.slice(0, 140));
    }
  }
  return null;
}

/** Render chain: Flux (best) → OpenAI (the shrug). Returns image bytes + model. */
async function renderImage(prompt: string): Promise<{ buffer: Buffer; model: string } | null> {
  return (await renderViaFlux(prompt)) ?? (await renderViaOpenAI(prompt));
}

async function main() {
  const vertical = (process.argv[2] || 'expat_language').trim();
  if (!existsSync(CONCEPTS)) {
    console.error('no concepts.json — run concept first');
    process.exit(1);
  }
  const all = JSON.parse(readFileSync(CONCEPTS, 'utf8')) as Record<string, any>;
  const entry = all[vertical];
  const prompt: string | undefined = entry?.producer_brief?.image_prompt || entry?.concept?.image_prompt;
  if (!prompt) {
    console.error(`no producer_brief.image_prompt for "${vertical}" — run concept ${vertical} first`);
    process.exit(1);
  }

  console.log(`\n══════ ATLAS PRODUCER · ${vertical} ══════`);
  console.log(`  prompt: ${prompt.slice(0, 110)}…`);
  const rendered = await renderImage(prompt);
  if (!rendered) {
    console.error('render failed on all providers (Flux + OpenAI)');
    process.exit(1);
  }
  const bytes = rendered.buffer;
  mkdirSync(ASSETS_DIR, { recursive: true });
  const file = `${vertical}.jpg`;
  writeFileSync(join(ASSETS_DIR, file), bytes);

  // Record the asset in concepts.json so the dashboard renders it.
  entry.asset = {
    image_file: `assets/${file}`,
    model: rendered.model,
    bytes: bytes.length,
    generated_at: new Date().toISOString(),
  };
  all[vertical] = entry;
  writeFileSync(CONCEPTS, JSON.stringify(all, null, 2));

  console.log(`  ✅ SHIPPED: data/assets/${file} (${Math.round(bytes.length / 1024)}KB via ${rendered.model})`);
  console.log(`  concept "${entry.concept?.concept_name}" for open angle "${entry.move?.angle}" now has a real asset.`);
  console.log(`ATLAS PRODUCER DONE · DETECT→CREATE→SHIP closed for ${vertical}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
