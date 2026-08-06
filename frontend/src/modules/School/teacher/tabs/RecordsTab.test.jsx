import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import RecordsTab from './RecordsTab.jsx';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: {
    periods: vi.fn(),
    reportCard: vi.fn(),
    reportCardFrozen: vi.fn(),
    progress: vi.fn(),
    instructionalInsights: vi.fn(),
  },
}));
const { schoolApi } = await import('../../schoolApi.js');

const KIDS = [{ id: 'felix', name: 'Felix' }];
const ok = (data) => ({ ok: true, status: 200, data });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-06T12:00:00Z'));
  vi.clearAllMocks();
  schoolApi.periods.mockResolvedValue(ok([
    { periodId: '2026-spring', kind: 'semester', label: 'Spring 2026', startsAt: '2026-01-05T00:00:00.000Z', endsAt: '2026-06-12T00:00:00.000Z' },
    { periodId: '2026-fall', kind: 'semester', label: 'Fall 2026', startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-12-19T00:00:00.000Z' },
  ]));
  schoolApi.reportCard.mockResolvedValue(ok({
    schema: 'school.report-card/v1',
    learnerId: 'felix',
    period: { periodId: '2026-fall', label: 'Fall 2026' },
    generatedAt: '2026-08-06T12:00:00Z',
    courses: [{ courseId: 'math-fractions', policy: 'best-of-unit-mean-v1', coursePercent: 88, unitGrades: [] }],
    materials: [],
    evidence: null,
    activeDays: 3,
    concepts: { mastered: [{ conceptId: 'fractions', label: 'Fractions' }], developing: [] },
    pendingReview: 1,
    remediationArcs: [],
  }));
  schoolApi.reportCardFrozen.mockResolvedValue(ok([
    { periodId: '2026-spring', closedBy: 'kckern', closedAt: '2026-06-13T00:00:00Z' },
  ]));
  schoolApi.progress.mockResolvedValue(ok({ curriculumHistory: { roots: [], unscoped: { evidenceCount: 0 } } }));
  schoolApi.instructionalInsights.mockResolvedValue(ok(null));
});

describe('RecordsTab', () => {
  it('defaults the period selector to the current period and renders the DRAFT card', async () => {
    render(<RecordsTab learnerId="felix" kids={KIDS} />);
    await vi.waitFor(() => expect(schoolApi.reportCard).toHaveBeenCalledWith({ learnerId: 'felix', periodId: '2026-fall' }));
    await vi.waitFor(() => expect(screen.getByText('DRAFT')).toBeTruthy());
    expect(screen.getByText(/math-fractions/)).toBeTruthy();
    expect(screen.getByText(/88%/)).toBeTruthy();
    expect(screen.getByText(/best-of-unit-mean-v1/)).toBeTruthy();
  });

  it('a null report card is UNAVAILABLE, never a quiet empty (unwired tell)', async () => {
    schoolApi.reportCard.mockResolvedValue(ok(null));
    render(<RecordsTab learnerId="felix" kids={KIDS} />);
    await vi.waitFor(() => expect(screen.getByText(/report card isn.t available on this install/i)).toBeTruthy());
  });

  it('lists frozen closes with who and when', async () => {
    render(<RecordsTab learnerId="felix" kids={KIDS} />);
    await vi.waitFor(() => expect(screen.getByText(/Closed by kckern/)).toBeTruthy());
  });

  it('links the report-card PDF for the selected period', async () => {
    render(<RecordsTab learnerId="felix" kids={KIDS} />);
    await vi.waitFor(() => expect(screen.getByRole('link', { name: /PDF/ })).toBeTruthy());
    expect(screen.getByRole('link', { name: /PDF/ }).getAttribute('href'))
      .toBe('/api/v1/school/report-card?learnerId=felix&periodId=2026-fall&format=pdf');
  });

  it('no learner selected prompts instead of fetching', async () => {
    render(<RecordsTab learnerId={null} kids={KIDS} />);
    await vi.waitFor(() => expect(screen.getByText(/Pick a learner/)).toBeTruthy());
    expect(schoolApi.reportCard).not.toHaveBeenCalled();
  });

  it('carries its four stubs', async () => {
    render(<RecordsTab learnerId="felix" kids={KIDS} />);
    await vi.waitFor(() => expect(document.querySelectorAll('[data-todo]').length).toBe(4));
  });
});
