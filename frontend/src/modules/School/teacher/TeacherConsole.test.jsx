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
  } };
});
vi.mock('./teacherWorkspaceApi.js', () => ({ teacherWorkspaceApi: {
  timeline: vi.fn(async () => ({ ok: true, status: 200, data: { items: [] } })),
  session: vi.fn(async () => ({ ok: false, status: 404, data: null })),
  agendaDispatchPreview: vi.fn(async () => ({ ok: false, status: 404, data: null })),
  agendaDispatch: vi.fn(async () => ({ ok: false, status: 404, data: null })),
  adjustGrade: vi.fn(async () => ({ ok: false, status: 404, data: null })),
} }));
const { teacherWorkspaceApi } = await import('./teacherWorkspaceApi.js');

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

  it('opens a persistent learner workspace with deep-linkable sections', async () => {
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
  });
});
