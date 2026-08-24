import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import RecordsTab from './RecordsTab.jsx';

vi.mock('../teacherWorkspaceApi.js', () => ({ teacherWorkspaceApi: {
  authStatus: vi.fn(async () => {
    const userId = sessionStorage.getItem('school-teacher-claim');
    return { ok: true, status: 200, data: userId ? { active: true, userId } : { active: false } };
  }),
  unlock: vi.fn(async (userId) => ({ ok: true, status: 200, data: { active: true, userId } })),
  lock: vi.fn(async () => ({ ok: true, status: 200, data: { locked: true } })),
  stepUp: vi.fn(async () => ({ ok: true, status: 200, data: { grantToken: 'grant' } })),
} }));

vi.mock('../../schoolApi.js', () => ({
  schoolApi: {
    teachers: vi.fn(),
    periods: vi.fn(),
    reportCard: vi.fn(),
    reportCardFrozen: vi.fn(),
    progress: vi.fn(),
    instructionalInsights: vi.fn(),
    progressReport: vi.fn(),
    closePeriod: vi.fn(),
    materials: vi.fn(),
  },
}));
const { schoolApi } = await import('../../schoolApi.js');
const { teacherWorkspaceApi } = await import('../teacherWorkspaceApi.js');
const { TeacherProfileProvider } = await import('../TeacherProfileContext.jsx');
const PinPrompt = (await import('../panels/PinPrompt.jsx')).default;

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
    materials: [{ materialId: 'plex:384855', label: 'plex:384855', unitsDone: 3, unitTotal: 24 }],
    evidence: null,
    activeDays: { bySubject: [{ subjectId: 'math', days: 3 }], total: 3 },
    concepts: { mastered: [{ conceptId: 'fractions', label: 'Fractions' }], developing: [] },
    pendingReview: 1,
    remediationArcs: [{ unitId: 'math-fractions.02', originalSessionId: 'ses_a', remediationSessionId: 'ses_b', result: 'passed' }],
  }));
  schoolApi.reportCardFrozen.mockResolvedValue(ok([
    { periodId: '2026-spring', closedBy: 'kckern', closedAt: '2026-06-13T00:00:00Z' },
  ]));
  schoolApi.progress.mockResolvedValue(ok({ curriculumHistory: { roots: [], unscoped: { evidenceCount: 0 } } }));
  schoolApi.instructionalInsights.mockResolvedValue(ok(null));
  sessionStorage.clear();
  sessionStorage.setItem('school-teacher-claim', 'kckern');
  schoolApi.teachers.mockResolvedValue(ok({ configured: true, teachers: [{ id: 'kckern', name: 'KC' }] }));
  schoolApi.progressReport.mockResolvedValue(ok({
    schema: 'school.progress-report/v1', learnerId: 'felix',
    period: { periodId: '2026-fall', label: 'Fall 2026' },
    courses: [], activeDays: { bySubject: [{ subjectId: 'math', days: 3 }], total: 3 },
    milestones: [{ id: 'm1', unitId: 'math-fractions.02', dueBy: '2026-08-01', status: 'behind', overdueDays: 4, excusedDays: 4, effectiveStatus: 'excused' }],
    enrichment: { entries: [{ id: 'e1', title: 'Yellowstone trip', from: '2026-08-02', to: '2026-08-06' }] },
  }));
  schoolApi.closePeriod.mockResolvedValue(ok({ closedBy: 'kckern', closedAt: '2026-08-06T12:00:00Z' }));
  schoolApi.materials.mockResolvedValue(ok({ materials: [{ id: 'plex:384855', label: 'I Survived (audio)' }] }));
});

const mount = (ui) => render(<TeacherProfileProvider>{ui}<PinPrompt /></TeacherProfileProvider>);

