import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimateCostUsd } from '#adapters/ai/aiPricing.mjs';
import yaml from 'js-yaml';
import { backfill, buildRows, defaultStateFile, parseArgs, runCli } from './nutrition-auditor-backfill.cli.mjs';

const roots = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

function transcript({ turnId, runId, startedAt, completedAt, status = 'ok', usage, output, toolCalls = [] }) {
  return {
    version: 1, turnId, agentId: 'nutrition-auditor', userId: 'alice', startedAt, completedAt, durationMs: 1000, status,
    input: { text: '{}', context: { userId: 'alice', ...(runId ? { runId } : {}), maxToolCalls: 20, turnId } },
    systemPrompt: 'prompt', model: { name: 'gpt-4o', provider: 'openai' }, toolCalls,
    output: { text: output, finishReason: 'stop', usage }, error: null, tags: [],
  };
}

const usageA1 = { inputTokens: 1000, outputTokens: 100, totalTokens: 1100, cachedInputTokens: 0 };
const usageA2 = { inputTokens: 2000, outputTokens: 200, totalTokens: 2200, cachedInputTokens: 500 };
const usageB = { inputTokens: 3000, outputTokens: 50, totalTokens: 3050, cachedInputTokens: 0 };

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auditor-backfill-'));
  roots.push(root);
  const mediaDir = path.join(root, 'media');
  const dataDir = path.join(root, 'data');
  const day = path.join(mediaDir, 'logs/agents/nutrition-auditor/2026-09-10/alice');
  const oldDay = path.join(mediaDir, 'logs/agents/nutrition-auditor/2026-09-01/alice');
  await fs.mkdir(day, { recursive: true });
  await fs.mkdir(oldDay, { recursive: true });
  const write = (dir, name, body) => fs.writeFile(path.join(dir, name), JSON.stringify(body));
  // run A: first attempt failed, retry succeeded
  await write(day, '100000-000-aaaa1111.json', transcript({ turnId: 'aaaa1111-x', runId: 'audit_A', startedAt: '2026-09-10T10:00:00.000Z',
    completedAt: '2026-09-10T10:00:30.000Z', status: 'error', usage: usageA1, output: '',
    toolCalls: [{ ix: 0, name: 'lookup_upc', args: { upc: '0123' }, result: {}, ok: true }] }));
  await write(day, '100100-000-aaaa2222.json', transcript({ turnId: 'aaaa2222-x', runId: 'audit_A', startedAt: '2026-09-10T10:01:00.000Z',
    completedAt: '2026-09-10T10:01:40.000Z', usage: usageA2,
    output: JSON.stringify({ summary: 'Fixed a serving size.', repairs: [{ mode: 'update', entryId: 'e1' }],
      questions: [{ question: 'Was it a large?', choices: [{ id: 'c1', label: 'Yes' }, { id: 'c2', label: 'No' }] }] }),
    toolCalls: [{ ix: 0, name: 'search_food', args: { q: 'x'.repeat(400) }, result: {}, ok: true }] }));
  // run B: malformed output
  await write(day, '120000-000-bbbb1111.json', transcript({ turnId: 'bbbb1111-x', runId: 'audit_B', startedAt: '2026-09-10T12:00:00.000Z',
    completedAt: '2026-09-10T12:00:20.000Z', usage: usageB, output: '{not json' }));
  // no runId
  await write(day, '130000-000-cccc1111.json', transcript({ turnId: 'cccc1111-x', startedAt: '2026-09-10T13:00:00.000Z',
    completedAt: '2026-09-10T13:00:05.000Z', usage: usageB, output: '{}' }));
  // before --since
  await write(oldDay, '090000-000-dddd1111.json', transcript({ turnId: 'dddd1111-x', runId: 'audit_OLD', startedAt: '2026-09-01T09:00:00.000Z',
    completedAt: '2026-09-01T09:00:05.000Z', usage: usageB, output: '{}' }));
  return { root, mediaDir, dataDir, journalDir: path.join(dataDir, 'users/alice/lifelog/nutrition/auditor-journal') };
}

const price = u => estimateCostUsd('gpt-4o', { promptTokens: u.inputTokens, completionTokens: u.outputTokens, cachedTokens: u.cachedInputTokens });

async function readJournal(dir) {
  const names = await fs.readdir(dir).catch(() => []);
  const rows = [];
  for (const name of names) rows.push(...(await fs.readFile(path.join(dir, name), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l)));
  return { names, rows };
}

