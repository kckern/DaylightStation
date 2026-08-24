import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeacherConsole from './TeacherConsole.jsx';

vi.mock('../schoolApi.js', () => {
  const okEmpty = async () => ({ ok: true, status: 200, data: [] });
  return { schoolApi: {
    teachers: vi.fn(async () => ({ ok: true, status: 200, data: { configured: true, teachers: [{ id: 'teacher', name: 'Teacher' }] } })),
    roster: vi.fn(async () => ({ ok: true, status: 200, data: [{ id: 'felix', name: 'Felix' }, { id: 'milo', name: 'Milo' }] })),
    teacherToday: vi.fn(async () => ({ ok: true, status: 200, data: [{ learnerId: 'felix', attemptsToday: 0, correctToday: 0, sessionsToday: [], pendingReview: 0 }, { learnerId: 'milo', attemptsToday: 0, correctToday: 0, sessionsToday: [], pendingReview: 0 }] })),
    lifecycleReview: vi.fn(async () => ({ ok: true, status: 200, data: { items: [] } })),
    learnerSessions: vi.fn(async () => ({ ok: true, status: 200, data: { sessions: [] } })),
    printableWorksheetSessions: vi.fn(async () => ({ ok: true, status: 200, data: { sessions: [] } })),
    progress: vi.fn(async () => ({ ok: true, status: 200, data: { recentScores: [] } })),
    printPending: vi.fn(okEmpty), quizRequests: vi.fn(okEmpty), periods: vi.fn(okEmpty),
    assignments: vi.fn(async () => ({ ok: false, status: 404, data: null })),
    allAssignments: vi.fn(async () => ({ ok: true, status: 200, data: { assignments: [] } })),
    staleSessions: vi.fn(async () => ({ ok: true, status: 200, data: { sessions: [] } })),
    curriculumUnits: vi.fn(async () => ({ ok: true, status: 200, data: { units: [] } })),
    learningCatalogs: vi.fn(okEmpty), syllabi: vi.fn(async () => ({ ok: true, status: 200, data: { syllabi: [] } })),
    reportCard: vi.fn(async () => ({ ok: true, status: 200, data: null })), reportCardFrozen: vi.fn(okEmpty),
    instructionalInsights: vi.fn(async () => ({ ok: true, status: 200, data: null })), reviewLearner: vi.fn(okEmpty),
    agendaPreview: vi.fn(async () => ({ ok: true, status: 200, data: { sections: [] } })), materials: vi.fn(async () => ({ ok: true, status: 200, data: { materials: [] } })),
    attemptDays: vi.fn(async () => ({ ok: true, status: 200, data: { days: [] } })), attestations: vi.fn(async () => ({ ok: true, status: 200, data: { entries: [] } })),
    passOverrides: vi.fn(async () => ({ ok: true, status: 200, data: { overrides: {} } })), milestones: vi.fn(async () => ({ ok: true, status: 200, data: { milestones: [] } })),
    enrichment: vi.fn(async () => ({ ok: true, status: 200, data: { entries: [] } })),
    regradeAttempts: vi.fn(async () => ({ ok: true, status: 200, data: { applied: false, checked: 0, changed: [], sessionsAffected: [] } })),
  } };
});
vi.mock('./teacherWorkspaceApi.js', () => ({ teacherWorkspaceApi: {
  authStatus: vi.fn(async () => {
    const userId = sessionStorage.getItem('school-teacher-claim');
    return { ok: true, status: 200, data: userId ? { active: true, userId } : { active: false } };
  }),
  unlock: vi.fn(async (userId) => ({ ok: true, status: 200, data: { active: true, userId } })),
  lock: vi.fn(async () => ({ ok: true, status: 200, data: { locked: true } })),
  stepUp: vi.fn(async () => ({ ok: true, status: 200, data: { grantToken: 'grant-1' } })),
  timeline: vi.fn(async () => ({ ok: true, status: 200, data: { items: [] } })),
  session: vi.fn(async () => ({ ok: false, status: 404, data: null })),
  agendaDispatchPreview: vi.fn(async () => ({ ok: false, status: 404, data: null })),
  agendaDispatch: vi.fn(async () => ({ ok: false, status: 404, data: null })),
  adjustGrade: vi.fn(async () => ({ ok: false, status: 404, data: null })),
  retractGradeAdjustment: vi.fn(async () => ({ ok: false, status: 404, data: null })),
  artifactPostview: vi.fn(async () => ({ ok: false, status: 404, data: null })),
} }));
const { teacherWorkspaceApi } = await import('./teacherWorkspaceApi.js');
const { schoolApi } = await import('../schoolApi.js');

