import { describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createAiUsageLedger } from './AiUsageLedger.mjs';

describe('AiUsageLedger', () => {
  it('appends one JSON line per record to the current month file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-ledger-'));
    const ledger = createAiUsageLedger({ dir });

    await ledger.record({ provider: 'openai', endpoint: '/chat/completions', model: 'gpt-4.1', totalTokens: 100, costUsd: 0.001, status: 'ok' });
    await ledger.record({ provider: 'openai', endpoint: '/embeddings', model: 'text-embedding-3-small', totalTokens: 12, costUsd: 0, status: 'ok' });

    const month = new Date().toISOString().slice(0, 7);
    const lines = (await fs.readFile(path.join(dir, `${month}.jsonl`), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first).toMatchObject({ provider: 'openai', model: 'gpt-4.1', totalTokens: 100, costUsd: 0.001 });
    expect(new Date(first.ts).getTime()).not.toBeNaN();
    expect(JSON.parse(lines[1]).endpoint).toBe('/embeddings');
  });

  it('names the file per writer when a source is given', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-ledger-'));
    const ledger = createAiUsageLedger({ dir, source: 'kckern-macbook' });
    await ledger.record({ provider: 'openai', endpoint: '/chat/completions', status: 'ok' });
    const month = new Date().toISOString().slice(0, 7);
    await expect(fs.stat(path.join(dir, `${month}.kckern-macbook.jsonl`))).resolves.toBeTruthy();
  });

  it('creates the directory on first write', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-ledger-'));
    const dir = path.join(base, 'nested', 'ai-usage');
    const ledger = createAiUsageLedger({ dir });
    await ledger.record({ provider: 'openai', endpoint: '/chat/completions', status: 'ok' });
    const files = await fs.readdir(dir);
    expect(files).toHaveLength(1);
  });

  it('swallows write failures and warns instead of rejecting', async () => {
    const logger = { warn: vi.fn() };
    // A file path used as the directory makes mkdir fail deterministically.
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-ledger-'));
    const notADir = path.join(base, 'blocker');
    await fs.writeFile(notADir, 'x');
    const ledger = createAiUsageLedger({ dir: path.join(notADir, 'sub'), logger });

    await expect(ledger.record({ provider: 'openai', endpoint: '/chat/completions', status: 'ok' })).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('ai.usage.ledger-write-failed', expect.anything());
  });

  it('lists one agent\'s costs in a time range across every writer\'s month files', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-ledger-'));
    const line = row => JSON.stringify(row);
    await fs.writeFile(path.join(dir, '2026-09.jsonl'), [
      line({ ts: '2026-09-04T10:00:00.000Z', agentId: 'nutrition-auditor', costUsd: 0.5, status: 'ok' }),
      line({ ts: '2026-09-04T11:00:00.000Z', agentId: 'other-agent', costUsd: 1 }),
      '{not json',
      line({ ts: '2026-09-05T10:00:00.000Z', agentId: 'nutrition-auditor', costUsd: 2 }),
      line({ ts: 'garbage', agentId: 'nutrition-auditor', costUsd: 3 }),
      line({ ts: '2026-09-04T12:00:00.000Z', agentId: 'nutrition-auditor', costUsd: null }),
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, '2026-09.docker.jsonl'), line({ ts: '2026-09-04T13:00:00.000Z', agentId: 'nutrition-auditor', costUsd: 0.25, status: 'error' }) + '\n');
    await fs.writeFile(path.join(dir, '2026-08.jsonl'), line({ ts: '2026-08-31T23:00:00.000Z', agentId: 'nutrition-auditor', costUsd: 7 }) + '\n');
    await fs.writeFile(path.join(dir, 'notes.txt'), 'ignore me');
    const ledger = createAiUsageLedger({ dir });
    const rows = await ledger.listCosts({ agentId: 'nutrition-auditor', from: '2026-09-04T00:00:00.000Z', to: '2026-09-05T00:00:00.000Z' });
    expect(rows.sort((a, b) => a.ts.localeCompare(b.ts))).toEqual([
      { ts: '2026-09-04T10:00:00.000Z', costUsd: 0.5 }, { ts: '2026-09-04T13:00:00.000Z', costUsd: 0.25 },
    ]);
    expect(await createAiUsageLedger({ dir: path.join(dir, 'missing') }).listCosts({ agentId: 'nutrition-auditor', from: '2026-09-04T00:00:00.000Z', to: '2026-09-05T00:00:00.000Z' })).toEqual([]);
  });
});