describe('RecordsTab', () => {
  it('defaults the period selector to the current period and renders the DRAFT card', async () => {
    mount(<RecordsTab learnerId="felix" kids={KIDS} />);
    await vi.waitFor(() => expect(schoolApi.reportCard).toHaveBeenCalledWith({ learnerId: 'felix', periodId: '2026-fall' }));
    await vi.waitFor(() => expect(screen.getByText('DRAFT')).toBeTruthy());
    expect(screen.getAllByText(/math-fractions/).length).toBeGreaterThan(0);
    expect(screen.getByText(/88%/)).toBeTruthy();
    expect(screen.getByText(/best-of-unit-mean-v1/)).toBeTruthy();
    // Spec 4.2: materials progress and remediation arcs are part of the card.
    expect(screen.getByText(/3 \/ 24 units/)).toBeTruthy();
    expect(screen.getByText(/remediation passed/)).toBeTruthy();
  });

  it('a failed periods read surfaces a named error with retry, never a silently missing selector', async () => {
    schoolApi.periods.mockResolvedValue({ ok: false, status: 500, data: null });
    mount(<RecordsTab learnerId="felix" kids={KIDS} />);
    await vi.waitFor(() => expect(screen.getByText(/Couldn.t load the academic periods/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('tapping a frozen row expands the frozen record', async () => {
    const { fireEvent, act } = await import('@testing-library/react');
    schoolApi.reportCardFrozen.mockImplementation(({ periodId }) => (periodId
      ? Promise.resolve(ok({ courses: [{ courseId: 'math-fractions', coursePercent: 91 }], activeDays: { bySubject: [], total: 40 }, pendingReview: 0 }))
      : Promise.resolve(ok([{ periodId: '2026-spring', closedBy: 'kckern', closedAt: '2026-06-13T00:00:00Z' }]))));
    mount(<RecordsTab learnerId="felix" kids={KIDS} />);
    await vi.waitFor(() => expect(screen.getByText(/Closed by kckern/)).toBeTruthy());
    act(() => { fireEvent.click(screen.getByText(/Closed by kckern/)); });
    await vi.waitFor(() => expect(screen.getByText('FROZEN')).toBeTruthy());
    expect(screen.getByText(/91%/)).toBeTruthy();
    expect(schoolApi.reportCardFrozen).toHaveBeenCalledWith({ learnerId: 'felix', periodId: '2026-spring' });
  });

  it('a null report card is UNAVAILABLE, never a quiet empty (unwired tell)', async () => {
    schoolApi.reportCard.mockResolvedValue(ok(null));
    mount(<RecordsTab learnerId="felix" kids={KIDS} />);
    await vi.waitFor(() => expect(screen.getByText(/report card isn.t available on this install/i)).toBeTruthy());
  });

  it('lists frozen closes with who and when', async () => {
    mount(<RecordsTab learnerId="felix" kids={KIDS} />);
    await vi.waitFor(() => expect(screen.getByText(/Closed by kckern/)).toBeTruthy());
  });

  it('links the report-card PDF for the selected period', async () => {
    mount(<RecordsTab learnerId="felix" kids={KIDS} />);
    await vi.waitFor(() => expect(screen.getByRole('link', { name: 'PDF · Report card' })).toBeTruthy());
    expect(screen.getByRole('link', { name: 'PDF · Report card' }).getAttribute('href'))
      .toBe('/api/v1/school/report-card?learnerId=felix&periodId=2026-fall&format=pdf');
  });

  it('no learner selected prompts instead of fetching', async () => {
    mount(<RecordsTab learnerId={null} kids={KIDS} />);
    await vi.waitFor(() => expect(screen.getByText(/Pick a learner/)).toBeTruthy());
    expect(schoolApi.reportCard).not.toHaveBeenCalled();
  });

  it('carries no stubs — every records use case is live', async () => {
    mount(<RecordsTab learnerId="felix" kids={KIDS} />);
    await vi.waitFor(() => expect(screen.getByText('DRAFT')).toBeTruthy());
    expect(document.querySelectorAll('[data-todo]').length).toBe(0);
  });

  it('pacing shows the excused vocabulary and the enrichment credit', async () => {
    mount(<RecordsTab learnerId="felix" kids={KIDS} />);
    await vi.waitFor(() => expect(screen.getByText(/excused — 4 enrichment days/)).toBeTruthy());
    expect(screen.getByText('Yellowstone trip')).toBeTruthy();
    expect(screen.getByRole('link', { name: /PDF · Progress report/ })).toBeTruthy();
  });

  it('close-period is two-tap and posts the stamp + pin; supersede offered when already frozen', async () => {
    const { fireEvent, act } = await import('@testing-library/react');
    // frozen({learnerId, periodId}) -> 404 (not closed); frozen({learnerId}) -> list
    schoolApi.reportCardFrozen.mockImplementation(({ periodId }) => (periodId
      ? Promise.resolve({ ok: false, status: 404, data: null })
      : Promise.resolve(ok([]))));
    mount(<RecordsTab learnerId="felix" kids={KIDS} />);
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Close this period' })).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Close this period' })); });
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); });
    await vi.waitFor(() => expect(schoolApi.closePeriod).toHaveBeenCalledWith(
      { learnerId: 'felix', periodId: '2026-fall', closedBy: 'kckern', pin: null, supersede: false }, null));
  });

  it('an already-frozen period offers supersede instead', async () => {
    schoolApi.reportCardFrozen.mockImplementation(({ periodId }) => (periodId
      ? Promise.resolve(ok({ courses: [], activeDays: { bySubject: [], total: 1 }, pendingReview: 0 }))
      : Promise.resolve(ok([{ periodId: '2026-fall', closedBy: 'kckern', closedAt: 't' }]))));
    mount(<RecordsTab learnerId="felix" kids={KIDS} />);
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /Supersede & re-close/ })).toBeTruthy());
  });

  it('requires a learner-and-period-scoped confirmation before superseding a freeze', async () => {
    const { fireEvent, act } = await import('@testing-library/react');
    schoolApi.reportCardFrozen.mockImplementation(({ periodId }) => (periodId
      ? Promise.resolve(ok({ courses: [], activeDays: { bySubject: [], total: 1 }, pendingReview: 0 }))
      : Promise.resolve(ok([{ periodId: '2026-fall', closedBy: 'kckern', closedAt: 't' }]))));
    mount(<RecordsTab learnerId="felix" kids={KIDS} />);
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /Supersede & re-close/ })).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Supersede & re-close/ })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); });
    await vi.waitFor(() => expect(screen.getByText('Confirm sensitive action')).toBeTruthy());
    act(() => { fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '4321' } }); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })); });
    await vi.waitFor(() => expect(schoolApi.closePeriod).toHaveBeenCalledWith(
      { learnerId: 'felix', periodId: '2026-fall', closedBy: 'kckern', pin: null, supersede: true }, 'grant'));
    expect(teacherWorkspaceApi.stepUp).toHaveBeenCalledWith({
      pin: '4321', action: 'report-card.close', resource: 'felix/2026-fall',
    });
  });

  it('certificate links render only for graded courses', async () => {
    mount(<RecordsTab learnerId="felix" kids={KIDS} />);
    await vi.waitFor(() => expect(screen.getByRole('link', { name: 'Certificate' })).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Certificate' }).getAttribute('href'))
      .toContain('/api/v1/school/certificate?learnerId=felix&periodId=2026-fall&courseId=math-fractions');
  });
});
