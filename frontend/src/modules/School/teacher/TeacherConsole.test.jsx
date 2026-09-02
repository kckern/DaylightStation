import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeacherConsole from './TeacherConsole.jsx';

vi.mock('../schoolApi.js', () => {
  const okEmpty = async () => ({ ok: true, status: 200, data: [] });
  return { schoolApi: {
    teachers: vi.fn(async () => ({ ok: true, status: 200, data: { configured: true, teachers: [{ id: 'teacher', name: 'Teacher' }] } })),
    roster: vi.fn(async () => ({ ok: true, status: 200, data: [{ id: 'user_4', name: 'User_4' }, { id: 'user_2', name: 'User_2' }] })),
    teacherToday: vi.fn(async () => ({ ok: true, status: 200, data: [{ learnerId: 'user_4', attemptsToday: 0, correctToday: 0, sessionsToday: [], pendingReview: 0 }, { learnerId: 'user_2', attemptsToday: 0, correctToday: 0, sessionsToday: [], pendingReview: 0 }] })),
    teacherDay: vi.fn(async (studyDay = null) => ({ ok: true, status: 200, data: {
      schema: 'school.teacher-day/v2', studyDay: studyDay ?? new Date().toISOString().slice(0, 10), learners: [],
    } })),
    lifecycleReview: vi.fn(async () => ({ ok: true, status: 200, data: { items: [] } })),
    learnerSessions: vi.fn(async () => ({ ok: true, status: 200, data: { sessions: [] } })),
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
    bankHealth: vi.fn(async () => ({ ok: true, status: 200, data: { warmedAt: '2026-08-01T00:00:00.000Z', banks: 4, failed: [] } })),
    reportCardFrozenVersions: vi.fn(async () => ({ ok: true, status: 200, data: { versions: [] } })),
    programDayBypasses: vi.fn(async () => ({ ok: true, status: 200, data: { active: [], history: [] } })),
    pianoLessonGate: vi.fn(async () => ({ ok: true, status: 200, data: { gated: false, reason: 'not-enrolled' } })),
    grantProgramDayBypass: vi.fn(), retractProgramDayBypass: vi.fn(),
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
  artifactOriginal: vi.fn(async () => ({ ok: false, status: 404, data: null })),
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
    // Rail + labeled mobile tab both answer to the full name since the
    // truthful-abbreviation wave — at least one each.
    for (const label of ['Dashboard', 'Action queue', 'Curriculum', 'Operations']) expect(screen.getAllByRole('button', { name: label }).length).toBeGreaterThan(0);
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
    // Picking a learner lands on their day record — the workspace's organizing
    // unit — not on the retired Overview tab.
    expect(window.location.pathname).toBe('/school/teacher/students/user_4/day');
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'User_4 workspace' })).toBeTruthy());
    act(() => fireEvent.click(screen.getByRole('button', { name: 'History' })));
    expect(window.location.pathname).toBe('/school/teacher/students/user_4/history');
    await waitFor(() => expect(screen.getByText('No sessions recorded.')).toBeTruthy());
  });

  it('restores route state on browser navigation', async () => {
    await ready();
    act(() => { window.history.pushState({}, '', '/school/teacher/students/user_2/reports'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'User_2 workspace' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Reports' }).getAttribute('aria-current')).toBe('page');
  });

  it('redirects the retired /overview alias to the canonical short form (trim 5.6)', async () => {
    window.history.pushState({}, '', '/school/teacher/students/user_4/overview');
    render(<TeacherConsole />);
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'User_4 workspace' })).toBeTruthy());
    // The bookmark is canonicalized to the bare learner path — the Day
    // record — not left sitting at the retired /overview URL.
    expect(window.location.pathname).toBe('/school/teacher/students/user_4');
    expect(screen.getByRole('button', { name: 'Day' }).getAttribute('aria-current')).toBe('page');
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
      state: { learnerId: 'user_4', unitId: 'fractions', state: 'closed', machineGrade: { percent: 70 }, gradedPercent: 70 }, events: [],
    } });
    teacherWorkspaceApi.adjustGrade.mockResolvedValueOnce({ ok: true, status: 200, data: {
      applied: false, baseSeq: 4, adjustmentId: 'adj_1', previousEffectiveGrade: { percent: 70 }, effectiveGrade: { percent: 90 }, outcome: { result: 'passed' },
    } });
    window.history.pushState({}, '', '/school/teacher/students/user_4/history/sessions/ses_1');
    render(<TeacherConsole />);
    await waitFor(() => expect(screen.getByText('Score').nextSibling.textContent).toBe('70%'));
    fireEvent.click(screen.getByRole('button', { name: 'Fix a marked answer' }));
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

  it('reads a bookmarked session without a local teacher claim', async () => {
    const priorSessionReads = teacherWorkspaceApi.session.mock.calls.length;
    teacherWorkspaceApi.session
      .mockResolvedValueOnce({ ok: true, status: 200, data: {
        schema: 'school.teacher-session/v3', sessionId: 'ses_direct', revision: 1, artifacts: [],
        taxonomy: { subject: 'Science', courseTitle: 'Chemistry', lessonTitle: 'Atoms' },
        state: { learnerId: 'user_4', state: 'closed', machineGrade: { percent: 83 }, gradedPercent: 83 }, events: [],
      } });
    window.history.pushState({}, '', '/school/teacher/students/user_4/history/sessions/ses_direct');
    render(<TeacherConsole />);
    await waitFor(() => expect(screen.getByText('Score').nextSibling.textContent).toBe('83%'));
    expect(teacherWorkspaceApi.session.mock.calls.length - priorSessionReads).toBe(1);
    expect(screen.getByRole('heading', { name: 'Atoms' })).toBeTruthy();
  });

  it('shows an immutable worksheet and its recorded answers rather than generic assessments', async () => {
    teacherWorkspaceApi.session.mockResolvedValueOnce({ ok: true, status: 200, data: {
      schema: 'school.teacher-session/v3', sessionId: 'ses_2', revision: 1,
      taxonomy: { subject: 'Civilization', courseTitle: 'United States', lessonTitle: 'Illinois' },
      state: { learnerId: 'user_4', state: 'closed', machineGrade: { percent: 100 }, gradedPercent: 100 }, events: [],
      assignment: { createdAt: '2026-08-24T14:28:43.031Z', questions: [{ itemId: 'q1', number: 19, prompt: 'Which state is Illinois?', choices: [{ text: 'Illinois' }, { text: 'Ohio' }] }] },
      assessment: { items: [{ itemId: 'q1', questionNumber: 19, prompt: 'Which state is Illinois?', given: 'Illinois', verdict: 'correct' }] },
      artifacts: [],
    } });
    window.history.pushState({}, '', '/school/teacher/students/user_4/history/sessions/ses_2');
    render(<TeacherConsole />);
    await waitFor(() => expect(screen.getByText('Questions and answers')).toBeTruthy());
    // The worksheet's own number, printed once, with the recorded answer on
    // the same row — not the same question listed twice under two headings.
    expect(screen.getAllByText('Which state is Illinois?')).toHaveLength(1);
    expect(screen.getByText('19.')).toBeTruthy();
    expect(screen.getByText('Illinois', { selector: '.teacher-graded-q__given' })).toBeTruthy();
    expect(screen.queryByText('assessment')).toBeNull();
  });

  it('previews and protects retraction of an existing grade correction', async () => {
    sessionStorage.setItem('school-teacher-claim', 'teacher');
    teacherWorkspaceApi.session.mockResolvedValueOnce({ ok: true, status: 200, data: {
      schema: 'school.teacher-session/v1', sessionId: 'ses_3', revision: 7, artifactIds: [],
      state: {
        learnerId: 'user_4', unitId: 'geometry', state: 'closed', machineGrade: { percent: 70 }, gradedPercent: 90,
        gradeAdjustments: [{ adjustmentId: 'adj_3', percent: 90, reason: 'Scanner miss', adjustedBy: 'teacher', retracted: false }],
      },
      events: [],
    } });
    teacherWorkspaceApi.retractGradeAdjustment
      .mockResolvedValueOnce({ ok: true, status: 200, data: { applied: false, baseSeq: 7, effectiveGrade: { percent: 70 } } })
      .mockResolvedValueOnce({ ok: true, status: 201, data: { applied: true } });
    window.history.pushState({}, '', '/school/teacher/students/user_4/history/sessions/ses_3');
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

  it('offers an arbitrary-day agenda as a non-recording planning preview', async () => {
    // The day record owns this now: its own day picker ("Jump to"), and the
    // dry-run promise sits on the printed-agenda fold rather than on a
    // permanently-visible "planning preview" disclaimer.
    window.history.pushState({}, '', '/school/teacher/students/user_4/day');
    render(<TeacherConsole />);
    await waitFor(() => expect(screen.getByLabelText('Jump to')).toBeTruthy());
    // A day the picker cannot already be showing — an unchanged controlled
    // value fires no onChange, and a stale mock call would pass vacuously.
    schoolApi.agendaPreview.mockClear();
    fireEvent.change(screen.getByLabelText('Jump to'), { target: { value: '2099-01-01' } });
    await waitFor(() => expect(schoolApi.agendaPreview).toHaveBeenLastCalledWith('user_4', '2099-01-01'));
    expect(window.location.pathname).toBe('/school/teacher/students/user_4/day/2099-01-01');
    fireEvent.click(screen.getByRole('button', { name: 'Show the printed agenda' }));
    expect(screen.getByText(/don’t work\. Nothing here starts a lesson/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /print .* agenda/i })).toBeNull();
    expect(teacherWorkspaceApi.agendaDispatchPreview).not.toHaveBeenCalled();
    expect(teacherWorkspaceApi.agendaDispatch).not.toHaveBeenCalled();
  });

  it('lands a learner on their day record and keeps the URL in step with the day', async () => {
    window.history.pushState({}, '', '/school/teacher/students/user_4/day/2026-08-25');
    render(<TeacherConsole />);
    await waitFor(() => expect(screen.getByText('Tuesday, Aug 25')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /previous day/i }));
    await waitFor(() => expect(window.location.pathname).toBe('/school/teacher/students/user_4/day/2026-08-24'));
  });

  it('shows Day first in the learner tab strip', async () => {
    window.history.pushState({}, '', '/school/teacher/students/user_4/day');
    render(<TeacherConsole />);
    // Scoped to the learner strip: the global rail also owns an "Operations"
    // button, and it precedes this nav in document order.
    const strip = await screen.findByRole('navigation', { name: 'User_4 workspace' });
    const tabs = within(strip).getAllByRole('button');
    expect(tabs[0]).toHaveTextContent('Day');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Day', 'Courses', 'History', 'Reports', 'Operations']);
  });
});
