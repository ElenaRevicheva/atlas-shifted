/**
 * server.ts — the live demo. Serves the UI and streams a run over SSE so judges
 * can watch the agent work in real time, then renders the battle plan.
 *
 *   GET  /                 → the single-page UI
 *   GET  /healthz          → readiness + which providers are wired
 *   GET  /api/run?vertical → Server-Sent Events stream of RunEvents
 */
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config, hasBrightData, hasAnthropic, hasAnyLlm } from './config.js';
import { runWhitespace } from './agent.js';
import { breakerState } from './llm.js';
import type { RunEvent, RunMode } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

const app = express();
app.disable('x-powered-by');
app.use(express.static(PUBLIC_DIR));

app.get('/healthz', (_req, res) => {
  res.json({
    ok: hasAnyLlm(),
    brightData: hasBrightData(),
    anthropic: hasAnthropic(),
    llm: hasAnyLlm(),
    maxCreatives: config.maxCreatives,
    breaker: breakerState(),
  });
});

app.get('/api/run', async (req, res) => {
  const vertical = String(req.query.vertical || '').trim();
  const mode: RunMode = String(req.query.mode || '') === 'content' ? 'content' : 'media_buyer';
  if (!vertical) {
    res.status(400).json({ error: 'missing vertical' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (e: RunEvent) => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  };

  // Keep-alive comments so proxies don't drop a long run.
  const ka = setInterval(() => res.write(': keep-alive\n\n'), 15_000);

  try {
    await runWhitespace(vertical, send, mode);
  } catch (e) {
    send({ stage: 'error', message: (e as Error).message || 'run failed' });
  } finally {
    clearInterval(ka);
    res.write('event: close\ndata: {}\n\n');
    res.end();
  }
});

app.get('/', (_req, res) => res.sendFile(join(PUBLIC_DIR, 'index.html')));

app.listen(config.port, () => {
  console.log(`\n  WHITESPACE → http://localhost:${config.port}`);
  console.log(`  providers: LLM=${hasAnyLlm() ? activeProviders() : 'NONE'} · BrightData=${hasBrightData() ? 'on' : 'off'}`);
  if (!hasAnyLlm()) console.log('  ⚠  no LLM key set — copy .env.example to .env and add at least ANTHROPIC_API_KEY');
  if (!hasBrightData()) console.log('  ℹ  Bright Data off — runs in LLM market-knowledge mode until BRIGHTDATA_* are set');
});

function activeProviders(): string {
  const p: string[] = [];
  if (config.anthropicKey) p.push('Claude');
  if (config.groqKey) p.push('Groq');
  if (config.openaiKey) p.push('OpenAI');
  return p.join('+');
}
