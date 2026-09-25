import { describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCliAiUsageLedger, aiUsageDirFor, cliUsageTags } from './_aiUsage.mjs';
import { OpenAIAdapter } from '#adapters/ai/OpenAIAdapter.mjs';
import { runWithOrigin } from '#system/runtime/aiContext.mjs';

describe('CLI AI usage ledger', () => {
  it('writes to the app ledger directory under the cli writer file, attributed <app>/cli with its origin', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-ledger-'));
    const ledger = createCliAiUsageLedger({ getDataDir: () => dataDir });
    const post = vi.fn(async () => ({ status: 200, headers: {}, data: { model: 'gpt-4.1', choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } }));
    const ai = new OpenAIAdapter({ apiKey: 'k' }, { httpClient: { post }, logger: { debug() {}, info() {}, warn() {}, error() {} }, aiUsageLedger: ledger })
      .scoped(cliUsageTags('journalist'));
    await runWithOrigin('cli:journalist-debrief-preview', () => ai.chat([{ role: 'user', content: 'x' }]));
    await ledger.record({ provider: 'x', endpoint: 'flush' }); // resolves once prior appends settle

    const month = new Date().toISOString().slice(0, 7);
    const file = path.join(aiUsageDirFor(dataDir), `${month}.cli.jsonl`);
    const rows = (await fs.readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(rows[0]).toMatchObject({ app: 'journalist', feature: 'cli', origin: 'cli:journalist-debrief-preview', model: 'gpt-4.1' });
    expect(aiUsageDirFor('/d')).toBe(path.join('/d', 'system', 'history', 'ai-usage'));
  });
});
