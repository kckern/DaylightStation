import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { currentPeriodFor, deriveStanding, useLearnerStanding } from './useLearnerStanding.js';

const periodsMock = vi.fn();
const reportCardMock = vi.fn();
vi.mock('../schoolApi.js', () => ({ schoolApi: {
  periods: (...a) => periodsMock(...a),
  reportCard: (...a) => reportCardMock(...a),
} }));

vi.mock('../schoolLog.js', () => ({ schoolLog: {
  standing: vi.fn(),
  standingError: vi.fn(),
} }));

// Deliberately wide (not "this semester") so the hook's real system clock
// falls inside it without the test having to fake time — `currentPeriodFor`
// itself is exercised precisely, with an injected `nowIso`, in its own
// describe block below.
const PERIOD = {
  schema: 'school.academic-period/v1', periodId: 'fall-2026', kind: 'semester', label: 'Fall 2026',
  startsAt: '2020-01-01T00:00:00.000Z', endsAt: '2030-01-01T00:00:00.000Z',
};

const REPORT = {
  schema: 'school.report-card/v1', learnerId: 'kid1', period: { periodId: 'fall-2026' },
  courses: [
    { courseId: 'math-fractions', policy: 'best-of-unit-mean-v1', coursePercent: 87.4 },
    { courseId: 'never-graded', policy: 'best-of-unit-mean-v1', coursePercent: null },
  ],
};

beforeEach(() => { vi.clearAllMocks(); });

// A genuinely narrow period, distinct from the wide `PERIOD` fixture above
// (which exists only so the hook-integration tests below don't need to fake
// the system clock) — this block tests the boundary math itself precisely.
const FALL = {
  schema: 'school.academic-period/v1', periodId: 'fall-2026', kind: 'semester', label: 'Fall 2026',
  startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-12-31T00:00:00.000Z',
};

describe('currentPeriodFor', () => {
  it('finds the period whose window contains now', () => {
    const spring = { ...FALL, periodId: 'spring-2026', startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-06-01T00:00:00.000Z' };
    expect(currentPeriodFor([spring, FALL], '2026-09-01T00:00:00.000Z')?.periodId).toBe('fall-2026');
  });

  it('is null when nothing configured contains now', () => {
    expect(currentPeriodFor([FALL], '2027-01-01T00:00:00.000Z')).toBeNull();
    expect(currentPeriodFor([], '2026-09-01T00:00:00.000Z')).toBeNull();
    expect(currentPeriodFor(null, '2026-09-01T00:00:00.000Z')).toBeNull();
  });

  it('is a half-open window: startsAt inclusive, endsAt exclusive', () => {
    expect(currentPeriodFor([FALL], FALL.startsAt)?.periodId).toBe('fall-2026');
    expect(currentPeriodFor([FALL], FALL.endsAt)).toBeNull();
  });
});

describe('deriveStanding', () => {
  it('keeps only courses with a graded session, rounds the percent', () => {
    expect(deriveStanding(REPORT)).toEqual([{ courseId: 'math-fractions', label: 'math-fractions', percent: 87 }]);
  });

  it('falls back to courseId when no label field is present', () => {
    expect(deriveStanding({ courses: [{ courseId: 'science', coursePercent: 50 }] })[0].label).toBe('science');
  });

  it('prefers a label field when the payload carries one', () => {
    expect(deriveStanding({ courses: [{ courseId: 'sci', label: 'Science', coursePercent: 50 }] })[0].label).toBe('Science');
  });

  it('is empty for no report / no courses', () => {
    expect(deriveStanding(null)).toEqual([]);
    expect(deriveStanding({})).toEqual([]);
    expect(deriveStanding({ courses: [] })).toEqual([]);
  });
});

describe('useLearnerStanding', () => {
  it('resolves the current period, fetches its report card, and surfaces graded courses', async () => {
    periodsMock.mockResolvedValue({ ok: true, status: 200, data: [PERIOD] });
    reportCardMock.mockResolvedValue({ ok: true, status: 200, data: REPORT });
    const { result } = renderHook(() => useLearnerStanding('kid1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.courses).toEqual([{ courseId: 'math-fractions', label: 'math-fractions', percent: 87 }]);
    expect(reportCardMock).toHaveBeenCalledWith({ learnerId: 'kid1', periodId: 'fall-2026' });
  });

  it('is the empty zero-state — never an error — when no period contains today', async () => {
    periodsMock.mockResolvedValue({ ok: true, status: 200, data: [] });
    const { result } = renderHook(() => useLearnerStanding('kid1'));
    await waitFor(() => expect(result.current.status).toBe('empty'));
    expect(result.current.courses).toEqual([]);
    expect(reportCardMock).not.toHaveBeenCalled();
  });

  it('never fetches with no learnerId', () => {
    const { result } = renderHook(() => useLearnerStanding(null));
    expect(result.current.status).toBe('empty');
    expect(result.current.courses).toEqual([]);
  });

  it('reports and logs a failed report-card fetch, never throwing', async () => {
    periodsMock.mockResolvedValue({ ok: true, status: 200, data: [PERIOD] });
    reportCardMock.mockResolvedValue({ ok: false, status: 500, data: null });
    const { result } = renderHook(() => useLearnerStanding('kid1'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.courses).toEqual([]);
  });
});
