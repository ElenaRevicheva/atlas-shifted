#!/usr/bin/env node
/**
 * Provider quality eval for Atlas Shifted (whitespace).
 *
 *     node eval-llm-chain.mjs
 *
 * Sixth and last in the fleet. Every product gets its fitness criteria from the
 * PRODUCT, never from a template — "did it answer" passes truncated JSON, half a
 * brief, and a refusal. Atlas's job is different from EspaLuz's: it does not need
 * warmth, it needs STRUCTURE. Almost every call in this repo goes through
 * llmJson(), so a provider that writes beautiful prose and malformed JSON is
 * useless here, and one that emits terse correct JSON is excellent.
 *
 * So the five checks are:
 *
 *   - PARSES        — extractJson() can recover a value. This is the whole game.
 *   - SHAPE         — the requested keys are actually present, not invented ones
 *   - GROUNDED      — it used the evidence given instead of inventing an advertiser
 *   - SUBSTANTIVE   — a hook that is three words is not a creative concept
 *   - NO REFUSAL    — never "I can't help with that"
 *
 * Ties break on CHAIN POSITION, never latency. Sorting by speed would promote
 * the weakest, fastest model to the front — the same mistake caught in the
 * EspaLuz evals. A checklist proves a floor; it cannot rank nuance.
 */
import 'dotenv/config';

const KEYS = {
  claude: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  grok: 'XAI_API_KEY',
  groq: 'GROQ_API_KEY',
};

const MODELS = {
  claude: process.env.WHITESPACE_CLAUDE_MODEL?.trim() || 'claude-sonnet-4-6',
  openai: process.env.WHITESPACE_OPENAI_MODEL?.trim() || 'gpt-4o-mini',
  gemini: process.env.WHITESPACE_GEMINI_MODEL?.trim() || 'gemini-2.5-flash',
  grok: process.env.WHITESPACE_GROK_MODEL?.trim() || 'grok-4.20-0309-non-reasoning',
  groq: process.env.WHITESPACE_GROQ_MODEL?.trim() || 'openai/gpt-oss-120b',
};

const ORDER = ['claude', 'openai', 'gemini', 'grok', 'groq'];

// Reasoning models emit nothing at all below ~300 tokens; a concept needs room.
const BUDGET = 900;

// A real Atlas moment: the shape concept.ts actually asks for, with real
// evidence attached, so the eval exercises grounding and not just formatting.
const SYSTEM =
  'You are Atlas Shifted, a creative-angle intelligence engine. You answer ONLY ' +
  'with strict JSON. No prose, no code fences, no commentary.';
const PROMPT = `The detected open angle for the "expat_language" vertical is "authority".
These are REAL competitor ads currently running in that market:
  - Babbel: "Learn the language locals actually speak"
  - Rosetta Stone: "Trusted by NASA and the US State Department"
  - iTalki: "Real teachers. Real conversations. Real progress."

Produce a creative concept for EspaLuz (a bilingual AI tutor for expat families
relocating to Panama) that occupies the "authority" angle these ads leave open.

Return JSON with exactly these keys:
{"concept_name":string,"emotion":string,"hook":string,"headline":string,"cta":string,"grounded_in":string[]}
"grounded_in" must cite the advertiser names above that informed the concept.`;

const REFUSAL = /\b(I can'?t (help|assist)|I'?m (unable|not able)|as an AI)\b/i;
const WANT = ['concept_name', 'emotion', 'hook', 'headline', 'cta', 'grounded_in'];
const ADVERTISERS = ['babbel', 'rosetta', 'italki'];

