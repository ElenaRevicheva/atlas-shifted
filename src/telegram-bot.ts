/**
 * telegram-bot.ts — optional Atlas command listener (long-poll).
 *
 * ⚠ Use a DEDICATED bot token (ATLAS_TELEGRAM_BOT_TOKEN) OR run only when the
 * CTO AIPA bot is NOT polling the same token — Telegram allows one getUpdates consumer.
 *
 * Commands: /start /atlas /radar /help
 *
 * Run:  node dist/telegram-bot.js
 * PM2:  pm2 start dist/telegram-bot.js --name atlas-telegram
 */
import 'dotenv/config';
import { config, hasTelegram } from './config.js';
import { formatAtlasTelegramMessage, formatRadarStatus, loadBriefFromDisk } from './telegram.js';

const HELP = `Atlas Shifted AIPA — commands:
/atlas — today's daily brief + intelligence
/radar — snapshot status + live dashboard link
/help — this message

Live: ${config.atlasPublicBase}/atlas.html`;

async function reply(chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) }),
  });
}

async function handleUpdate(update: { message?: { chat: { id: number }; text?: string } }): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const cmd = text.split(/\s+/)[0]!.toLowerCase();

  if (cmd === '/start' || cmd === '/help') {
    await reply(chatId, HELP);
    return;
  }
  if (cmd === '/radar') {
    await reply(chatId, formatRadarStatus());
    return;
  }
  if (cmd === '/atlas') {
    const brief = loadBriefFromDisk();
    if (!brief) {
      await reply(chatId, 'No brief yet — Atlas captures every morning at 9 AM Panama.');
      return;
    }
    await reply(chatId, formatAtlasTelegramMessage(brief));
    return;
  }
}

async function poll(): Promise<void> {
  if (!hasTelegram()) {
    console.error('Telegram bot: set ATLAS_TELEGRAM_BOT_TOKEN (or TELEGRAM_BOT_TOKEN) + chat id');
    process.exit(1);
  }
  console.log(`Atlas Telegram bot polling · chat ${config.telegramChatId}`);
  let offset = 0;
  for (;;) {
    try {
      const url = `https://api.telegram.org/bot${config.telegramBotToken}/getUpdates?timeout=30&offset=${offset}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(35_000) });
      const json = (await res.json()) as { ok: boolean; result: Array<{ update_id: number } & Record<string, unknown>> };
      if (!json.ok) {
        console.warn('getUpdates failed', res.status);
        await sleep(5000);
        continue;
      }
      for (const u of json.result || []) {
        offset = u.update_id + 1;
        await handleUpdate(u as Parameters<typeof handleUpdate>[0]);
      }
    } catch (e) {
      console.warn('poll error:', (e as Error).message?.slice(0, 80));
      await sleep(3000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

poll();
