/**
 * video.ts — Atlas AIPA, the Producer's video stage. CREATE→SHIP as MOTION.
 *
 * Animates the still we already generated (data/assets/<vertical>.jpg, served
 * publicly) into a short video — the exact "end-to-end video creative generator,
 * driven by live angle intelligence" It's Today Media is hiring to build.
 *
 * Reuses the AIdeazz Atuona film-studio logic: image→video with provider failover.
 *   Runway (gen image_to_video) → Luma Agents (ray-3.2 i2v) → legacy Dream Machine.
 * Models are env-overridable (RUNWAY_VIDEO_MODEL / LUMA_VIDEO_MODEL) so newer
 * models drop in WITHOUT a code change — but nothing is claimed until it's green
 * in the logs. Video is the flakiest, most billing-dependent link, so if every
 * provider is dry the still image still stands and we say so honestly.
 *
 * Run:  node dist/video.js                 (defaults to expat_language)
 *       node dist/video.js auto_insurance
 */
import 'dotenv/config'; // CRITICAL: this module reads process.env directly — without this, every API key is undefined and providers skip silently.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const ASSETS_DIR = join(DATA_DIR, 'assets');
const CONCEPTS = join(DATA_DIR, 'concepts.json');

// Public base URL where assets are served (image→video providers need a URL).
const PUBLIC_BASE = (process.env.ATLAS_PUBLIC_BASE || 'https://webhook.aideazz.xyz/whitespace').replace(/\/$/, '');
const RUNWAY_MODEL = process.env.RUNWAY_VIDEO_MODEL?.trim() || 'gen4_turbo';
const LUMA_MODEL = process.env.LUMA_VIDEO_MODEL?.trim() || 'ray-3.2';
const LUMA_LEGACY_MODEL = process.env.LUMA_LEGACY_VIDEO_MODEL?.trim() || 'ray-2';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runway image→video (async create + poll). Returns a video URL or null. */
async function renderRunway(imageUrl: string, promptText: string): Promise<string | null> {
  const key = process.env.RUNWAY_API_KEY?.trim();
  if (!key) return null;
  const H = { Authorization: `Bearer ${key}`, 'X-Runway-Version': '2024-11-06', 'Content-Type': 'application/json' };
  try {
    const create = await fetch('https://api.dev.runwayml.com/v1/image_to_video', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ model: RUNWAY_MODEL, promptImage: imageUrl, promptText: promptText.slice(0, 980), ratio: '720:1280', duration: 5 }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!create.ok) {
      console.warn(`[video] Runway create ${create.status}: ${(await create.text()).slice(0, 160)}`);
      return null;
    }
    const { id } = (await create.json()) as { id: string };
    for (let i = 0; i < 40; i++) {
      await sleep(6000);
      const poll = await fetch(`https://api.dev.runwayml.com/v1/tasks/${id}`, { headers: H, signal: AbortSignal.timeout(20_000) });
      if (!poll.ok) continue;
      const t = (await poll.json()) as { status: string; output?: string[]; failure?: string };
      if (t.status === 'SUCCEEDED' && t.output?.[0]) return t.output[0];
      if (t.status === 'FAILED') {
        console.warn(`[video] Runway failed: ${t.failure || ''}`);
        return null;
      }
    }
    console.warn('[video] Runway timed out');
    return null;
  } catch (e) {
    console.warn('[video] Runway error:', (e as Error).message?.slice(0, 140));
    return null;
  }
}

/** Luma Agents API image→video (async create + poll). Returns a video URL or null. */
async function renderLumaAgents(imageUrl: string, promptText: string): Promise<string | null> {
  const key = process.env.LUMA_API_KEY?.trim();
  if (!key) return null;
  const H = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', accept: 'application/json' };
  try {
    const create = await fetch('https://agents.lumalabs.ai/v1/generations', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        prompt: promptText.slice(0, 980),
        type: 'video',
        model: LUMA_MODEL,
        aspect_ratio: '9:16',
        duration: '5s',
        video: { start_frame: { url: imageUrl } },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!create.ok) {
      console.warn(`[video] Luma Agents create ${create.status}: ${(await create.text()).slice(0, 160)}`);
      return null;
    }
    const { id } = (await create.json()) as { id: string };
    for (let i = 0; i < 40; i++) {
      await sleep(6000);
      const poll = await fetch(`https://agents.lumalabs.ai/v1/generations/${id}`, { headers: H, signal: AbortSignal.timeout(20_000) });
      if (!poll.ok) continue;
      const t = (await poll.json()) as { state: string; output?: { type: string; url: string }[]; failure_reason?: string; failure_code?: string };
      if (t.state === 'completed') {
        const video = t.output?.find((o) => o.type === 'video')?.url || t.output?.[0]?.url;
        if (video) return video;
      }
      if (t.state === 'failed') {
        console.warn(`[video] Luma Agents failed: ${t.failure_code || ''} ${t.failure_reason || ''}`);
        return null;
      }
    }
    console.warn('[video] Luma Agents timed out');
    return null;
  } catch (e) {
    console.warn('[video] Luma Agents error:', (e as Error).message?.slice(0, 140));
    return null;
  }
}

