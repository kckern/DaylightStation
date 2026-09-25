import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupRows, readLedger, reconcileByDay, summarizeLedger, runCli } from './openai-usage.cli.mjs';

const roots = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('openai-usage CLI', () => {
  it('does not run when imported', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitCode = process.exitCode;
    vi.resetModules();
    const mod = await import('./openai-usage.cli.mjs');
    expect(typeof mod.runCli).toBe('function');
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(exitCode);
  });

  it('groups rows by key and sums each column', () => {
    const rows = [
      { model: 'gpt-4o', costUsd: 0.5, totalTokens: 100 },
      { model: 'gpt-4o', costUsd: 0.25, totalTokens: 50 },
      { model: null, costUsd: 1, totalTokens: 10 },
    ];
    const grouped = groupRows(rows, { model: r => r.model }, { calls: () => 1, usd: r => r.costUsd, tokens: r => r.totalTokens });
    expect(grouped).toEqual([
      { model: 'gpt-4o', calls: 2, usd: 0.75, tokens: 150 },
      { model: '-', calls: 1, usd: 1, tokens: 10 },
    ]);
  });

  it('reads every monthly ledger file inside [since, until), tagging writer and day', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openai-usage-cli-'));
    roots.push(dir);
    await fs.writeFile(path.join(dir, '2026-08.docker.jsonl'), [
      JSON.stringify({ ts: '2026-08-30T12:00:00.000-07:00', model: 'gpt-4o', costUsd: 0.1 }),
      JSON.stringify({ ts: '2026-08-31T23:00:00.000-07:00', model: 'gpt-4o', costUsd: 0.2 }),
      '{not json',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(dir, '2026-09.kckern-macbook.jsonl'), [
      JSON.stringify({ ts: '2026-09-01T08:00:00.000-07:00', model: 'gpt-4.1', costUsd: 0.3 }),
      JSON.stringify({ ts: '2026-09-02T08:00:00.000-07:00', model: 'gpt-4.1', costUsd: 0.4 }),
    ].join('\n'));
    await fs.writeFile(path.join(dir, 'notes.txt'), 'ignored');

    const rows = readLedger(dir, '2026-08-31', '2026-09-02');
    expect(rows.map(r => [r.day, r.writer, r.costUsd])).toEqual([
      ['2026-08-31', 'docker', 0.2],
      ['2026-09-01', 'kckern-macbook', 0.3],
    ]);
    expect(readLedger(dir, null, null)).toHaveLength(4);
    expect(readLedger(path.join(dir, 'missing'), '2026-09-01', null)).toEqual([]);
  });

  it('reconciles billed and ledger dollars per day', () => {
    const costRows = [
      { day: '2026-09-10', amount: { value: '1.5' } },
      { day: '2026-09-10', amount: { value: '0.5' } },
    ];
    const ledgerRows = [
      { day: '2026-09-10', costUsd: 0.25, status: 'ok' },
      { day: '2026-09-10', costUsd: 0.25, status: 'ok' },
      { day: '2026-09-10', costUsd: 0, status: 'error' },
      { day: '2026-09-09', costUsd: 0.1, status: 'error' },
    ];
    const days = reconcileByDay(costRows, ledgerRows);
    expect(days.map(d => d.day)).toEqual(['2026-09-09', '2026-09-10']);
    const [sep9, sep10] = days;
    expect(sep10).toMatchObject({ billedUsd: 2, ledgerCalls: 3, ledgerErrors: 1 });
    expect(sep10.ledgerUsd).toBeCloseTo(0.5, 9);
    expect(sep10.gapUsd).toBeCloseTo(1.5, 9);
    expect(sep9).toMatchObject({ billedUsd: 0, ledgerCalls: 1, ledgerErrors: 1 });
    expect(sep9.gapUsd).toBeCloseTo(-0.1, 9);
  });

  describe('ledger by app and feature', () => {
    const rows = [
      { ts: 't', app: 'health', feature: 'photo-log', origin: 'telegram:nutribot', costUsd: 0.02, totalTokens: 900, status: 'ok' },
      { ts: 't', app: 'health', feature: 'photo-log', origin: 'http:POST /api/v1/nutribot/image', costUsd: 0.01, totalTokens: 400, status: 'ok' },
      { ts: 't', app: 'health', feature: null, origin: 'job:x', costUsd: 0.005, totalTokens: 10, status: 'ok' },
      { ts: 't', app: 'journalist', feature: null, origin: 'telegram:journalist', costUsd: 0.1, totalTokens: 3000, status: 'ok' },
      { ts: 't', app: null, feature: null, origin: 'http:GET /api/v1/ai/chat', costUsd: 0.3, totalTokens: 5000, status: 'ok' },
      { ts: 't', app: null, feature: null, origin: 'http:GET /api/v1/ai/chat', costUsd: 0, totalTokens: null, status: 'error' },
      { ts: 't', costUsd: 0.7, totalTokens: 7000, status: 'ok' }, // written before tagging existed
    ];

    it('groups by app,feature with readable labels for missing values', () => {
      const { rows: out, columns } = summarizeLedger(rows, { by: 'app,feature' });
      expect(columns).toEqual(['app', 'feature', 'calls', 'errors', 'tokens', 'usd', 'unpriced']);
      const find = (app, feature) => out.find(r => r.app === app && r.feature === feature);
      expect(find('health', 'photo-log')).toMatchObject({ calls: 2, tokens: 1300 });
      expect(find('health', 'photo-log').usd).toBeCloseTo(0.03, 9);
      expect(find('health', '(no feature)')).toMatchObject({ calls: 1 });
      expect(find('(untagged)', '(no feature)')).toMatchObject({ calls: 3, errors: 1 });
    });

    it('--untagged keeps only rows no app claimed, grouped by origin', () => {
      const { rows: out, columns, calls, total } = summarizeLedger(rows, { untagged: true });
      expect(columns[0]).toBe('origin');
      expect(calls).toBe(3);
      expect(total).toBeCloseTo(1.0, 9);
      expect(out).toEqual([
        expect.objectContaining({ origin: '(no origin)', calls: 1 }),
        expect.objectContaining({ origin: 'http:GET /api/v1/ai/chat', calls: 2, errors: 1 }),
      ]);
    });

    it('runs end to end against a data dir', async () => {
      const base = await fs.mkdtemp(path.join(os.tmpdir(), 'openai-usage-base-'));
      roots.push(base);
      const dir = path.join(base, 'data', 'system', 'history', 'ai-usage');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, '2026-09.docker.jsonl'), rows.map(r => JSON.stringify({ ...r, ts: '2026-09-10T12:00:00.000Z' })).join('\n'));
      vi.stubEnv('DAYLIGHT_BASE_PATH', base);
      const lines = [];
      await runCli(['ledger', '--untagged', '--since', '2026-09-01', '--json'], (line) => lines.push(line));
      const parsed = JSON.parse(lines[0]);
      expect(parsed.map(r => r.origin).sort()).toEqual(['(no origin)', 'http:GET /api/v1/ai/chat']);
      lines.length = 0;
      await runCli(['ledger', '--by', 'app,feature', '--since', '2026-09-01'], (line) => lines.push(line));
      expect(lines.join('\n')).toContain('photo-log');
      expect(lines.join('\n')).toContain('Ledger total');
      vi.unstubAllEnvs();
    });
  });
});

