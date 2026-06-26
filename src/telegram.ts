/**
 * telegram.ts — Atlas → Telegram (additive, fleet-compatible).
 *
 * Sends the daily brief after cron. Uses the same bot token pattern as the
 * AIdeazz fleet (TELEGRAM_BOT_TOKEN) — send-only, no polling conflict with CTO AIPA.
 *
 * Env (first match wins):
 *   Token:  ATLAS_TELEGRAM_BOT_TOKEN → TELEGRAM_BOT_TOKEN
 *   Chat:   ATLAS_TELEGRAM_CHAT_ID → TELEGRAM_LEADS_DIGEST_CHAT_ID → TELEGRAM_DAILY_BLOG_NOTIFY_CHAT_ID
 *
 * Optional command bot (separate process): node dist/telegram-bot.js
 *   Requires ATLAS_TELEGRAM_BOT_TOKEN dedicated to Atlas OR a bot not used elsewhere for polling.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, hasTelegram } from './config.js';
import type { VerticalIntelligence } from './intelligence.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

interface BriefVertical {
  vertical: string;
  move: { angle: string; state: string; score: number; why: string; basis: string; evidence: string | null };
  avoid: Array<{ angle: string; advertisers: number }>;
}

interface AtlasBrief {
  snapshot_date: string;
  verticals: BriefVertical[];
  intelligence?: { verticals: VerticalIntelligence[]; memory: unknown[] };
  resilience?: string;
}

const STATE_EMOJI: Record<string, string> = {
  ENTER: '🟢',
  WATCH: '🟡',
  AVOID: '🔴',
  STABLE: '⚪',
};

/** Plain-text message — avoids Telegram Markdown parse failures. */
export function formatAtlasTelegramMessage(brief: AtlasBrief): string {
  const lines: string[] = [
    `🌐 ATLAS DAILY BRIEF · ${brief.snapshot_date}`,
    '',
  ];

  for (const v of brief.verticals || []) {
    const m = v.move;
    const em = STATE_EMOJI[m.state] || '•';
    lines.push(`${em} ${v.vertical.toUpperCase()}`);
    lines.push(`   MOVE → ${m.state} · ${m.angle} (${m.score}/100)`);
    lines.push(`   ${m.why}`);
    if (v.avoid?.length) {
      lines.push(`   avoid: ${v.avoid.map((a) => a.angle).join(', ')}`);
    }
    lines.push('');
  }

  const intelByV = new Map((brief.intelligence?.verticals || []).map((iv) => [iv.vertical, iv]));
  const top = brief.verticals?.find((v) => v.move.state === 'ENTER') || brief.verticals?.[0];
  if (top) {
    const iv = intelByV.get(top.vertical);
    if (iv?.wait_cost) {
      lines.push(`⏱ ${iv.wait_cost.verdict} — ${iv.wait_cost.reason}`);
    }
    if (iv?.half_life) {
      lines.push(`⌛ Half-life ~${iv.half_life.est_days_remaining}d · ${iv.half_life.opportunity_remaining_pct}% room left`);
    }
    const absent = iv?.absent_universe?.[0];
    if (absent) {
      lines.push(`🕳 Nobody running: ${absent.angle_id} — ${absent.opportunity.slice(0, 120)}`);
    }
    lines.push('');
  }

  lines.push(`📊 Live radar: ${config.atlasPublicBase}/atlas.html`);
  lines.push(`🔍 Whitespace finder: ${config.atlasPublicBase}/`);
  if (brief.resilience) lines.push('', brief.resilience.slice(0, 200));

  return lines.join('\n').slice(0, 4096);
}

export async function sendTelegramMessage(text: string): Promise<boolean> {
  if (!hasTelegram()) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text,
        disable_web_page_preview: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json()) as { ok: boolean; description?: string };
    if (!json.ok) {
      console.warn('  Telegram API:', json.description || res.status);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('  Telegram failed:', (e as Error).message?.slice(0, 120));
    return false;
  }
}

/** Push daily brief — called at end of brief.ts / cron. */
export async function sendAtlasDailyBrief(brief: AtlasBrief): Promise<void> {
  if (!hasTelegram()) {
    console.log('  Telegram: skip (set TELEGRAM_BOT_TOKEN + ATLAS_TELEGRAM_CHAT_ID or TELEGRAM_LEADS_DIGEST_CHAT_ID)');
    return;
  }
  const text = formatAtlasTelegramMessage(brief);
  const ok = await sendTelegramMessage(text);
  console.log(ok ? '  Telegram: Atlas daily brief sent ✓' : '  Telegram: send failed');
}

/** On-demand summary from disk — for /atlas command bot. */
export function loadBriefFromDisk(): AtlasBrief | null {
  const p = join(DATA_DIR, 'brief.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as AtlasBrief;
  } catch {
    return null;
  }
}

/** Short status for /radar command. */
export function formatRadarStatus(): string {
  const brief = loadBriefFromDisk();
  if (!brief) return 'Atlas radar: no brief yet — run capture → classify → brief first.';
  const n = brief.verticals?.length ?? 0;
  const enters = (brief.verticals || []).filter((v) => v.move.state === 'ENTER').length;
  return [
    `Atlas radar · ${brief.snapshot_date}`,
    `${n} verticals tracked · ${enters} ENTER signals`,
    `${config.atlasPublicBase}/atlas.html`,
  ].join('\n');
}