/** Legacy Luma Dream Machine image→video (older luma-xxxx keys). Returns a video URL or null. */
async function renderLumaLegacy(imageUrl: string, promptText: string): Promise<string | null> {
  const key = process.env.LUMA_API_KEY?.trim();
  if (!key) return null;
  const H = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', accept: 'application/json' };
  try {
    const create = await fetch('https://api.lumalabs.ai/dream-machine/v1/generations', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ prompt: promptText.slice(0, 980), model: LUMA_LEGACY_MODEL, keyframes: { frame0: { type: 'image', url: imageUrl } } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!create.ok) {
      console.warn(`[video] Luma create ${create.status}: ${(await create.text()).slice(0, 160)}`);
      return null;
    }
    const { id } = (await create.json()) as { id: string };
    for (let i = 0; i < 40; i++) {
      await sleep(6000);
      const poll = await fetch(`https://api.lumalabs.ai/dream-machine/v1/generations/${id}`, { headers: H, signal: AbortSignal.timeout(20_000) });
      if (!poll.ok) continue;
      const t = (await poll.json()) as { state: string; assets?: { video?: string }; failure_reason?: string };
      if (t.state === 'completed' && t.assets?.video) return t.assets.video;
      if (t.state === 'failed') {
        console.warn(`[video] Luma failed: ${t.failure_reason || ''}`);
        return null;
      }
    }
    console.warn('[video] Luma timed out');
    return null;
  } catch (e) {
    console.warn('[video] Luma error:', (e as Error).message?.slice(0, 140));
    return null;
  }
}

async function main() {
  const vertical = (process.argv[2] || 'expat_language').trim();
  if (!existsSync(CONCEPTS)) {
    console.error('no concepts.json — run concept + produce first');
    process.exit(1);
  }
  const all = JSON.parse(readFileSync(CONCEPTS, 'utf8')) as Record<string, any>;
  const entry = all[vertical];
  const imageFile = entry?.asset?.image_file;
  if (!imageFile) {
    console.error(`no rendered image for "${vertical}" — run produce ${vertical} first`);
    process.exit(1);
  }
  const imageUrl = `${PUBLIC_BASE}/${imageFile}`;
  const promptText = entry?.producer_brief?.scene || entry?.concept?.scene_concept || entry?.concept?.headline || vertical;

  console.log(`\n══════ ATLAS VIDEO · ${vertical} ══════`);
  console.log(`  source still: ${imageUrl}`);
  console.log(`  motion prompt: ${String(promptText).slice(0, 100)}…`);

  let videoUrl = await renderRunway(imageUrl, promptText);
  let model = `runway:${RUNWAY_MODEL}`;
  if (!videoUrl) {
    videoUrl = await renderLumaAgents(imageUrl, promptText);
    model = `luma:${LUMA_MODEL}`;
  }
  if (!videoUrl) {
    videoUrl = await renderLumaLegacy(imageUrl, promptText);
    model = `luma-legacy:${LUMA_LEGACY_MODEL}`;
  }
  if (!videoUrl) {
    console.error('  ✗ all video providers dry/failed — the still image stands (honest fallback).');
    process.exit(2);
  }

  const res = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    console.error(`  fetch video failed: ${res.status}`);
    process.exit(1);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  mkdirSync(ASSETS_DIR, { recursive: true });
  const file = `${vertical}.mp4`;
  writeFileSync(join(ASSETS_DIR, file), bytes);

  entry.video = { video_file: `assets/${file}`, model, bytes: bytes.length, generated_at: new Date().toISOString() };
  all[vertical] = entry;
  writeFileSync(CONCEPTS, JSON.stringify(all, null, 2));

  console.log(`  ✅ SHIPPED VIDEO: data/assets/${file} (${Math.round(bytes.length / 1024)}KB via ${model})`);
  console.log(`ATLAS VIDEO DONE · DETECT→CREATE→SHIP(motion) closed for ${vertical}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
