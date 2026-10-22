import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import RecordsTab from "./RecordsTab.jsx";

vi.mock("../teacherWorkspaceApi.js", () => ({ teacherWorkspaceApi: {
  authStatus: vi.fn(async () => {
    const userId = sessionStorage.getItem('school-teacher-claim');
    return { ok: true, status: 200, data: userId ? { active: true, userId } : { active: false } };
  }),
  unlock: vi.fn(async (userId) => ({ ok: true, status: 200, data: { active: true, userId } })),
  lock: vi.fn(async () => ({ ok: true, status: 200, data: { locked: true } })),
  stepUp: vi.fn(async () => ({ ok: true, status: 200, data: { grantToken: 'grant' } })),
} }));

vi.mock("../../schoolApi.js", () => ({
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
    curriculumUnits: vi.fn(),
  },
}));
const { schoolApi } = await import("../../schoolApi.js");
const { teacherWorkspaceApi } = await import("../teacherWorkspaceApi.js");
const { TeacherProfileProvider } = await import("../TeacherProfileContext.jsx");
const PinPrompt = (await import("../panels/PinPrompt.jsx")).default;

const KIDS = [{ id: 'user_4', name: 'User_4' }];
const ok = (data) => ({ ok: true, status: 200, data });

beforeEach(() => {
  vi.setSystemTime(new Date('2026-08-06T12:00:00Z'));
  vi.clearAllMocks();
  schoolApi.periods.mockResolvedValue(ok([
    { periodId: '2026-spring', kind: 'semester', label: 'Spring 2026', startsAt: '2026-01-05T00:00:00.000Z', endsAt: '2026-06-12T00:00:00.000Z' },
    { periodId: '2026-fall', kind: 'semester', label: 'Fall 2026', startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-12-19T00:00:00.000Z' },
  ]));
  schoolApi.reportCard.mockResolvedValue(ok({
    schema: 'school.report-card/v1',
    learnerId: 'user_4',
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
    { periodId: '2026-spring', closedBy: 'teacher-a', closedAt: '2026-06-13T00:00:00Z' },
  ]));
  schoolApi.progress.mockResolvedValue(ok({ curriculumHistory: { roots: [], unscoped: { evidenceCount: 0 } } }));
  schoolApi.instructionalInsights.mockResolvedValue(ok(null));
  sessionStorage.clear();
  sessionStorage.setItem('school-teacher-claim', 'teacher-a');
  schoolApi.teachers.mockResolvedValue(ok({ configured: true, teachers: [{ id: 'teacher-a', name: 'Teacher A' }] }));
  schoolApi.progressReport.mockResolvedValue(ok({
    schema: 'school.progress-report/v1', learnerId: 'user_4',
    period: { periodId: '2026-fall', label: 'Fall 2026' },
    courses: [], activeDays: { bySubject: [{ subjectId: 'math', days: 3 }], total: 3 },
    milestones: [{ id: 'm1', unitId: 'math-fractions.02', dueBy: '2026-08-01', status: 'behind', overdueDays: 4, excusedDays: 4, effectiveStatus: 'excused' }],
    enrichment: { entries: [{ id: 'e1', title: 'Yellowstone trip', from: '2026-08-02', to: '2026-08-06' }] },
  }));
  schoolApi.closePeriod.mockResolvedValue(ok({ closedBy: 'teacher-a', closedAt: '2026-08-06T12:00:00Z' }));
  schoolApi.materials.mockResolvedValue(ok({ materials: [{ id: 'plex:384855', label: 'I Survived (audio)' }] }));
  schoolApi.curriculumUnits.mockResolvedValue(ok({ units: [
    { unitId: 'math-fractions.02', title: 'Adding Fractions', subject: 'math', courseId: 'math-fractions', courseTitle: 'Fractions' },
  ] }));
});

afterEach(() => {
  cleanup();
});

const mount = (ui) => render(<TeacherProfileProvider>{ui}<PinPrompt /></TeacherProfileProvider>);

describe('RecordsTab', () => {
  it('defaults the period selector to the current period and renders the DRAFT card', async () => {
    mount(<RecordsTab learnerId="user_4" kids={KIDS} />);
    await waitFor(() => expect(schoolApi.reportCard).toHaveBeenCalledWith({ learnerId: 'user_4', periodId: '2026-fall' }));
    await waitFor(() => expect(screen.getByText('DRAFT')).toBeTruthy());
    expect(screen.getAllByText('Fractions').length).toBeGreaterThan(0);
    expect(screen.getByText(/88%/)).toBeTruthy();
    expect(screen.getByText(/best-of-unit-mean-v1/)).toBeTruthy();
    // Spec 4.2: materials progress and remediation arcs are part of the card.
    expect(screen.getByText(/3 \/ 24 units/)).toBeTruthy();
    expect(screen.getByText(/remediation passed/)).toBeTruthy();
  });

  it('a failed periods read surfaces a named error with retry, never a silently missing selector', async () => {
    schoolApi.periods.mockResolvedValue({ ok: false, status: 500, data: null });
    mount(<RecordsTab learnerId="user_4" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Couldn.t load the academic periods/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('tapping a frozen row expands the frozen record', async () => {
    const { fireEvent, act } = await import('@testing-library/react');
    schoolApi.reportCardFrozen.mockImplementation(({ periodId }) => (periodId
      ? Promise.resolve(ok({ courses: [{ courseId: 'math-fractions', coursePercent: 91 }], activeDays: { bySubject: [], total: 40 }, pendingReview: 0 }))
      : Promise.resolve(ok([{ periodId: '2026-spring', closedBy: 'teacher-a', closedAt: '2026-06-13T00:00:00Z' }]))));
    mount(<RecordsTab learnerId="user_4" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Closed by Teacher A/)).toBeTruthy());
    act(() => { fireEvent.click(screen.getByText(/Closed by Teacher A/)); });
    await waitFor(() => expect(screen.getByText('FROZEN')).toBeTruthy());
    expect(screen.getByText(/91%/)).toBeTruthy();
    expect(schoolApi.reportCardFrozen).toHaveBeenCalledWith({ learnerId: 'user_4', periodId: '2026-spring' });
  });

  it('a null report card is UNAVAILABLE, never a quiet empty (unwired tell)', async () => {
    schoolApi.reportCard.mockResolvedValue(ok(null));
    mount(<RecordsTab learnerId="user_4" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/report card isn.t available on this install/i)).toBeTruthy());
  });

  it('lists frozen closes with who and when', async () => {
    mount(<RecordsTab learnerId="user_4" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Closed by Teacher A/)).toBeTruthy());
  });

  it('links the report-card PDF for the selected period', async () => {
    mount(<RecordsTab learnerId="user_4" kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'PDF · Report card' })).toBeTruthy());
    expect(screen.getByRole('link', { name: 'PDF · Report card' }).getAttribute('href'))
      .toBe('/api/v1/school/report-card?learnerId=user_4&periodId=2026-fall&format=pdf');
  });

  it('no learner selected prompts instead of fetching', async () => {
    mount(<RecordsTab learnerId={null} kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Pick a learner/)).toBeTruthy());
    expect(schoolApi.reportCard).not.toHaveBeenCalled();
  });

  it('carries no stubs — every records use case is live', async () => {
    mount(<RecordsTab learnerId="user_4" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText('DRAFT')).toBeTruthy());
    expect(document.querySelectorAll('[data-todo]').length).toBe(0);
  });

  it('pacing shows the excused vocabulary and the enrichment credit', async () => {
    mount(<RecordsTab learnerId="user_4" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/excused — 4 enrichment days/)).toBeTruthy());
    expect(screen.getByText('Yellowstone trip')).toBeTruthy();
    expect(screen.getByRole('link', { name: /PDF · Progress report/ })).toBeTruthy();
  });

  it('renders the close button inside the period-admin section, below the report card', async () => {
    schoolApi.reportCardFrozen.mockImplementation(({ periodId }) => (periodId
      ? Promise.resolve({ ok: false, status: 404, data: null })
      : Promise.resolve(ok([]))));
    const { container } = mount(<RecordsTab learnerId="user_4" kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close this period' })).toBeTruthy());
    const admin = container.querySelector('.teacher-period-admin');
    expect(admin).toBeTruthy();
    expect(admin.querySelector('.teacher-close-period')).toBeTruthy();
  });

  it('close-period is two-tap and posts the stamp + pin; supersede offered when already frozen', async () => {
    const { fireEvent, act } = await import('@testing-library/react');
    // frozen({learnerId, periodId}) -> 404 (not closed); frozen({learnerId}) -> list
    schoolApi.reportCardFrozen.mockImplementation(({ periodId }) => (periodId
      ? Promise.resolve({ ok: false, status: 404, data: null })
      : Promise.resolve(ok([]))));
    mount(<RecordsTab learnerId="user_4" kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close this period' })).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Close this period' })); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); });
    await waitFor(() => expect(schoolApi.closePeriod).toHaveBeenCalledWith(
      { learnerId: 'user_4', periodId: '2026-fall', closedBy: 'teacher-a', pin: null, supersede: false }, null));
  });

  it('an already-frozen period offers supersede instead', async () => {
    schoolApi.reportCardFrozen.mockImplementation(({ periodId }) => (periodId
      ? Promise.resolve(ok({ courses: [], activeDays: { bySubject: [], total: 1 }, pendingReview: 0 }))
      : Promise.resolve(ok([{ periodId: '2026-fall', closedBy: 'teacher-a', closedAt: 't' }]))));
    mount(<RecordsTab learnerId="user_4" kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Supersede & re-close/ })).toBeTruthy());
  });

  it('requires a learner-and-period-scoped confirmation before superseding a freeze', async () => {
    const { fireEvent, act } = await import('@testing-library/react');
    schoolApi.reportCardFrozen.mockImplementation(({ periodId }) => (periodId
      ? Promise.resolve(ok({ courses: [], activeDays: { bySubject: [], total: 1 }, pendingReview: 0 }))
      : Promise.resolve(ok([{ periodId: '2026-fall', closedBy: 'teacher-a', closedAt: 't' }]))));
    mount(<RecordsTab learnerId="user_4" kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Supersede & re-close/ })).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Supersede & re-close/ })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); });
    await waitFor(() => expect(screen.getByText('Confirm sensitive action')).toBeTruthy());
    act(() => { fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '4321' } }); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })); });
    await waitFor(() => expect(schoolApi.closePeriod).toHaveBeenCalledWith(
      { learnerId: 'user_4', periodId: '2026-fall', closedBy: 'teacher-a', pin: null, supersede: true }, 'grant'));
    expect(teacherWorkspaceApi.stepUp).toHaveBeenCalledWith({
      pin: '4321', action: 'report-card.close', resource: 'user_4/2026-fall',
    });
  });

  it('leads with progress and folds the period admin below it', async () => {
    const { container } = mount(<RecordsTab learnerId="user_4" kids={KIDS} />);
    const history = await screen.findByRole('heading', { name: 'Curriculum history' });
    const insights = await screen.findByRole('heading', { name: 'Tutor insights' });
    const closed = await screen.findByRole('heading', { name: 'Closed periods' });
    const before = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(screen.getByRole('heading', { name: 'Report card' }), history)).toBe(true);
    expect(before(history, closed)).toBe(true);
    expect(before(insights, closed)).toBe(true);
    // Transcript, closed periods and the close button live in one fold.
    const fold = container.querySelector('details.teacher-period-admin');
    expect(fold).toBeTruthy();
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary').textContent).toMatch(/Records and closing the period/);
    expect(fold.contains(closed)).toBe(true);
    expect(fold.contains(screen.getByRole('link', { name: 'PDF · Transcript' }))).toBe(true);
    await waitFor(() => expect(fold.querySelector('.teacher-close-period')).toBeTruthy());
  });

  it('labels the card Closed when the selected period is frozen', async () => {
    schoolApi.reportCardFrozen.mockImplementation(({ periodId }) => (periodId
      ? Promise.resolve(ok({ courses: [], activeDays: { bySubject: [], total: 1 }, pendingReview: 0 }))
      : Promise.resolve(ok([{ periodId: '2026-fall', closedBy: 'teacher-a', closedAt: 't' }]))));
    mount(<RecordsTab learnerId="user_4" kids={KIDS} />);
    await waitFor(() => expect(document.querySelector('.teacher-reportcard__mode')?.textContent).toMatch(/^Closed/));
    expect(screen.queryByText('DRAFT')).toBeNull();
  });

  it('closing the period relabels the live card and lists the close', async () => {
    const { fireEvent, act } = await import('@testing-library/react');
    let frozenFall = false;
    schoolApi.reportCardFrozen.mockImplementation(({ periodId }) => {
      if (periodId) return Promise.resolve({ ok: false, status: 404, data: null });
      return Promise.resolve(ok(frozenFall ? [{ periodId: '2026-fall', closedBy: 'teacher-a', closedAt: 't' }] : []));
    });
    schoolApi.closePeriod.mockImplementation(async () => { frozenFall = true; return ok({ closedBy: 'teacher-a', closedAt: 't' }); });
    mount(<RecordsTab learnerId="user_4" kids={KIDS} />);
    await waitFor(() => expect(document.querySelector('.teacher-reportcard__mode')?.textContent).toBe('DRAFT'));
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Close this period' })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); });
    await waitFor(() => expect(document.querySelector('.teacher-reportcard__mode').textContent).toMatch(/^Closed/));
    expect(screen.getByText(/Closed by Teacher A/)).toBeTruthy();
  });

  it('labels the card DRAFT when only another period is frozen', async () => {
    mount(<RecordsTab learnerId="user_4" kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/Closed by Teacher A/)).toBeTruthy());
    await waitFor(() => expect(document.querySelector('.teacher-reportcard__mode')?.textContent).toBe('DRAFT'));
  });

  it('certificate links render only for graded courses', async () => {
    mount(<RecordsTab learnerId="user_4" kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Certificate' })).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Certificate' }).getAttribute('href'))
      .toContain('/api/v1/school/certificate?learnerId=user_4&periodId=2026-fall&courseId=math-fractions');
  });
});
