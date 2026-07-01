/**
 * gemini-video.ts — Google video providers for Atlas (additive fallbacks).
 *
 * Uses the same GEMINI_API_KEY / GOOGLE_API_KEY as Atuona Veo (`atuona-creative-ai.ts`).
 *   • Gemini Omni Flash — Interactions API, image→video (preview)
 *   • Veo 3.1 — predictLongRunning (native audio, Atuona-proven path)
 *
 * Called only after Runway → Luma chain fails in video.ts.
 */
import 'dotenv/config';

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
const OMNI_MODEL = (process.env.GEMINI_OMNI_MODEL || 'gemini-omni-flash-preview').trim();
const VEO_MODEL = (process.env.VEO_MODEL || 'veo-3.1-generate-preview').trim();

export function geminiVideoKey(): string {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

export function hasGeminiVideoKey(): boolean {
  return !!geminiVideoKey();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchImageBytes(imageUrl: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`fetch still ${res.status}`);
  const mimeType = res.headers.get('content-type')?.startsWith('image/')
    ? res.headers.get('content-type')!
    : 'image/jpeg';
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: buf.toString('base64'), mimeType };
}

function videoUriWithKey(uri: string, key: string): string {
  if (uri.includes('generativelanguage.googleapis.com') && !uri.includes('key=')) {
    return uri + (uri.includes('?') ? '&' : '?') + `key=${key}`;
  }
  return uri;
}

async function downloadGoogleVideo(uri: string, key: string): Promise<Buffer> {
  const url = videoUriWithKey(uri, key);
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`google video download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function extractVideoFromInteraction(body: Record<string, unknown>): { uri?: string; data?: string } {
  const out = body.output_video as { uri?: string; data?: string } | undefined;
  if (out?.uri || out?.data) return out;

  const steps = body.steps as { type?: string; content?: { type?: string; uri?: string; data?: string }[] }[] | undefined;
  if (Array.isArray(steps)) {
    for (const step of steps) {
      if (step.type !== 'model_output' || !Array.isArray(step.content)) continue;
      for (const c of step.content) {
        if (c.type === 'video' && (c.uri || c.data)) return { uri: c.uri, data: c.data };
      }
    }
  }
  return {};
}

async function pollOmniInteraction(id: string, key: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const poll = await fetch(`${GEMINI_API}/interactions/${encodeURIComponent(id)}?key=${key}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!poll.ok) continue;
    const body = (await poll.json()) as Record<string, unknown>;
    const status = String(body.status || '');
    if (status === 'failed' || status === 'cancelled') {
      throw new Error(`omni interaction ${status}`);
    }
    if (status === 'completed') return body;
  }
  throw new Error('omni interaction timed out');
}

async function pollGeminiFileActive(fileId: string, key: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const poll = await fetch(`${GEMINI_API}/files/${encodeURIComponent(fileId)}?key=${key}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!poll.ok) continue;
    const body = (await poll.json()) as { state?: string };
    if (body.state === 'ACTIVE') return;
    if (body.state === 'FAILED') throw new Error('omni file processing failed');
  }
  throw new Error('omni file timed out');
}

/** Gemini Omni Flash image→video via Interactions API. Returns MP4 bytes or null. */
export async function tryGeminiOmniVideo(imageUrl: string, promptText: string): Promise<Buffer | null> {
  const key = geminiVideoKey();
  if (!key) return null;
  try {
    const { base64, mimeType } = await fetchImageBytes(imageUrl);
    const motion = `5-second cinematic ad clip, subtle camera movement. ${promptText}`.slice(0, 900);
    const create = await fetch(`${GEMINI_API}/interactions?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OMNI_MODEL,
        input: [
          { type: 'image', data: base64, mime_type: mimeType },
          { type: 'text', text: motion },
        ],
        generation_config: { video_config: { task: 'image_to_video' } },
        response_format: { type: 'video', aspect_ratio: '9:16', delivery: 'uri' },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await create.text();
    if (!create.ok) {
      console.warn(`[video] Omni create ${create.status}: ${text.slice(0, 200)}`);
      return null;
    }
    let body = JSON.parse(text) as Record<string, unknown>;
    const status = String(body.status || 'completed');
    if (status !== 'completed' && body.id) {
      body = await pollOmniInteraction(String(body.id), key);
    }

    const { uri, data } = extractVideoFromInteraction(body);
    if (data) return Buffer.from(data, 'base64');
    if (!uri) {
      console.warn('[video] Omni completed but no video uri/data');
      return null;
    }

    const fileId = uri.match(/files\/([^/?]+)/)?.[1];
    if (fileId) await pollGeminiFileActive(fileId, key);
    return await downloadGoogleVideo(uri, key);
  } catch (e) {
    console.warn('[video] Omni error:', (e as Error).message?.slice(0, 160));
    return null;
  }
}

/** Google Veo 3.1 image→video (same API path as Atuona `/visualize veo`). Returns MP4 bytes or null. */
export async function tryVeoVideo(imageUrl: string, promptText: string): Promise<Buffer | null> {
  const key = geminiVideoKey();
  if (!key) return null;
  try {
    const { base64, mimeType } = await fetchImageBytes(imageUrl);
    const submitUrl = `${GEMINI_API}/models/${VEO_MODEL}:predictLongRunning?key=${key}`;
    const submit = await fetch(submitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{
          prompt: `5-second cinematic fragment. ${promptText}`.slice(0, 900),
          image: { bytesBase64Encoded: base64, mimeType },
        }],
        parameters: { aspectRatio: '9:16', personGeneration: 'allow_all' },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const submitText = await submit.text();
    if (!submit.ok) {
      console.warn(`[video] Veo submit ${submit.status}: ${submitText.slice(0, 200)}`);
      return null;
    }
    const opName = (JSON.parse(submitText) as { name?: string }).name;
    if (!opName) return null;

    const pollUrl = `${GEMINI_API}/${opName}?key=${key}`;
    for (let i = 0; i < 30; i++) {
      await sleep(10_000);
      const poll = await fetch(pollUrl, { signal: AbortSignal.timeout(30_000) });
      if (!poll.ok) continue;
      const op = (await poll.json()) as {
        done?: boolean;
        error?: unknown;
        response?: {
          generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] };
          generatedSamples?: { video?: { uri?: string } }[];
          predictions?: { video?: { uri?: string }; uri?: string }[];
        };
      };
      if (op.error) {
        console.warn('[video] Veo op error:', JSON.stringify(op.error).slice(0, 160));
        return null;
      }
      if (!op.done) continue;
      const sample =
        op.response?.generateVideoResponse?.generatedSamples?.[0]
        || op.response?.generatedSamples?.[0]
        || op.response?.predictions?.[0];
      const uri = sample?.video?.uri || (sample as { uri?: string })?.uri;
      if (!uri) {
        console.warn('[video] Veo done but no uri');
        return null;
      }
      return await downloadGoogleVideo(uri, key);
    }
    console.warn('[video] Veo timed out');
    return null;
  } catch (e) {
    console.warn('[video] Veo error:', (e as Error).message?.slice(0, 160));
    return null;
  }
}
