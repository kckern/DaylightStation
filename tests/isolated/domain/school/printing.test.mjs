import { describe, it, expect } from 'vitest';
import { evaluatePrintQuota, DEFAULT_PRINT_POLICY } from '../../../../backend/src/2_domains/school/printing.mjs';

const T0 = Date.UTC(2026, 6, 22, 15, 0, 0); // fixed "now"
const job = (minutesAgo, pages) => ({ at: new Date(T0 - minutesAgo * 60000).toISOString(), pages });

describe('evaluatePrintQuota', () => {
  const policy = { windowMinutes: 60, pagesPerWindow: 5, maxPagesPerJob: 20 };

  it('allows a job that fits under the window budget', () => {
    const r = evaluatePrintQuota({ recentJobs: [job(10, 2)], pages: 2, now: T0, policy });
    expect(r.decision).toBe('allow');
    expect(r.pagesInWindow).toBe(2);
    expect(r.remaining).toBe(3);
  });

  it('needs approval when the job would exceed the window budget', () => {
    const r = evaluatePrintQuota({ recentJobs: [job(10, 4)], pages: 3, now: T0, policy });
    expect(r.decision).toBe('approval');
    expect(r.pagesInWindow).toBe(4);
    expect(r.remaining).toBe(1); // 4 used, budget 5 -> 1 left, but the 3-page job overshoots
  });

  it('only counts jobs inside the rolling window (older jobs fall off)', () => {
    const r = evaluatePrintQuota({ recentJobs: [job(90, 5), job(30, 1)], pages: 3, now: T0, policy });
    expect(r.pagesInWindow).toBe(1); // the 90-min-old 5-pager is outside the 60-min window
    expect(r.decision).toBe('allow');
  });

  it('exactly hitting the budget is allowed (boundary, not over)', () => {
    const r = evaluatePrintQuota({ recentJobs: [job(5, 3)], pages: 2, now: T0, policy });
    expect(r.decision).toBe('allow'); // 3 used + 2 = 5, exactly the budget
    expect(r.remaining).toBe(2); // remaining = budget - used-before-this-job
  });

  it('denies a single job larger than the per-job hard cap, regardless of history', () => {
    const r = evaluatePrintQuota({ recentJobs: [], pages: 25, now: T0, policy });
    expect(r.decision).toBe('deny');
    expect(r.reason).toMatch(/too (large|big|many)/i);
  });

  it('a zero/negative page count is denied (nothing to print)', () => {
    expect(evaluatePrintQuota({ recentJobs: [], pages: 0, now: T0, policy }).decision).toBe('deny');
  });

  it('window boundary is exclusive at exactly windowMinutes ago', () => {
    // a job exactly 60 min ago is on the edge — treated as outside the window
    const r = evaluatePrintQuota({ recentJobs: [job(60, 5)], pages: 1, now: T0, policy });
    expect(r.pagesInWindow).toBe(0);
    expect(r.decision).toBe('allow');
  });

  it('ships a sane default policy', () => {
    expect(DEFAULT_PRINT_POLICY.pagesPerWindow).toBeGreaterThan(0);
    expect(DEFAULT_PRINT_POLICY.windowMinutes).toBeGreaterThan(0);
    expect(DEFAULT_PRINT_POLICY.maxPagesPerJob).toBeGreaterThanOrEqual(DEFAULT_PRINT_POLICY.pagesPerWindow);
  });
});