describe('nutrition-auditor-backfill CLI', () => {
  it('does not run when imported', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.resetModules();
    const mod = await import('./nutrition-auditor-backfill.cli.mjs');
    expect(typeof mod.runCli).toBe('function');
    expect(log).not.toHaveBeenCalled();
  });

  it('parses flags and rejects bad values', () => {
    expect(parseArgs([])).toMatchObject({ since: '2026-09-06', 'dry-run': false });
    expect(parseArgs(['--since', '2026-09-10', '--user', 'alice', '--dry-run'])).toMatchObject({ since: '2026-09-10', user: 'alice', 'dry-run': true });
    expect(() => parseArgs(['--since', '9/10'])).toThrow(/--since/);
    expect(() => parseArgs(['--user', '../x'])).toThrow(/--user/);
    expect(() => parseArgs(['--bogus'])).toThrow(/Unknown/);
  });

  it('marks a run unpriced when its model has no price', () => {
    const t = transcript({ turnId: 't', runId: 'audit_X', startedAt: '2026-09-10T10:00:00.000Z', usage: usageB, output: '{}' });
    t.model.name = 'no-such-model';
    const { rows, unpriced } = buildRows([t]);
    expect(rows[0].costUsd).toBeNull();
    expect(unpriced).toEqual(['audit_X']);
  });

  it('dry run reports the rows and writes nothing', async () => {
    const f = await fixture();
    const lines = [];
    const totals = await runCli(['--media-dir', f.mediaDir, '--data-dir', f.dataDir, '--dry-run'], l => lines.push(l));
    expect(totals).toMatchObject({ runs: 2, written: 2, skipped: 0, withoutRunId: 1, transcripts: 4 });
    expect(lines.join('\n')).toMatch(/DRY RUN/);
    expect(lines.filter(l => l.includes('audit_'))).toHaveLength(2);
    expect((await readJournal(f.journalDir)).rows).toEqual([]);
  });

  it('writes one row per run with summed usage and cost, then is idempotent', async () => {
    const f = await fixture();
    const first = await backfill({ mediaDir: f.mediaDir, dataDir: f.dataDir, out: () => {} });
    expect(first).toMatchObject({ runs: 2, written: 2, skipped: 0, withoutRunId: 1, unpriced: [] });

    const { names, rows } = await readJournal(f.journalDir);
    expect(names).toEqual(['2026-09.backfill.jsonl']);
    expect(rows).toHaveLength(2);
    const a = rows.find(r => r.runId === 'audit_A');
    const b = rows.find(r => r.runId === 'audit_B');

    expect(a).toMatchObject({
      at: '2026-09-10T10:00:00.000Z', completedAt: '2026-09-10T10:01:40.000Z', status: 'completed', trigger: ['unknown'],
      backfilled: true, model: 'gpt-4o', turnId: 'aaaa2222-x', usage: { input: 3000, cached: 500, output: 300 },
      summary: 'Fixed a serving size.', proposals: [{ mode: 'update', entryId: 'e1' }],
      questions: [{ question: 'Was it a large?', choices: ['Yes', 'No'] }],
    });
    expect(a.costUsd).toBeCloseTo(price(usageA1) + price(usageA2), 9);
    expect(a.costUsd).toBeGreaterThan(0);
    expect(a.toolCalls.map(c => c.name)).toEqual(['lookup_upc', 'search_food']);
    expect(a.toolCalls[1].args).toHaveLength(200);

    expect(b).toMatchObject({ status: 'completed', summary: null, proposals: [], questions: [], usage: { input: 3000, cached: 0, output: 50 } });
    expect(b.costUsd).toBeCloseTo(price(usageB), 9);
    expect(first.costUsd).toBeCloseTo(a.costUsd + b.costUsd, 6);

    const second = await backfill({ mediaDir: f.mediaDir, dataDir: f.dataDir, out: () => {} });
    expect(second).toMatchObject({ runs: 2, written: 0, skipped: 2 });
    expect((await readJournal(f.journalDir)).rows).toHaveLength(2);
  });

  it('marks a run failed when its last transcript did not finish ok', async () => {
    const t = transcript({ turnId: 't', runId: 'audit_F', startedAt: '2026-09-10T10:00:00.000Z', status: 'error', usage: null, output: null });
    const { rows } = buildRows([t]);
    expect(rows[0]).toMatchObject({ status: 'failed', costUsd: 0, summary: null, usage: { input: 0, cached: 0, output: 0 } });
  });

  it('labels answer turns with the answer trigger', () => {
    const t = transcript({ turnId: 't', runId: 'answer_q1', startedAt: '2026-09-10T10:00:00.000Z', usage: usageB, output: '{}' });
    expect(buildRows([t]).rows[0].trigger).toEqual(['answer']);
  });

  it('--state-file needs --user', () => {
    expect(() => parseArgs(['--state-file', '/x.yml'])).toThrow(/--user/);
    expect(parseArgs(['--state-file', '/x.yml', '--user', 'alice'])).toMatchObject({ 'state-file': '/x.yml' });
  });

  describe('with the cleanup state file', () => {
    const appliedA = [{ status: 'applied', operationId: 'audit_A_0', affectedIds: ['e1'] }, { status: 'unchanged', operationId: 'audit_A_1', affectedIds: [] }];
    const state = {
      version: 7, settings: {}, questions: {},
      runs: {
        audit_A: { id: 'audit_A', status: 'completed', attempt: 2, dryRun: false, manual: true, createdAt: '2026-09-10T09:59:58.000Z',
          completedAt: '2026-09-10T10:01:41.000Z', outcomes: appliedA, summary: 'Recorded summary.' },
        audit_S: { id: 'audit_S', status: 'failed', attempt: 3, dryRun: true, manual: false, createdAt: '2026-09-10T11:00:00.000Z',
          error: 'Your API key has been invalidated.', retryAt: 1, snapshot: { rows: [] } },
        audit_Q: { id: 'audit_Q', status: 'queued', attempt: 0, createdAt: '2026-09-10T14:00:00.000Z' },
        audit_OLDSTATE: { id: 'audit_OLDSTATE', status: 'completed', attempt: 1, createdAt: '2026-09-01T09:00:00.000Z', outcomes: [], summary: 'x' },
      },
    };
    const writeState = async (file) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, yaml.dump(state)); };

    it('reads the store path by default and prefers recorded outcomes', async () => {
      const f = await fixture();
      expect(defaultStateFile(f.dataDir, 'alice')).toBe(path.join(f.dataDir, 'users/alice/agents/nutrition-cleanup.yml'));
      await writeState(defaultStateFile(f.dataDir, 'alice'));
      const totals = await backfill({ mediaDir: f.mediaDir, dataDir: f.dataDir, out: () => {} });
      expect(totals).toMatchObject({ runs: 3, written: 3, both: 1, stateOnly: 1, transcriptOnly: 1, stateRuns: 3 });

      const { rows } = await readJournal(f.journalDir);
      const a = rows.find(r => r.runId === 'audit_A');
      expect(a).toMatchObject({ at: '2026-09-10T09:59:58.000Z', completedAt: '2026-09-10T10:01:41.000Z', status: 'completed',
        outcomes: appliedA, summary: 'Recorded summary.', dryRun: false, manual: true, trigger: ['unknown'], backfilled: true,
        model: 'gpt-4o', usage: { input: 3000, cached: 500, output: 300 }, questions: [{ question: 'Was it a large?', choices: ['Yes', 'No'] }] });
      expect(a).not.toHaveProperty('proposals');
      expect(a).not.toHaveProperty('__source');
      expect(a.costUsd).toBeCloseTo(price(usageA1) + price(usageA2), 9);
      expect(a.toolCalls).toHaveLength(2);

      const s = rows.find(r => r.runId === 'audit_S');
      expect(s).toMatchObject({ status: 'failed', error: 'Your API key has been invalidated.', dryRun: true, manual: false,
        usage: null, costUsd: null, toolCalls: [], questions: [], trigger: ['unknown'], at: '2026-09-10T11:00:00.000Z', attempts: 3 });
      expect(s).not.toHaveProperty('snapshot');

      const b = rows.find(r => r.runId === 'audit_B');
      expect(b).toMatchObject({ proposals: [] });
      expect(b).not.toHaveProperty('outcomes');
      expect(rows.map(r => r.runId)).not.toContain('audit_Q');
      expect(rows.map(r => r.runId)).not.toContain('audit_OLDSTATE');

      const again = await backfill({ mediaDir: f.mediaDir, dataDir: f.dataDir, out: () => {} });
      expect(again).toMatchObject({ written: 0, skipped: 3 });
    });

    it('dry run prints the three counts and honours --state-file', async () => {
      const f = await fixture();
      const file = path.join(f.root, 'elsewhere/state.yml');
      await writeState(file);
      const lines = [];
      const totals = await runCli(['--media-dir', f.mediaDir, '--data-dir', f.dataDir, '--user', 'alice', '--state-file', file, '--dry-run'], l => lines.push(l));
      expect(totals).toMatchObject({ both: 1, stateOnly: 1, transcriptOnly: 1 });
      const text = lines.join('\n');
      expect(text).toMatch(/from state\+transcript: 1/);
      expect(text).toMatch(/state only: +1 \(no transcript/);
      expect(text).toMatch(/transcript only: +1/);
      expect(text).toMatch(/audit_S .*\[state only\].*no usage/);
      expect((await readJournal(f.journalDir)).rows).toEqual([]);
    });

    it('throws on an unreadable state file rather than dropping outcomes', async () => {
      const f = await fixture();
      const file = defaultStateFile(f.dataDir, 'alice');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, 'runs: [unclosed');
      await expect(backfill({ mediaDir: f.mediaDir, dataDir: f.dataDir, out: () => {} })).rejects.toThrow();
    });
  });
});
