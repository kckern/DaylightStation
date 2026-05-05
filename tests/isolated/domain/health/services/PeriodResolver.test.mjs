// tests/isolated/domain/health/services/PeriodResolver.test.mjs
import { describe, it, expect } from 'vitest';
import { PeriodResolver } from '../../../../../backend/src/2_domains/health/services/PeriodResolver.mjs';

// Anchor "today" so date math is deterministic.
const NOW = new Date('2026-05-05T12:00:00Z');
const fixedNow = () => NOW;

describe('PeriodResolver', () => {
  describe('rolling', () => {
    it('resolves last_30d to a 30-day window ending today', async () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = await r.resolve({ rolling: 'last_30d' });
      expect(out.from).toBe('2026-04-06');
      expect(out.to).toBe('2026-05-05');
      expect(out.label).toBe('last_30d');
      expect(out.source).toBe('rolling');
    });
  });

  describe('rolling — additional', () => {
    it('resolves last_7d', async () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = await r.resolve({ rolling: 'last_7d' });
      expect(out.from).toBe('2026-04-29');
      expect(out.to).toBe('2026-05-05');
    });

    it('resolves last_2y as 730 days', async () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = await r.resolve({ rolling: 'last_2y' });
      expect(out.to).toBe('2026-05-05');
      expect(out.from).toBe('2024-05-06');
    });

    it('resolves all_time with from=1900-01-01', async () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = await r.resolve({ rolling: 'all_time' });
      expect(out.from).toBe('1900-01-01');
      expect(out.to).toBe('2026-05-05');
      expect(out.label).toBe('all_time');
    });

    it('resolves prev_30d as the 30 days adjacent to last_30d', async () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = await r.resolve({ rolling: 'prev_30d' });
      // last_30d is 2026-04-06..2026-05-05; prev_30d is 2026-03-07..2026-04-05
      expect(out.from).toBe('2026-03-07');
      expect(out.to).toBe('2026-04-05');
    });

    it('throws on unknown rolling label', async () => {
      const r = new PeriodResolver({ now: fixedNow });
      await expect(r.resolve({ rolling: 'forever' })).rejects.toThrow(/unknown rolling label/);
    });
  });

  describe('calendar', () => {
    it('resolves YYYY', async () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = await r.resolve({ calendar: '2024' });
      expect(out.from).toBe('2024-01-01');
      expect(out.to).toBe('2024-12-31');
      expect(out.source).toBe('calendar');
    });

    it('resolves YYYY-MM with correct end-of-month', async () => {
      const r = new PeriodResolver({ now: fixedNow });
      expect((await r.resolve({ calendar: '2024-02' })).to).toBe('2024-02-29'); // leap year
      expect((await r.resolve({ calendar: '2025-02' })).to).toBe('2025-02-28');
      expect((await r.resolve({ calendar: '2024-04' })).to).toBe('2024-04-30');
    });

    it('resolves YYYY-Qn', async () => {
      const r = new PeriodResolver({ now: fixedNow });
      const q3 = await r.resolve({ calendar: '2024-Q3' });
      expect(q3.from).toBe('2024-07-01');
      expect(q3.to).toBe('2024-09-30');
    });

    it('resolves this_year', async () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = await r.resolve({ calendar: 'this_year' });
      expect(out.from).toBe('2026-01-01');
      expect(out.to).toBe('2026-12-31');
    });

    it('resolves this_month', async () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = await r.resolve({ calendar: 'this_month' });
      expect(out.from).toBe('2026-05-01');
      expect(out.to).toBe('2026-05-31');
    });

    it('resolves this_quarter (today=May = Q2)', async () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = await r.resolve({ calendar: 'this_quarter' });
      expect(out.from).toBe('2026-04-01');
      expect(out.to).toBe('2026-06-30');
    });

    it('resolves last_quarter (today=May = Q2; last=Q1)', async () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = await r.resolve({ calendar: 'last_quarter' });
      expect(out.from).toBe('2026-01-01');
      expect(out.to).toBe('2026-03-31');
    });

    it('resolves this_week (Mon..Sun)', async () => {
      // 2026-05-05 is a Tuesday; week starts 2026-05-04 Mon, ends 2026-05-10 Sun
      const r = new PeriodResolver({ now: fixedNow });
      const out = await r.resolve({ calendar: 'this_week' });
      expect(out.from).toBe('2026-05-04');
      expect(out.to).toBe('2026-05-10');
    });

    it('throws on unknown calendar label', async () => {
      const r = new PeriodResolver({ now: fixedNow });
      await expect(r.resolve({ calendar: 'someday' })).rejects.toThrow(/unknown calendar label/);
    });
  });

  describe('explicit', () => {
    it('passes through from/to', async () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = await r.resolve({ from: '2024-01-15', to: '2024-02-10' });
      expect(out.from).toBe('2024-01-15');
      expect(out.to).toBe('2024-02-10');
      expect(out.source).toBe('explicit');
      expect(out.label).toBe('2024-01-15..2024-02-10');
    });
  });

  describe('not-yet-supported', () => {
    it('throws on { named: ... } when no deps wired', async () => {
      const r = new PeriodResolver({ now: fixedNow });
      await expect(r.resolve({ named: '2017 Cut' })).rejects.toThrow(/named period lookup requires/);
    });

    it('throws on { deduced: ... }', async () => {
      const r = new PeriodResolver({ now: fixedNow });
      await expect(r.resolve({ deduced: { criteria: {} } })).rejects.toThrow(/deduced period/i);
    });

    it('throws on null input', async () => {
      const r = new PeriodResolver({ now: fixedNow });
      await expect(r.resolve(null)).rejects.toThrow();
    });
  });
});

