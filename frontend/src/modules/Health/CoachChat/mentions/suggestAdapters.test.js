// frontend/src/modules/Health/CoachChat/mentions/suggestAdapters.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { suggestPeriods } from './suggestPeriods.js';
import { suggestRecentDays } from './suggestRecentDays.js';
import { suggestMetrics } from './suggestMetrics.js';

describe('suggestion adapters', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('suggestPeriods calls /api/v1/health/mentions/periods with prefix + user', async () => {
    let captured;
    globalThis.fetch = vi.fn(async (url) => {
      captured = url;
      return { ok: true, json: async () => ({ suggestions: [{ slug: 'last_30d', label: 'Last 30 days', value: { rolling: 'last_30d' }, group: 'period' }] }) };
    });
    const out = await suggestPeriods({ prefix: 'last', userId: 'kc' });
    expect(captured).toMatch(/\/api\/v1\/health\/mentions\/periods/);
    expect(captured).toMatch(/prefix=last/);
    expect(captured).toMatch(/user=kc/);
    expect(out).toEqual([{ slug: 'last_30d', label: 'Last 30 days', value: { rolling: 'last_30d' }, group: 'period' }]);
  });

  it('suggestRecentDays passes has filter through', async () => {
    let captured;
    globalThis.fetch = vi.fn(async (url) => {
      captured = url;
      return { ok: true, json: async () => ({ suggestions: [] }) };
    });
    await suggestRecentDays({ userId: 'kc', has: 'workout', days: 14 });
    expect(captured).toMatch(/has=workout/);
    expect(captured).toMatch(/days=14/);
  });

  it('suggestMetrics filters via prefix', async () => {
    let captured;
    globalThis.fetch = vi.fn(async (url) => {
      captured = url;
      return { ok: true, json: async () => ({ suggestions: [] }) };
    });
    await suggestMetrics({ prefix: 'protein' });
    expect(captured).toMatch(/\/api\/v1\/health\/mentions\/metrics/);
    expect(captured).toMatch(/prefix=protein/);
  });

  it('returns empty array on fetch failure (graceful)', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('network'); });
    expect(await suggestPeriods({ prefix: '', userId: 'kc' })).toEqual([]);
  });

  it('returns empty array on non-2xx response', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 }));
    expect(await suggestRecentDays({ userId: 'kc' })).toEqual([]);
  });
});
