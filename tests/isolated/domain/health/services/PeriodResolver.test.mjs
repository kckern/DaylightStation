// tests/isolated/domain/health/services/PeriodResolver.test.mjs
import { describe, it, expect } from 'vitest';
import { PeriodResolver } from '../../../../../backend/src/2_domains/health/services/PeriodResolver.mjs';

// Anchor "today" so date math is deterministic.
const NOW = new Date('2026-05-05T12:00:00Z');
const fixedNow = () => NOW;

describe('PeriodResolver', () => {
  describe('rolling', () => {
    it('resolves last_30d to a 30-day window ending today', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ rolling: 'last_30d' });
      expect(out.from).toBe('2026-04-06');
      expect(out.to).toBe('2026-05-05');
      expect(out.label).toBe('last_30d');
      expect(out.source).toBe('rolling');
    });
  });

  describe('rolling — additional', () => {
    it('resolves last_7d', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ rolling: 'last_7d' });
      expect(out.from).toBe('2026-04-29');
      expect(out.to).toBe('2026-05-05');
    });

    it('resolves last_2y as 730 days', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ rolling: 'last_2y' });
      expect(out.to).toBe('2026-05-05');
      expect(out.from).toBe('2024-05-06');
    });

    it('resolves all_time with from=1900-01-01', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ rolling: 'all_time' });
      expect(out.from).toBe('1900-01-01');
      expect(out.to).toBe('2026-05-05');
      expect(out.label).toBe('all_time');
    });

    it('resolves prev_30d as the 30 days adjacent to last_30d', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ rolling: 'prev_30d' });
      // last_30d is 2026-04-06..2026-05-05; prev_30d is 2026-03-07..2026-04-05
      expect(out.from).toBe('2026-03-07');
      expect(out.to).toBe('2026-04-05');
    });

    it('throws on unknown rolling label', () => {
      const r = new PeriodResolver({ now: fixedNow });
      expect(() => r.resolve({ rolling: 'forever' })).toThrow(/unknown rolling label/);
    });
  });

  describe('calendar', () => {
    it('resolves YYYY', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ calendar: '2024' });
      expect(out.from).toBe('2024-01-01');
      expect(out.to).toBe('2024-12-31');
      expect(out.source).toBe('calendar');
    });

    it('resolves YYYY-MM with correct end-of-month', () => {
      const r = new PeriodResolver({ now: fixedNow });
      expect(r.resolve({ calendar: '2024-02' }).to).toBe('2024-02-29'); // leap year
      expect(r.resolve({ calendar: '2025-02' }).to).toBe('2025-02-28');
      expect(r.resolve({ calendar: '2024-04' }).to).toBe('2024-04-30');
    });

    it('resolves YYYY-Qn', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const q3 = r.resolve({ calendar: '2024-Q3' });
      expect(q3.from).toBe('2024-07-01');
      expect(q3.to).toBe('2024-09-30');
    });

    it('resolves this_year', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ calendar: 'this_year' });
      expect(out.from).toBe('2026-01-01');
      expect(out.to).toBe('2026-12-31');
    });

    it('resolves this_month', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ calendar: 'this_month' });
      expect(out.from).toBe('2026-05-01');
      expect(out.to).toBe('2026-05-31');
    });

    it('resolves this_quarter (today=May = Q2)', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ calendar: 'this_quarter' });
      expect(out.from).toBe('2026-04-01');
      expect(out.to).toBe('2026-06-30');
    });

    it('resolves last_quarter (today=May = Q2; last=Q1)', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ calendar: 'last_quarter' });
      expect(out.from).toBe('2026-01-01');
      expect(out.to).toBe('2026-03-31');
    });

    it('resolves this_week (Mon..Sun)', () => {
      // 2026-05-05 is a Tuesday; week starts 2026-05-04 Mon, ends 2026-05-10 Sun
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ calendar: 'this_week' });
      expect(out.from).toBe('2026-05-04');
      expect(out.to).toBe('2026-05-10');
    });

    it('throws on unknown calendar label', () => {
      const r = new PeriodResolver({ now: fixedNow });
      expect(() => r.resolve({ calendar: 'someday' })).toThrow(/unknown calendar label/);
    });
  });

  describe('explicit', () => {
    it('passes through from/to', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ from: '2024-01-15', to: '2024-02-10' });
      expect(out.from).toBe('2024-01-15');
      expect(out.to).toBe('2024-02-10');
      expect(out.source).toBe('explicit');
      expect(out.label).toBe('2024-01-15..2024-02-10');
    });
  });

  describe('not-yet-supported', () => {
    it('throws on { named: ... } with a Plan-4 hint', () => {
      const r = new PeriodResolver({ now: fixedNow });
      expect(() => r.resolve({ named: '2017 Cut' })).toThrow(/Plan 4/);
    });

    it('throws on { deduced: ... } with a Plan-4 hint', () => {
      const r = new PeriodResolver({ now: fixedNow });
      expect(() => r.resolve({ deduced: { criteria: {} } })).toThrow(/Plan 4/);
    });

    it('throws on null input', () => {
      const r = new PeriodResolver({ now: fixedNow });
      expect(() => r.resolve(null)).toThrow();
    });
  });
});