// Helper: build a WorkingMemoryState-like object whose getAll() returns the
// fixture entries. The PeriodResolver should call .getAll() on the loaded
// state to enumerate keys.
function makeWorkingMemoryStateFixture(entries) {
  return {
    getAll: () => ({ ...entries }),
  };
}

describe('PeriodResolver — named periods (Plan 4)', () => {
  function makeResolver({ playbook = null, working = null } = {}) {
    const playbookLoader = playbook ? { loadPlaybook: async () => playbook } : null;
    const workingMemoryAdapter = working ? {
      load: async () => working,
    } : null;
    return new PeriodResolver({
      now: fixedNow,
      playbookLoader,
      workingMemoryAdapter,
    });
  }

  it('resolves named period from playbook.named_periods', async () => {
    const r = makeResolver({
      playbook: { named_periods: { '2017-cut': { from: '2017-01-15', to: '2017-04-30' } } },
    });
    const out = await r.resolve({ named: '2017-cut' }, { userId: 'kc' });
    expect(out.from).toBe('2017-01-15');
    expect(out.to).toBe('2017-04-30');
    expect(out.label).toBe('2017-cut');
    expect(out.source).toBe('named');
    expect(out.subSource).toBe('declared');
  });

  it('resolves named period from working memory remembered', async () => {
    const wm = makeWorkingMemoryStateFixture({
      'period.remembered.stable-195': {
        from: '2024-08-01', to: '2024-11-15',
        label: 'Stable 195', description: 'Maintenance window',
      },
    });
    const r = makeResolver({ working: wm });
    const out = await r.resolve({ named: 'stable-195' }, { userId: 'kc' });
    expect(out.from).toBe('2024-08-01');
    expect(out.to).toBe('2024-11-15');
    expect(out.subSource).toBe('remembered');
  });

  it('prefers remembered over declared on slug collision', async () => {
    const wm = makeWorkingMemoryStateFixture({
      'period.remembered.cut': { from: '2024-01-01', to: '2024-03-31', label: 'Recent cut' },
    });
    const r = makeResolver({
      playbook: { named_periods: { 'cut': { from: '2017-01-15', to: '2017-04-30' } } },
      working: wm,
    });
    const out = await r.resolve({ named: 'cut' }, { userId: 'kc' });
    expect(out.from).toBe('2024-01-01');
    expect(out.subSource).toBe('remembered');
  });

  it('throws when slug not found in any source', async () => {
    const r = makeResolver({ playbook: { named_periods: {} } });
    await expect(r.resolve({ named: 'unknown-slug' }, { userId: 'kc' })).rejects.toThrow(/named period not found/);
  });

  it('throws when no playbook/workingMemory deps wired', async () => {
    const r = new PeriodResolver({ now: fixedNow });  // no deps
    await expect(r.resolve({ named: 'anything' }, { userId: 'kc' })).rejects.toThrow(/named period lookup requires/);
  });

  it('still throws on { deduced: ... } with explicit Plan-4 hint', async () => {
    const r = makeResolver();
    await expect(r.resolve({ deduced: { criteria: {} } }, { userId: 'kc' }))
      .rejects.toThrow(/deduced period.*deduce_period/i);
  });
});