beforeEach(() => { sessionStorage.clear(); window.history.pushState({}, '', '/school/teacher'); });
afterEach(() => cleanup());

const ready = async () => {
  render(<TeacherConsole />);
  await waitFor(() => expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeTruthy());
};

describe('TeacherConsole workspace', () => {
  it('renders global navigation and dashboard at the root', async () => {
    await ready();
    for (const label of ['Dashboard', 'Action queue', 'Curriculum', 'Operations']) expect(screen.getByRole('button', { name: label })).toBeTruthy();
    expect(screen.getByText('Today at a glance')).toBeTruthy();
  });

  it('surfaces shell read failures instead of silently showing an empty school', async () => {
    schoolApi.roster.mockResolvedValueOnce({ ok: false, status: 503, data: null });
    schoolApi.lifecycleReview.mockResolvedValueOnce({ ok: false, status: 503, data: null });
    await ready();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Student roster unavailable'));
    expect(screen.getByRole('status').textContent).toContain('Action-queue totals unavailable');
  });

  it('opens a persistent learner workspace with deep-linkable sections', async () => {
    sessionStorage.setItem('school-teacher-claim', 'teacher');
    await ready();
    act(() => fireEvent.click(screen.getByRole('navigation', { name: 'Students' }).querySelector('button')));
    expect(window.location.pathname).toBe('/school/teacher/students/felix/overview');
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Felix workspace' })).toBeTruthy());
    act(() => fireEvent.click(screen.getByRole('button', { name: 'History' })));
    expect(window.location.pathname).toBe('/school/teacher/students/felix/history');
    await waitFor(() => expect(screen.getByText('No sessions recorded.')).toBeTruthy());
  });

  it('restores route state on browser navigation', async () => {
    await ready();
    act(() => { window.history.pushState({}, '', '/school/teacher/students/milo/reports'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Milo workspace' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Reports' }).getAttribute('aria-current')).toBe('page');
  });

  it('names an unknown bookmarked learner instead of blanking', async () => {
    window.history.pushState({}, '', '/school/teacher/students/missing/overview');
    render(<TeacherConsole />);
    await waitFor(() => expect(screen.getByText('Student not found')).toBeTruthy());
  });

  it('inspects a session and previews a grade correction before apply', async () => {
    sessionStorage.setItem('school-teacher-claim', 'teacher');
    teacherWorkspaceApi.session.mockResolvedValueOnce({ ok: true, status: 200, data: {
      schema: 'school.teacher-session/v1', sessionId: 'ses_1', revision: 4, artifactIds: ['art_1'],
      state: { learnerId: 'felix', unitId: 'fractions', state: 'closed', machineGrade: { percent: 70 }, gradedPercent: 70 }, events: [],
    } });
    teacherWorkspaceApi.adjustGrade.mockResolvedValueOnce({ ok: true, status: 200, data: {
      applied: false, baseSeq: 4, adjustmentId: 'adj_1', previousEffectiveGrade: { percent: 70 }, effectiveGrade: { percent: 90 }, outcome: { result: 'passed' },
    } });
    window.history.pushState({}, '', '/school/teacher/students/felix/history/sessions/ses_1');
    render(<TeacherConsole />);
    await waitFor(() => expect(screen.getByText('Machine grade').nextSibling.textContent).toBe('70%'));
    fireEvent.click(screen.getByRole('button', { name: 'Correct grade…' }));
    fireEvent.change(screen.getByLabelText('Effective percent'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('Grade correction reason'), { target: { value: 'Erased mark read incorrectly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview correction' }));
    await waitFor(() => expect(screen.getByText(/Impact preview/)).toBeTruthy());
    expect(teacherWorkspaceApi.adjustGrade).toHaveBeenCalledWith('ses_1', expect.objectContaining({ percent: 90, apply: false, baseSeq: 4 }));

    teacherWorkspaceApi.adjustGrade.mockResolvedValueOnce({ ok: true, status: 201, data: { applied: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply correction' }));
    await waitFor(() => expect(screen.getByText('Confirm sensitive action')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '4321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(teacherWorkspaceApi.adjustGrade).toHaveBeenCalledTimes(2));
    expect(teacherWorkspaceApi.stepUp).toHaveBeenCalledWith({ pin: '4321', action: 'sessions.grade-adjust', resource: 'ses_1' });
    expect(teacherWorkspaceApi.adjustGrade).toHaveBeenLastCalledWith('ses_1', expect.objectContaining({ apply: true, pin: null }), 'grant-1');
  });

  it('prepares a protected artifact postview after resource-scoped confirmation', async () => {
    sessionStorage.setItem('school-teacher-claim', 'teacher');
    const createObjectURL = vi.fn(() => 'blob:postview');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    teacherWorkspaceApi.session.mockResolvedValueOnce({ ok: true, status: 200, data: {
      schema: 'school.teacher-session/v1', sessionId: 'ses_2', revision: 1, artifactIds: ['art_2'],
      state: { learnerId: 'felix', unitId: 'geometry', state: 'closed', machineGrade: { percent: 80 }, gradedPercent: 80 }, events: [],
    } });
    teacherWorkspaceApi.artifactPostview.mockResolvedValueOnce({ ok: true, status: 200, data: new Blob(['pdf']) });
    window.history.pushState({}, '', '/school/teacher/students/felix/history/sessions/ses_2');
    render(<TeacherConsole />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare postview PDF…' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Prepare postview PDF…' }));
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '4321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open postview PDF' }).getAttribute('href')).toBe('blob:postview'));
    expect(teacherWorkspaceApi.stepUp).toHaveBeenCalledWith({ pin: '4321', action: 'artifact.postview', resource: 'art_2' });
    expect(teacherWorkspaceApi.artifactPostview).toHaveBeenCalledWith('art_2', 'grant-1');
  });

  it('previews and protects retraction of an existing grade correction', async () => {
    sessionStorage.setItem('school-teacher-claim', 'teacher');
    teacherWorkspaceApi.session.mockResolvedValueOnce({ ok: true, status: 200, data: {
      schema: 'school.teacher-session/v1', sessionId: 'ses_3', revision: 7, artifactIds: [],
      state: {
        learnerId: 'felix', unitId: 'geometry', state: 'closed', machineGrade: { percent: 70 }, gradedPercent: 90,
        gradeAdjustments: [{ adjustmentId: 'adj_3', percent: 90, reason: 'Scanner miss', adjustedBy: 'teacher', retracted: false }],
      },
      events: [],
    } });
    teacherWorkspaceApi.retractGradeAdjustment
      .mockResolvedValueOnce({ ok: true, status: 200, data: { applied: false, baseSeq: 7, effectiveGrade: { percent: 70 } } })
      .mockResolvedValueOnce({ ok: true, status: 201, data: { applied: true } });
    window.history.pushState({}, '', '/school/teacher/students/felix/history/sessions/ses_3');
    render(<TeacherConsole />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retract…' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Retract…' }));
    fireEvent.change(screen.getByLabelText('Retraction reason for adj_3'), { target: { value: 'Applied to the wrong session' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview retraction' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply retraction' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Apply retraction' }));
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '4321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(teacherWorkspaceApi.retractGradeAdjustment).toHaveBeenCalledTimes(2));
    expect(teacherWorkspaceApi.stepUp).toHaveBeenCalledWith({
      pin: '4321', action: 'sessions.grade-adjustment.retract', resource: 'ses_3/adj_3',
    });
    expect(teacherWorkspaceApi.retractGradeAdjustment).toHaveBeenLastCalledWith(
      'ses_3', 'adj_3', expect.objectContaining({ apply: true, pin: null }), 'grant-1',
    );
  });

  it('previews a bounded systematic regrade before a protected apply', async () => {
    sessionStorage.setItem('school-teacher-claim', 'teacher');
    schoolApi.regradeAttempts
      .mockResolvedValueOnce({ ok: true, status: 200, data: { applied: false, checked: 12, changed: [{ attemptId: 'att_1' }], sessionsAffected: ['ses_1'] } })
      .mockResolvedValueOnce({ ok: true, status: 201, data: { applied: true, checked: 12, changed: [{ attemptId: 'att_1' }], sessionsAffected: ['ses_1'] } });
    window.history.pushState({}, '', '/school/teacher/operations');
    render(<TeacherConsole />);
    await waitFor(() => expect(screen.getByText('Systematic regrade')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Bank ID'), { target: { value: 'math/fractions' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Corrected answer key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview regrade' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply 1 corrections' })).toBeTruthy());
    expect(schoolApi.regradeAttempts).toHaveBeenCalledWith(expect.objectContaining({
      bankId: 'math/fractions', reason: 'Corrected answer key', apply: false, pin: null,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 corrections' }));
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '4321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(schoolApi.regradeAttempts).toHaveBeenCalledTimes(2));
    expect(teacherWorkspaceApi.stepUp).toHaveBeenCalledWith({ pin: '4321', action: 'attempts.regrade', resource: 'math/fractions' });
    expect(schoolApi.regradeAttempts).toHaveBeenLastCalledWith(expect.objectContaining({ apply: true, pin: null }), 'grant-1');
  });
});