/** Same defensive extraction llm.ts uses — models love fences and preamble. */
function extractJson(raw) {
  if (!raw) return null;
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
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

async function callProvider(provider, system, user, maxTokens) {
  const key = (process.env[KEYS[provider]] || '').trim();
  if (!key) throw new Error(`no ${KEYS[provider]}`);
  const model = MODELS[provider];

  if (provider === 'claude') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 90)}`);
    const d = await r.json();
    return (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  }

  if (provider === 'gemini') {
    const body = (withThinking) => ({
      contents: [{ role: 'user', parts: [{ text: user }] }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.3,
        ...(withThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    });
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const post = (b) =>
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    let r = await post(body(true));
    if (r.status === 400) r = await post(body(false));
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 90)}`);
    const d = await r.json();
    return d.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  const url = {
    openai: 'https://api.openai.com/v1/chat/completions',
    grok: 'https://api.x.ai/v1/chat/completions',
    groq: 'https://api.groq.com/openai/v1/chat/completions',
  }[provider];
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
  // Cloudflare fronts api.groq.com and 403s the default fetch User-Agent.
  if (provider === 'groq') headers['User-Agent'] = 'AtlasShifted/1.0 (+https://aideazz.xyz)';
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 90)}`);
  const d = await r.json();
  return d.choices?.[0]?.message?.content || '';
}

function score(raw) {
  const problems = [];
  let pts = 0;

  const obj = extractJson(raw);
  if (obj && typeof obj === 'object') pts++;
  else problems.push('JSON DID NOT PARSE — llmJson() would return the fallback');

  const missing = obj ? WANT.filter((k) => !(k in obj)) : WANT;
  if (obj && missing.length === 0) pts++;
  else if (obj) problems.push(`missing keys: ${missing.join(', ')}`);

  const cited = JSON.stringify(obj?.grounded_in ?? '').toLowerCase();
  if (obj && ADVERTISERS.some((a) => cited.includes(a))) pts++;
  else if (obj) problems.push('not grounded — cited no real advertiser');

  const hook = String(obj?.hook ?? '');
  const headline = String(obj?.headline ?? '');
  if (hook.length >= 15 && headline.length >= 15) pts++;
  else if (obj) problems.push('hook/headline too thin to be a concept');

  if (REFUSAL.test(raw)) problems.push('REFUSED');
  else pts++;

  return { pts, problems };
}

async function main() {
  console.log('=== Atlas Shifted provider eval — a real concept request, strict JSON ===\n');
  const results = [];

  for (const provider of ORDER) {
    if (!(process.env[KEYS[provider]] || '').trim()) {
      console.log(`  ${provider.padEnd(8)} SKIP   no ${KEYS[provider]}`);
      continue;
    }
    try {
      const t0 = Date.now();
      const raw = await callProvider(provider, SYSTEM, PROMPT, BUDGET);
      const ms = Date.now() - t0;
      const { pts, problems } = score(raw || '');
      results.push({ pts, provider, ms, problems, raw });
      const flag = pts === 5 ? 'OK ' : pts >= 3 ? 'WARN' : 'BAD ';
      const detail = problems.length ? problems.join('; ') : 'parses, shaped, grounded, substantive';
      console.log(`  ${provider.padEnd(8)} [${flag}] ${pts}/5  ${String(ms).padStart(6)}ms  ${detail}`);
    } catch (e) {
      console.log(`  ${provider.padEnd(8)} [FAIL] ${String(e.message).slice(0, 80)}`);
      results.push({ pts: 0, provider, ms: 0, problems: [String(e.message).slice(0, 80)], raw: '' });
    }
  }

  if (!results.length) {
    console.log('\nno provider answered — Atlas cannot ship a brief');
    return 1;
  }

  console.log('\n=== floor check (can this provider carry an Atlas brief?) ===');
  for (const r of [...results].sort((a, b) => b.pts - a.pts)) {
    console.log(
      `  ${r.provider.padEnd(8)} ${r.pts}/5  ${String(r.ms).padStart(6)}ms  ` +
      (r.pts === 5 ? 'meets the floor' : 'BELOW FLOOR — do not rely on it'),
    );
  }
  console.log(`\n  chain order stays: ${ORDER.join(' -> ')}  (capability, not latency)`);

  // Sample from the highest-RANKED provider that met the floor, never the
  // fastest — speed is not the signal, and printing groq's output under the
  // heading "strongest" is exactly the error the EspaLuz eval had to fix.
  const top = results.filter((r) => r.pts === 5).sort((a, b) => ORDER.indexOf(a.provider) - ORDER.indexOf(b.provider))[0];
  if (top) {
    const obj = extractJson(top.raw);
    console.log(`\n=== sample from the highest-ranked provider that met the floor ===\n  [${top.provider}]`);
    console.log(`  concept : ${obj?.concept_name}`);
    console.log(`  hook    : ${obj?.hook}`);
    console.log(`  grounded: ${JSON.stringify(obj?.grounded_in)}`);
  }

  const passed = results.filter((r) => r.pts === 5).length;
  console.log(`\n${passed}/${results.length} providers can carry Atlas quality`);
  return passed > 0 ? 0 : 1;
}

main().then((c) => process.exit(c));
