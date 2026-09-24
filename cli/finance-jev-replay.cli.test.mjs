import { describe, it, expect, vi } from 'vitest';
import { runReplay, summarize, parseArgs, main } from './finance-jev-replay.cli.mjs';

const TAGS = ['Groceries', 'Fuel', 'Shopping'];

describe('finance-jev-replay', () => {
  it('scores Jev against the existing tag, overall and at the floor', async () => {
    const picks = { a: ['Groceries', 0.95], b: ['Shopping', 0.9], c: ['Fuel', 0.5] };
    const judge = { judge: vi.fn(async (txn) => ({ category: picks[txn.id][0], confidence: picks[txn.id][1], cjk: false })) };
    const transactions = [
      { id: 'a', description: 'Safeway', tagNames: ['Groceries'] },
      { id: 'b', description: 'Chevron', tagNames: ['Fuel'] },
      { id: 'c', description: 'Shell', tagNames: ['Fuel'] },
      { id: 'd', description: 'Untagged', tagNames: [] },
      { id: 'e', description: 'Odd tag', tagNames: ['Car Rental'] },
    ];

    const summary = await runReplay({ transactions, validTags: TAGS, judge, floor: 0.8 });

    expect(judge.judge).toHaveBeenCalledTimes(3);
    expect(summary).toMatchObject({ total: 3, judged: 3, confident: 2, agreementAtFloor: 0.5 });
    expect(summary.agreement).toBeCloseTo(2 / 3);
    expect(summary.coverage).toBeCloseTo(2 / 3);
    expect(summary.disagreements).toEqual([['Fuel -> Shopping', 1]]);
  });

  it('respects the limit', async () => {
    const judge = { judge: vi.fn(async () => ({ category: 'Fuel', confidence: 0.9, cjk: false })) };
    const transactions = Array.from({ length: 5 }, (_, i) => ({ id: i, description: 'Shell', tagNames: ['Fuel'] }));
    expect((await runReplay({ transactions, validTags: TAGS, judge, limit: 2 })).total).toBe(2);
  });

  it('counts a failed judgement as unjudged', () => {
    expect(summarize([{ tag: 'Fuel', jevCategory: null, confidence: null, cjk: false }], 0.8))
      .toMatchObject({ total: 1, judged: 0, agreement: null, coverage: 0, agreementAtFloor: null });
  });

  it('a null confidence is judged but never confident, even at floor 0', () => {
    expect(summarize([{ tag: 'Fuel', jevCategory: 'Fuel', confidence: null, cjk: false }], 0))
      .toMatchObject({ judged: 1, confident: 0, agreementAtFloor: null });
  });

  it('reports CJK rows separately', () => {
    const summary = summarize([
      { tag: 'Fuel', jevCategory: 'Fuel', confidence: 0.9, cjk: true },
      { tag: 'Fuel', jevCategory: 'Shopping', confidence: 0.9, cjk: true },
      { tag: 'Fuel', jevCategory: 'Fuel', confidence: 0.9, cjk: false },
    ], 0.8);
    expect(summary.cjk).toEqual({ judged: 2, agreement: 0.5 });
  });

  it('leaves the transactions it reads untouched', async () => {
    const judge = { judge: vi.fn(async () => ({ category: 'Fuel', confidence: 0.9, cjk: false })) };
    const transactions = [{ id: 1, description: 'Shell', tagNames: ['Fuel'], memo: 'x' }];
    const before = structuredClone(transactions);

    await runReplay({ transactions, validTags: TAGS, judge });

    expect(transactions).toEqual(before);
  });

  describe('parseArgs', () => {
    it('defaults', () => {
      expect(parseArgs([])).toEqual({ period: null, limit: 200, floor: 0.8, household: null, help: false });
    });

    it('reads every flag', () => {
      expect(parseArgs(['--period', '2026-01-01', '--limit', '50', '--floor', '0.9', '--household', 'h2']))
        .toEqual({ period: '2026-01-01', limit: 50, floor: 0.9, household: 'h2', help: false });
    });

    it('recognises --help and -h', () => {
      expect(parseArgs(['--help']).help).toBe(true);
      expect(parseArgs(['-h']).help).toBe(true);
    });

    it.each([
      [['--bogus'], /Unknown option: --bogus/],
      [['--limit', '0'], /--limit must be a positive integer/],
      [['--limit', 'many'], /--limit must be a positive integer/],
      [['--limit'], /--limit needs a value/],
      [['--floor', '1.5'], /--floor must be a number between 0 and 1/],
      [['--floor', 'high'], /--floor must be a number between 0 and 1/],
      [['--period', 'January'], /--period must be YYYY-MM-DD/],
      [['--household', '--limit'], /--household needs a value/],
    ])('rejects %j', (argv, message) => {
      expect(() => parseArgs(argv)).toThrow(message);
    });
  });

  describe('main', () => {
    const io = () => {
      const out = { stdout: '', stderr: '' };
      return {
        out,
        stdout: { write: (s) => { out.stdout += s; } },
        stderr: { write: (s) => { out.stderr += s; } },
      };
    };
    const txns = [{ id: 1, description: 'Shell', tagNames: ['Fuel'] }];
    const runtime = ({ apiKey = 'k', validTags = TAGS, transactions = txns, evaluate } = {}) => {
      const store = {
        getCategorizationConfig: vi.fn(() => ({ validTags })),
        listBudgetPeriods: vi.fn(() => ['2025-01-01', '2026-01-01']),
        getTransactions: vi.fn(() => transactions),
        saveTransactions: vi.fn(),
        saveMemo: vi.fn(),
        saveCompiledFinances: vi.fn(),
      };
      const gateway = { isConfigured: () => true, evaluate: evaluate ?? vi.fn(async () => ({ model: 'jev-test-1', answers: { category: { choice: 'Fuel', confidence: 0.9 } } })) };
      return {
        store,
        gateway,
        loadRuntime: vi.fn(async () => ({
          configService: { getSystemAuth: () => apiKey, getDefaultHouseholdId: () => 'default' },
          store,
          createDecisionGateway: vi.fn(() => gateway),
        })),
      };
    };

    it('usage errors exit 2 without loading config', async () => {
      const { out, ...streams } = io();
      const rt = runtime();
      expect(await main(['--limit', '0'], { ...streams, loadRuntime: rt.loadRuntime })).toBe(2);
      expect(rt.loadRuntime).not.toHaveBeenCalled();
      expect(JSON.parse(out.stderr).error).toMatch(/--limit/);
    });

    it('--help prints usage and exits 0 without loading config', async () => {
      const { out, ...streams } = io();
      const rt = runtime();
      expect(await main(['--help'], { ...streams, loadRuntime: rt.loadRuntime })).toBe(0);
      expect(rt.loadRuntime).not.toHaveBeenCalled();
      expect(out.stdout).toMatch(/Usage:/);
    });

    it('no Jev key exits 3 with a clear message and judges nothing', async () => {
      const { out, ...streams } = io();
      const rt = runtime({ apiKey: null });
      expect(await main([], { ...streams, loadRuntime: rt.loadRuntime })).toBe(3);
      expect(JSON.parse(out.stderr).error).toMatch(/No Jev key/);
      expect(out.stdout).toBe('');
      expect(rt.store.getTransactions).not.toHaveBeenCalled();
    });

    it('missing validTags exits 3', async () => {
      const { out, ...streams } = io();
      expect(await main([], { ...streams, loadRuntime: runtime({ validTags: [] }).loadRuntime })).toBe(3);
      expect(JSON.parse(out.stderr).error).toMatch(/validTags/);
    });

    it('when every judgement fails it exits 4 instead of reporting zeros', async () => {
      const { out, ...streams } = io();
      const rt = runtime({ evaluate: vi.fn(async () => { throw new Error('401 Unauthorized'); }) });
      expect(await main([], { ...streams, loadRuntime: rt.loadRuntime })).toBe(4);
      const error = JSON.parse(out.stderr);
      expect(error.error).toMatch(/No transaction was judged/);
      expect(error.judgeErrors).toEqual({ '401 Unauthorized': 1 });
      expect(out.stdout).toBe('');
    });

    it('prints the summary for the latest period and writes nothing', async () => {
      const { out, ...streams } = io();
      const rt = runtime();
      expect(await main(['--limit', '10'], { ...streams, loadRuntime: rt.loadRuntime })).toBe(0);
      const summary = JSON.parse(out.stdout);
      expect(summary).toMatchObject({ householdId: 'default', period: '2026-01-01', floor: 0.8, total: 1, judged: 1, agreement: 1 });
      expect(rt.store.getTransactions).toHaveBeenCalledWith('2026-01-01', 'default');
      expect(rt.store.saveTransactions).not.toHaveBeenCalled();
      expect(rt.store.saveMemo).not.toHaveBeenCalled();
      expect(rt.store.saveCompiledFinances).not.toHaveBeenCalled();
      expect(rt.gateway.evaluate).toHaveBeenCalledTimes(1);
    });
  });
});
