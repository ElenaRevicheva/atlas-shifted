/**
 * llm.ts — resilient LLM layer for WHITESPACE.
 *
 * Mirrors the AIdeazz fleet's provider-resilience discipline: a primary call
 * with graceful fallbacks so a single dead/capped provider can never kill a run.
 *   - text   : Claude → Groq → OpenAI
 *   - vision : Claude → OpenAI  (both multimodal; Groq skipped)
 *
 * Every function returns the provider that actually answered so the final
 * BattlePlan can honestly report which engine produced it (and whether it
 * degraded). Keys come from config (read from .env) — never hardcoded.
 */
import Anthropic from '@anthropic-ai/sdk';
import Groq from 'groq-sdk';
import { config } from './config.js';

export interface LlmAnswer {
  text: string;
  provider: 'claude' | 'groq' | 'openai' | 'none';
}

const sysWrap = (system: string | undefined, prompt: string): string =>
  system ? `${system}\n\n${prompt}` : prompt;

/**
 * Per-process circuit breaker. When a provider signals it's hard-down — Claude
 * credit exhaustion (400) or Groq rate-cap (429) — we stop hammering it on every
 * subsequent call and jump straight to the next leg. Claude exhaustion latches
 * for the process (credits don't refill mid-run); Groq cools down for a window
 * (its cap resets), then auto-rejoins. This is what keeps a run fast and alive
 * when the primary providers are dead — the exact failure the content run hit.
 */
let claudeDead = false;
let groqCooldownUntil = 0;
const GROQ_COOLDOWN_MS = 90_000;

const isCreditExhaustion = (msg: string): boolean =>
  /credit balance is too low|insufficient_quota|billing/i.test(msg);

/** Inspect a provider error and trip the breaker if it's a hard-down signal. */
function noteProviderError(provider: 'claude' | 'groq', err: unknown): void {
  const e = err as { status?: number; message?: string };
  const msg = e?.message || String(err);
  if (provider === 'claude' && (isCreditExhaustion(msg) || e?.status === 400)) {
    if (!claudeDead) console.warn('[llm] Claude tripped circuit breaker (credit/billing) — skipping it for this process.');
    claudeDead = true;
  }
  if (provider === 'groq' && (e?.status === 429 || /rate limit|429/i.test(msg))) {
    groqCooldownUntil = Date.now() + GROQ_COOLDOWN_MS;
  }
}

/** Diagnostics for /healthz and meta. */
export function breakerState(): { claudeDead: boolean; groqCoolingMs: number } {
  return { claudeDead, groqCoolingMs: Math.max(0, groqCooldownUntil - Date.now()) };
}

/** Claude text/JSON completion. Returns '' on failure so callers can fall through. */
async function claudeText(prompt: string, system: string | undefined, maxTokens: number): Promise<string> {
  if (!config.anthropicKey || claudeDead) return '';
  try {
    const anthropic = new Anthropic({ apiKey: config.anthropicKey });
    const msg = await anthropic.messages.create({
      model: config.claudeModel,
      max_tokens: Math.min(maxTokens, 8192),
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: prompt }],
    });
    const block = msg.content[0];
    return block && block.type === 'text' ? block.text.trim() : '';
  } catch (e) {
    noteProviderError('claude', e);
    console.warn('[llm] Claude text failed:', (e as Error).message?.slice(0, 140));
    return '';
  }
}

async function groqText(prompt: string, system: string | undefined, maxTokens: number): Promise<string> {
  if (!config.groqKey || Date.now() < groqCooldownUntil) return '';
  try {
    const groq = new Groq({ apiKey: config.groqKey });
    const completion = await groq.chat.completions.create({
      model: config.groqModel,
      messages: [
        ...(system ? [{ role: 'system' as const, content: system }] : []),
        { role: 'user' as const, content: prompt },
      ],
      temperature: 0.3,
      max_tokens: Math.min(maxTokens, 8000),
    });
    return (completion.choices[0]?.message?.content || '').trim();
  } catch (e) {
    noteProviderError('groq', e);
    console.warn('[llm] Groq text failed:', (e as Error).message?.slice(0, 140));
    return '';
  }
}

