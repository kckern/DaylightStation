/**
 * Program-report contract tests.
 *
 * The contract's whole value is that the parent view can render any program
 * without knowing what it does. That only holds if a malformed program is
 * contained rather than propagated — so most of these are about what happens
 * when a program emits something wrong.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  METRIC_KIND_IDS, PROGRAM_STATES, normalizeMetric, normalizeReport,
  compareReports, compareForLearner, metricsFor,
} from './reporting.mjs';

const logger = () => ({ warn: vi.fn(), error: vi.fn() });

describe('the closed metric set', () => {
  it('is exactly the six kinds the renderer has branches for', () => {
    expect(METRIC_KIND_IDS.sort()).toEqual(
      ['count', 'duration', 'progress', 'score', 'streak', 'trend'],
    );
  });
});

describe('normalizeMetric', () => {
  it('accepts a well-formed metric of each kind', () => {
    const cases = [
      { kind: 'progress', value: 10, total: 100 },
      { kind: 'count', value: 7 },
      { kind: 'score', value: 0.74 },
      { kind: 'streak', value: 59 },
      { kind: 'trend', points: [{ at: 'Day 1', value: 0.5 }] },
      { kind: 'duration', ms: 1000 },
    ];
    for (const raw of cases) expect(normalizeMetric(raw)).not.toBeNull();
  });

  it('DROPS an unknown kind and says which program emitted it', () => {
    // Fail closed but loud: a kind with no renderer must never reach one.
    const log = logger();
    expect(normalizeMetric({ kind: 'vibes', value: 1 }, { logger: log, program: 'language' })).toBeNull();
    expect(log.warn).toHaveBeenCalledWith('school.report.metric-kind-unknown',
      expect.objectContaining({ program: 'language', kind: 'vibes' }));
  });

  it('drops a metric missing a required field', () => {
    const log = logger();
    expect(normalizeMetric({ kind: 'progress', value: 10 }, { logger: log })).toBeNull();
    expect(log.warn).toHaveBeenCalledWith('school.report.metric-incomplete', expect.anything());
  });

  it('rejects a score outside 0..1 rather than rendering 7400%', () => {
    expect(normalizeMetric({ kind: 'score', value: 74 })).toBeNull();
    expect(normalizeMetric({ kind: 'score', value: -0.1 })).toBeNull();
  });

  it('rejects progress with a zero total rather than dividing by it', () => {
    expect(normalizeMetric({ kind: 'progress', value: 0, total: 0 })).toBeNull();
  });

  it('drops non-numeric trend points but keeps the usable ones', () => {
    const m = normalizeMetric({
      kind: 'trend',
      points: [{ at: 'a', value: 0.5 }, { at: 'b', value: 'nonsense' }],
    });
    expect(m.points).toHaveLength(1);
  });

  it('defaults the label and id to the kind', () => {
    expect(normalizeMetric({ kind: 'count', value: 3 })).toMatchObject({ id: 'count', label: 'count' });
  });
});

describe('normalizeReport', () => {
  const base = { program: 'language', label: 'Glossika Korean', userId: 'kckern', state: 'active' };

  it('normalizes a full report', () => {
    const out = normalizeReport({
      ...base,
      headline: 'Day 59',
      next: { label: '2 to do', detail: 'repetition' },
      metrics: [{ kind: 'streak', value: 59 }],
    });
    expect(out).toMatchObject({ program: 'language', state: 'active', headline: 'Day 59' });
    expect(out.next).toMatchObject({ label: '2 to do', blocked: false, blockedReason: null });
    expect(out.metrics).toHaveLength(1);
  });

  it('carries an instanceId so the home can OPEN what it recommends', () => {
    // program alone cannot identify the row — a learner may study two
    // languages — so "what is next" would be unactionable without it.
    expect(normalizeReport({ ...base, instanceId: 'glossika-korean' }).instanceId)
      .toBe('glossika-korean');
    expect(normalizeReport(base).instanceId).toBeNull();
  });

  it('rejects a report with no program id', () => {
    expect(normalizeReport({ label: 'x' })).toBeNull();
    expect(normalizeReport(null)).toBeNull();
  });

  it('falls back to not-started for an unknown state', () => {
    expect(normalizeReport({ ...base, state: 'vibing' }).state).toBe('not-started');
    for (const state of PROGRAM_STATES) {
      expect(normalizeReport({ ...base, state }).state).toBe(state);
    }
  });

  it('accepts a report with NO next — not every program assigns work', () => {
    expect(normalizeReport({ ...base, next: null }).next).toBeNull();
  });

  it('accepts a report with no metrics at all', () => {
    expect(normalizeReport(base).metrics).toEqual([]);
  });

  it('never lets a blocked step stay silent about the remedy', () => {
    // A lock that does not say what to do is the trap the materials framework
    // exists to prevent, so it is surfaced AND logged rather than dropped.
    const log = logger();
    const out = normalizeReport(
      { ...base, next: { label: 'Locked', blocked: true } },
      { logger: log },
    );
    expect(out.next.blockedReason).toBeTruthy();
    expect(log.warn).toHaveBeenCalledWith('school.report.blocked-without-reason',
      expect.objectContaining({ program: 'language' }));
  });

  it('keeps the good metrics when one is malformed', () => {
    // One bad metric must not cost the program its whole row.
    const out = normalizeReport({
      ...base,
      metrics: [{ kind: 'nonsense' }, { kind: 'count', value: 4 }],
    }, { logger: logger() });
    expect(out.metrics).toHaveLength(1);
    expect(out.metrics[0].kind).toBe('count');
  });
});

describe('audience filtering', () => {
  const metrics = [
    normalizeMetric({ kind: 'progress', value: 3, total: 12, scope: 'today', audience: 'learner' }),
    normalizeMetric({ kind: 'count', value: 9 }),
    normalizeMetric({ kind: 'score', value: 0.7 }),
    normalizeMetric({ kind: 'streak', value: 40 }),
  ];

  it('keeps score and streak away from a child', () => {
    // A percentage beside a sibling's on a hallway panel is a public ranking;
    // a streak on a shared device breaks for reasons the child cannot control.
    const kinds = metricsFor(metrics, 'learner').map((m) => m.kind);
    expect(kinds).toContain('progress');
    expect(kinds).toContain('count');
    expect(kinds).not.toContain('score');
    expect(kinds).not.toContain('streak');
  });

  it('shows a parent EVERYTHING, including the child-safe metrics', () => {
    expect(metricsFor(metrics, 'parent')).toHaveLength(4);
  });

  it('treats whole-corpus progress as parent instrumentation', () => {
    // A bar at 3% that will not move for a year tells a child they are nowhere.
    const total = normalizeMetric({ kind: 'progress', value: 130, total: 4143, scope: 'total' });
    expect(total.audience).toBe('parent');
    const today = normalizeMetric({ kind: 'progress', value: 3, total: 12, scope: 'today' });
    expect(today.audience).toBe('both');
  });

  it('defaults score, streak, trend and duration to parent-only', () => {
    for (const kind of ['score', 'streak', 'trend', 'duration']) {
      const m = normalizeMetric({ kind, value: 0.5, ms: 1, points: [{ at: 'a', value: 1 }] });
      expect(m.audience).toBe('parent');
    }
  });
});

describe('the learner ordering', () => {
  const r = (state) => ({ state, lastActivity: null });

  it('leads with what a child can DO, not with what is stuck', () => {
    // The parent board leads with blocked because triage is the job. Greeting
    // a seven-year-old with a wall they cannot pass teaches avoidance.
    const sorted = [r('blocked'), r('satisfied'), r('active')].sort(compareForLearner);
    expect(sorted.map((x) => x.state)).toEqual(['active', 'blocked', 'satisfied']);
  });

  it('still ranks blocked ahead of finished work — it is visible, just not first', () => {
    const sorted = [r('complete'), r('blocked')].sort(compareForLearner);
    expect(sorted[0].state).toBe('blocked');
  });
});

describe('done for today', () => {
  it('is its own state, not idle', () => {
    // A child who did everything asked must not read "Paused".
    expect(PROGRAM_STATES).toContain('satisfied');
    expect(normalizeReport({ program: 'p', state: 'satisfied' }).state).toBe('satisfied');
  });
});

describe('effort estimate', () => {
  it('carries a structured count so a young reader need not parse prose', () => {
    const out = normalizeReport({
      program: 'p',
      next: { label: 'Continue', estimate: { count: 12, unit: 'sentences' } },
    });
    expect(out.next.estimate).toEqual({ count: 12, unit: 'sentences' });
  });

  it('omits a malformed estimate rather than showing NaN', () => {
    const out = normalizeReport({ program: 'p', next: { label: 'x', estimate: { unit: 'y' } } });
    expect(out.next.estimate).toBeNull();
  });
});

describe('compareReports', () => {
  const r = (state, lastActivity = null) => ({ state, lastActivity });

  it('surfaces blocked first so the board answers "who needs attention"', () => {
    const sorted = [r('complete'), r('active'), r('blocked'), r('idle')].sort(compareReports);
    expect(sorted.map((x) => x.state)).toEqual(['blocked', 'active', 'idle', 'complete']);
  });

  it('orders most recently touched first within a state', () => {
    const sorted = [r('active', '2020-01-01'), r('active', '2026-01-01')].sort(compareReports);
    expect(sorted[0].lastActivity).toBe('2026-01-01');
  });
});
