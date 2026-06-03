#!/usr/bin/env node
/**
 * Journalist Morning-Debrief Headline Preview
 *
 * Runs the REAL morning-debrief generation path (new SECTION 0: HOOK prompt +
 * live model + headline parsing + send-layer formatting) against real persisted
 * data — but prints the rendered Telegram message instead of sending it.
 *
 * Zero side effects: no Telegram message, no debriefs.yml write, no deploy.
 *
 * Data is reconstructed from the persisted debrief (per-source summaries) and the
 * user's recent journal messages, mirroring what LifelogAggregator + the
 * conversation-context loader feed the use case in production.
 *
 * Usage:
 *   DAYLIGHT_BASE_PATH=/path node cli/journalist-debrief-preview.cli.mjs [YYYY-MM-DD]
 *   (inside Docker, DAYLIGHT_BASE_PATH is not needed)
 */

import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import yaml from 'js-yaml';
import axios from 'axios';

import { getConfigService } from './_bootstrap.mjs';
import { GenerateMorningDebrief } from '#backend/src/3_applications/journalist/usecases/GenerateMorningDebrief.mjs';
import { SendMorningDebrief } from '#backend/src/3_applications/journalist/usecases/SendMorningDebrief.mjs';

const USERNAME = 'kckern';

async function readYaml(absPath) {
  try {
    return yaml.load(await readFile(absPath, 'utf8')) || null;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Send the rendered debrief to the journalist Telegram chat, reusing the blessed
 * SendMorningDebrief logic. No persistence (state/debrief repos omitted) — a pure
 * out-of-band push that does not touch debriefs.yml or pollute the next cron run.
 */
async function sendToTelegram(cfg, debrief) {
  const auth = await readYaml(path.join(cfg.getDataDir(), 'system', 'auth', 'telegram.yml'));
  const token = auth?.journalist?.token;
  if (!token) throw new Error('journalist bot token missing (system/auth/telegram.yml).');

  const convDir = path.join(cfg.getDataDir(), 'users', USERNAME, 'conversations', 'journalist');
  const files = await readdir(convDir);
  const match = files.map((f) => f.match(/^telegram_b\d+_c(\d+)\.yml$/)).find(Boolean);
  if (!match) throw new Error(`Could not resolve chat id from ${convDir}.`);
  const chatId = match[1];

  const messagingGateway = {
    sendMessage: async (_cid, text, options = {}) => {
      const body = {
        chat_id: chatId,
        text,
        ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
        ...(options.choices ? { reply_markup: { inline_keyboard: options.choices } } : {}),
      };
      const resp = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, body);
      return { messageId: String(resp.data?.result?.message_id) };
    },
  };

  const sender = new SendMorningDebrief({ messagingGateway, logger: console });
  return sender.execute({ conversationId: String(chatId), debrief });
}

async function main() {
  const SEND = process.argv.includes('--send');
  const cfg = await getConfigService();
  const apiKey = cfg.getSecret('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY not resolved from config.');

  const journalDir = path.join(cfg.getDataDir(), 'users', USERNAME, 'lifelog', 'journalist');
  const debriefsDoc = await readYaml(path.join(journalDir, 'debriefs.yml'));
  const messagesDoc = await readYaml(path.join(journalDir, 'messages.yml'));

  const debriefs = debriefsDoc?.debriefs || [];
  const dateArg = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const targetDate = dateArg || debriefs[0]?.date;
  const debrief = debriefs.find((d) => d.date === targetDate);
  if (!debrief) throw new Error(`No persisted debrief found for date ${targetDate}.`);

  // Reconstruct the data block the way LifelogAggregator produces summaryText:
  // the per-source summary texts, joined.
  const summaries = debrief.summaries || [];
  const summaryText = summaries.map((s) => s.text).filter(Boolean).join('\n\n');
  const sources = summaries.map((s) => s.source).filter(Boolean);

  // Real recent user messages (newest-first file) for conversation context —
  // matches GenerateMorningDebrief#loadConversationContext (last 3 user msgs).
  // Only include messages on/before the target date so the preview is faithful
  // (a debrief for date D never had access to messages written after D).
  const cutoff = `${targetDate}T23:59:59`;
  const allMessages = messagesDoc?.messages || [];
  const recentUserMessages = allMessages
    .filter((m) => m.senderId !== 'bot' && m.role !== 'assistant')
    .filter((m) => (m.timestamp || '') <= cutoff)
    .slice(0, 3)
    .map((m) => ({ content: m.content || m.text, timestamp: m.timestamp }));

  // Stub adapters: real data in, no persistence/network beyond the AI call.
  const lifelogAggregator = {
    aggregate: async () => ({
      _meta: { date: targetDate, hasEnoughData: true, sources },
      summaryText,
      summaries,
    }),
  };
  const journalEntryRepository = {
    findRecent: async () => recentUserMessages.map((m) => ({ ...m, senderId: String(USERNAME) })),
  };

  const { OpenAIAdapter } = await import('#adapters/ai/OpenAIAdapter.mjs');
  const aiGateway = new OpenAIAdapter({ apiKey }, { httpClient: axios });

  const useCase = new GenerateMorningDebrief({ lifelogAggregator, aiGateway, journalEntryRepository });
  const result = await useCase.execute({ username: USERNAME, date: targetDate, conversationId: 'preview' });

  // Render exactly as SendMorningDebrief would (without sending).
  const dateObj = new Date(targetDate + 'T00:00:00');
  const rendered =
    `${SendMorningDebrief.buildHeader(result.headline, dateObj)}\n\n` +
    SendMorningDebrief.applyTelegramStyling(result.summary);

  console.log(`\n=== DEBRIEF ${SEND ? 'SEND' : 'PREVIEW'} for ${targetDate} (${recentUserMessages.length} ctx msgs) ===`);
  console.log(`\nHEADLINE (raw): ${JSON.stringify(result.headline)}`);
  console.log(`\n--- RENDERED MESSAGE (Telegram HTML) ---\n${rendered}\n`);

  if (SEND) {
    const sendResult = await sendToTelegram(cfg, result);
    console.log(`\n>>> SENT to Telegram — messageId=${sendResult.messageId} fallback=${sendResult.fallback}\n`);
  }
}

main().catch((err) => {
  console.error('preview failed:', err.message);
  process.exit(1);
});