async function openaiText(prompt: string, system: string | undefined, maxTokens: number): Promise<string> {
  if (!config.openaiKey) return '';
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openaiKey}` },
      body: JSON.stringify({
        model: config.openaiModel,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: prompt },
        ],
        max_tokens: Math.min(maxTokens, 8000),
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      console.warn(`[llm] OpenAI text ${res.status}: ${(await res.text()).slice(0, 120)}`);
      return '';
    }
    const d = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return (d.choices?.[0]?.message?.content || '').trim();
  } catch (e) {
    console.warn('[llm] OpenAI text failed:', (e as Error).message?.slice(0, 140));
    return '';
  }
}

/** Resilient text completion: Claude → Groq → OpenAI. */
export async function llmText(
  prompt: string,
  opts: { system?: string; maxTokens?: number } = {},
): Promise<LlmAnswer> {
  const maxTokens = opts.maxTokens ?? 4096;
  const c = await claudeText(prompt, opts.system, maxTokens);
  if (c) return { text: c, provider: 'claude' };
  const g = await groqText(prompt, opts.system, maxTokens);
  if (g) return { text: g, provider: 'groq' };
  const o = await openaiText(prompt, opts.system, maxTokens);
  if (o) return { text: o, provider: 'openai' };
  return { text: '', provider: 'none' };
}

/**
 * Resilient JSON completion. Asks for strict JSON, then extracts the first
 * balanced JSON value defensively (models love to wrap JSON in prose / fences).
 */
export async function llmJson<T>(
  prompt: string,
  opts: { system?: string; maxTokens?: number; fallback: T },
): Promise<{ value: T; provider: LlmAnswer['provider'] }> {
  const ans = await llmText(prompt, opts);
  if (!ans.text) return { value: opts.fallback, provider: 'none' };
  const parsed = extractJson<T>(ans.text);
  return { value: parsed ?? opts.fallback, provider: ans.provider };
}

/** Pull the first balanced {...} or [...] out of a model response and parse it. */
export function extractJson<T>(raw: string): T | null {
  if (!raw) return null;
  // Strip code fences first.
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) return null;
  const open = cleaned[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Resilient vision call. Sends one or more image URLs + a prompt.
 * Claude (url image source) → OpenAI (image_url). Groq skipped.
 */
export async function llmVision(
  prompt: string,
  imageUrls: string[],
  opts: { system?: string; maxTokens?: number } = {},
): Promise<LlmAnswer> {
  const maxTokens = opts.maxTokens ?? 1500;
  const urls = imageUrls.filter((u) => /^https?:\/\//i.test(u)).slice(0, 8);
  if (urls.length === 0) {
    // No usable image — degrade to a text-only reasoning pass.
    return llmText(sysWrap(opts.system, prompt), { maxTokens });
  }

  // 1) Claude vision (skipped once the credit breaker has tripped)
  if (config.anthropicKey && !claudeDead) {
    try {
      const anthropic = new Anthropic({ apiKey: config.anthropicKey });
      const content: Anthropic.ContentBlockParam[] = [
        ...urls.map((url): Anthropic.ImageBlockParam => ({
          type: 'image',
          source: { type: 'url', url },
        })),
        { type: 'text', text: prompt },
      ];
      const msg = await anthropic.messages.create({
        model: config.claudeVisionModel,
        max_tokens: Math.min(maxTokens, 4096),
        ...(opts.system ? { system: opts.system } : {}),
        messages: [{ role: 'user', content }],
      });
      const block = msg.content[0];
      if (block && block.type === 'text' && block.text.trim()) {
        return { text: block.text.trim(), provider: 'claude' };
      }
    } catch (e) {
      noteProviderError('claude', e);
      console.warn('[llm] Claude vision failed:', (e as Error).message?.slice(0, 140));
    }
  }

  // 2) OpenAI vision
  if (config.openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openaiKey}` },
        body: JSON.stringify({
          model: config.openaiModel,
          messages: [
            ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                ...urls.map((url) => ({ type: 'image_url', image_url: { url } })),
              ],
            },
          ],
          max_tokens: Math.min(maxTokens, 4096),
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (res.ok) {
        const d = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const t = (d.choices?.[0]?.message?.content || '').trim();
        if (t) return { text: t, provider: 'openai' };
      } else {
        console.warn(`[llm] OpenAI vision ${res.status}: ${(await res.text()).slice(0, 120)}`);
      }
    } catch (e) {
      console.warn('[llm] OpenAI vision failed:', (e as Error).message?.slice(0, 140));
    }
  }

  // 3) Last resort: text-only reasoning over whatever copy was in the prompt.
  return llmText(sysWrap(opts.system, prompt), { maxTokens });
}

export function activeLlmLabel(): string {
  if (config.anthropicKey && !claudeDead) return `Claude (${config.claudeModel})`;
  if (config.groqKey && Date.now() >= groqCooldownUntil) return `Groq (${config.groqModel})`;
  if (config.openaiKey) return `OpenAI (${config.openaiModel})`;
  if (config.anthropicKey) return `Claude (${config.claudeModel})`;
  if (config.groqKey) return `Groq (${config.groqModel})`;
  return 'no-LLM-configured';
}
