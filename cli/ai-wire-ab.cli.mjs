#!/usr/bin/env node
/**
 * ai-wire-ab — replay real food descriptions through LogFoodFromText on the
 * JSON path and the TOON wire-layer path; compare items, kcal, reply size and
 * wall time. Exit 0 = TOON is equivalent; 1 = not; 2 = usage/setup error.
 *
 *   node cli/ai-wire-ab.cli.mjs --texts-b64 <base64 of newline-separated descriptions> [--runs 3]
 *
 * Calls are attributed to app ai-wire-ab, feature cli, with wire tags.
 */
import axios from 'axios';
import { getConfigService } from './_bootstrap.mjs';
import { createCliAiUsageLedger, cliUsageTags } from './_aiUsage.mjs';
import { runWithOrigin } from '#system/runtime/aiContext.mjs';
import { summarize } from './ai-wire-ab.lib.mjs';

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};

async function main() {
  const b64 = arg('--texts-b64');
  if (!b64) { process.stderr.write('usage: --texts-b64 <base64> [--runs N]\n'); process.exit(2); }
  const texts = Buffer.from(b64, 'base64').toString('utf8').split('\n').map((t) => t.trim()).filter(Boolean);
  const runs = Number(arg('--runs', '3'));

  const cfg = await getConfigService();
  const apiKey = cfg.getSystemAuth('openai', 'api_key');
  if (!apiKey) { process.stderr.write('OpenAI api_key not resolved from config\n'); process.exit(2); }

  const { OpenAIAdapter } = await import('#adapters/ai/OpenAIAdapter.mjs');
  const { StructuredWireLayer } = await import('#adapters/ai/StructuredWireLayer.mjs');
  const { LogFoodFromText } = await import('#apps/nutribot/usecases/LogFoodFromText.mjs');

  const base = new OpenAIAdapter({ apiKey }, { httpClient: axios, aiUsageLedger: createCliAiUsageLedger(cfg) })
    .scoped(cliUsageTags('ai-wire-ab'));
  let fallbacks = 0;
  const wireLogger = { debug() {}, info() {}, error() {}, warn: (event) => { if (event === 'ai.wire.decode.fallback') fallbacks += 1; } };
  const gateways = {
    json: base,
    toon: new StructuredWireLayer(base, { mode: 'full', sample: 1, logger: wireLogger }),
  };

  const results = [];
  for (const text of texts) {
    for (let run = 1; run <= runs; run += 1) {
      for (const path of ['json', 'toon']) {
        // replyChars compares the size of what each path RETURNS to the use
        // case, not tokens. The JSON path's is the raw JSON; the TOON path's is
        // the JSON string the layer reconstructs. Token savings are read from
        // the usage ledger (`wire` + `completionTokens`), not from this number.
        let replyChars = 0;
        const measured = {
          chat: async (messages, options) => {
            const reply = await gateways[path].chat(messages, options);
            replyChars = String(reply).length;
            return reply;
          },
        };
        const saved = [];
        const silent = { debug() {}, info() {}, warn() {}, error() {} };
        const uc = new LogFoodFromText({
          messagingGateway: { sendMessage: async () => ({ messageId: 'ab' }), updateMessage: async () => {}, deleteMessage: async () => {} },
          aiGateway: measured,
          foodLogStore: { save: async (log) => { saved.push(log); } },
          logger: silent,
        });
        const before = fallbacks;
        const started = Date.now();
        await uc.execute({ userId: 'ai-wire-ab', conversationId: 'cli:ai-wire-ab', text, messageId: null }).catch(() => {});
        const items = (saved.at(-1)?.items ?? []).filter((i) => i.kind !== 'group');
        results.push({
          text, path, run, ms: Date.now() - started, replyChars,
          itemCount: items.length,
          kcal: items.reduce((n, i) => n + (Number(i.calories) || 0), 0),
          fallback: fallbacks > before,
        });
      }
    }
  }

  const { perPath, verdict } = summarize(results);
  process.stdout.write(`${JSON.stringify({ texts: texts.length, runs, perPath, verdict }, null, 2)}\n`);
  process.exit(verdict.pass ? 0 : 1);
}

runWithOrigin('cli:ai-wire-ab', main).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(2);
});
