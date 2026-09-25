import { describe, expect, it, vi } from 'vitest';
import { HealthAiUsageService } from './HealthAiUsageService.mjs';

// 2026-09-25 10:00 in Los Angeles (17:00Z)
const NOW = Date.parse('2026-09-25T17:00:00Z');
const row = (ts, extra = {}) => ({ ts, attributed: true, app: 'health', feature: null, agentId: null, model: 'gpt-4.1', costUsd: 0.01, status: 'ok', ...extra });

function service(rows, { timezone = 'America/Los_Angeles' } = {}) {
  const reader = { listRows: vi.fn(async () => rows) };
  return { svc: new HealthAiUsageService({ reader, clock: { now: () => NOW }, timezone, logger: { debug() {} } }), reader };
}

describe('HealthAiUsageService', () => {
  it('needs a reader', () => {
    expect(() => new HealthAiUsageService({})).toThrow(/reader/);
  });

  it('totals today, the last seven days and the calendar month in household time', async () => {
    const { svc, reader } = service([
      row('2026-09-25T16:00:00Z', { feature: 'photo-log', costUsd: 0.02 }),       // today
      row('2026-09-25T06:30:00Z', { feature: 'photo-log', costUsd: 0.03 }),       // 23:30 on the 24th in LA
      row('2026-09-19T18:00:00Z', { feature: 'text-log', costUsd: 0.04 }),        // 7th day back
      row('2026-09-18T18:00:00Z', { feature: 'text-log', costUsd: 0.05 }),        // outside the week
      row('2026-08-31T18:00:00Z', { feature: 'text-log', costUsd: 0.5 }),         // last month
    ]);
    const out = await svc.usage('alice', { days: 30 });
    expect(out.today).toBe(0.02);
    expect(out.week).toBeCloseTo(0.09, 9);
    expect(out.month).toBeCloseTo(0.14, 9);
    expect(out.range).toEqual({ from: '2026-08-27', to: '2026-09-25', days: 30 });
    expect(out.days).toHaveLength(30);
    expect(out.days.at(-1)).toEqual({ date: '2026-09-25', total: 0.02, byFeature: { 'photo-log': 0.02 } });
    expect(out.days.find(d => d.date === '2026-09-24').byFeature).toEqual({ 'photo-log': 0.03 });
    const { from, to } = reader.listRows.mock.calls[0][0];
    expect(Date.parse(from)).toBeLessThanOrEqual(Date.parse('2026-08-27T00:00:00Z'));
    expect(Date.parse(to)).toBeGreaterThan(NOW);
  });

  it('counts only ok rows as calls, prices the average over priced calls, and flags unpriced ones', async () => {
    const { svc } = service([
      row('2026-09-25T16:00:00Z', { feature: 'revision', status: 'error', costUsd: 0 }), // the max_tokens retry
      row('2026-09-25T16:00:01Z', { feature: 'revision', costUsd: 0.004 }),
      row('2026-09-25T16:05:00Z', { feature: 'revision', costUsd: 0.002 }),
      row('2026-09-25T16:06:00Z', { feature: 'voice-log', model: 'whisper-1', costUsd: null }),
    ]);
    const out = await svc.usage(null, { days: 7 });
    expect(out.byFeature).toEqual([
      { feature: 'revision', calls: 2, costUsd: 0.006, avgUsd: 0.003, unpriced: 0 },
      { feature: 'voice-log', calls: 1, costUsd: 0, avgUsd: null, unpriced: 1 },
    ]);
  });

  it('keeps only Health rows, labels a missing feature, and never counts messaging', async () => {
    const { svc } = service([
      row('2026-09-25T16:00:00Z', { feature: null, costUsd: 0.01 }),
      row('2026-09-25T16:00:00Z', { app: 'messaging', feature: null, costUsd: 1 }),
      row('2026-09-25T16:00:00Z', { app: 'journalist', costUsd: 2 }),
      row('2026-09-25T16:00:00Z', { app: null, costUsd: 3 }), // attributed but unscoped: not Health, not "before tracking"
      row('2026-09-25T16:00:00Z', { feature: 'auditor', agentId: 'nutrition-auditor', costUsd: 0.2 }),
    ]);
    const out = await svc.usage(null, { days: 7 });
    expect(out.byFeature.map(f => [f.feature, f.costUsd])).toEqual([['auditor', 0.2], ['unspecified', 0.01]]);
    expect(out.today).toBeCloseTo(0.21, 9);
    expect(out.beforeTracking).toBeNull();
  });

  it('reports pre-attribution rows once, as the household total it cannot split', async () => {
    const { svc } = service([
      row('2026-09-20T16:00:00Z', { attributed: false, app: null, costUsd: 0.7 }),
      row('2026-09-20T16:00:00Z', { attributed: false, app: null, costUsd: 0, status: 'error' }),
      row('2026-08-01T16:00:00Z', { attributed: false, app: null, costUsd: 9 }), // outside the day range
      row('2026-09-25T16:00:00Z', { feature: 'photo-log', costUsd: 0.01 }),
    ]);
    const out = await svc.usage(null, { days: 30 });
    expect(out.beforeTracking).toEqual({ costUsd: 0.7, calls: 1 });
    expect(out.month).toBe(0.01);
    expect(out.days.find(d => d.date === '2026-09-20').total).toBe(0);
  });
});
