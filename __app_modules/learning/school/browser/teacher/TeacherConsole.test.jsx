import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import TeacherConsoleView from "./TeacherConsole.jsx";
import PianoProgramsPanel from "../../../piano/browser/teacher-programs.mjs";
import { localDay, shiftDay } from "./teacherDates.js";

const TeacherConsole = () => <MantineProvider><TeacherConsoleView PianoProgramsPanel={PianoProgramsPanel} /></MantineProvider>;

vi.mock("../schoolApi.js", () => {
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
vi.mock("./teacherWorkspaceApi.js", () => ({ teacherWorkspaceApi: {
  authStatus: vi.fn(async () => {
    const userId = sessionStorage.getItem('school-teacher-claim');
    return { ok: true, status: 200, data: userId ? { active: true, userId } : { active: false } };
  }),
  unlock: vi.fn(async (userId) => ({ ok: true, status: 200, data: { active: true, userId } })),
  lock: vi.fn(async () => ({ ok: true, status: 200, data: { locked: true } })),
  stepUp: vi.fn(async () => ({ ok: true, status: 200, data: { grantToken: 'grant-1' } })),
  timeline: vi.fn(async () => ({ ok: true, status: 200, data: { items: [] } })),
  session: vi.fn(async () => ({ ok: false, status: 404, data: null })),
  curriculumExceptions: vi.fn(async () => ({ ok: true, status: 200, data: { active: [] } })),
  agendaDispatchPreview: vi.fn(async () => ({ ok: false, status: 404, data: null })),
  agendaDispatch: vi.fn(async () => ({ ok: false, status: 404, data: null })),
  adjustGrade: vi.fn(async () => ({ ok: false, status: 404, data: null })),
  retractGradeAdjustment: vi.fn(async () => ({ ok: false, status: 404, data: null })),
  artifactOriginal: vi.fn(async () => ({ ok: false, status: 404, data: null })),
  artifactPostview: vi.fn(async () => ({ ok: false, status: 404, data: null })),
  bookReaders: vi.fn(async () => ({ ok: false, status: 404, data: null })),
  readingDetail: vi.fn(async () => ({ ok: false, status: 404, data: null })),
  readingShelf: vi.fn(async () => ({ ok: true, status: 200, data: {
    learnerId: 'user_4', studyDay: '2026-09-06', earliestFinishDay: '2026-08-23',
    obligation: { label: '4 of 7 days', per: 'week', met: false, actual: 4, target: 7, metric: 'checkins', incompatibleBooks: [] },
    items: [{
      itemId: 'itm_1', bookId: '9780000000001', progressMode: 'page', pageCount: 184,
      title: 'A Borrowed Title', authors: ['Paulsen, Gary'], coverUrl: null,
      projection: { status: 'reading', page: 84, percent: 46, minutes: null, daysRead: 6, lastAt: '2026-09-03T18:00:00.000Z' },
    }],
  } })),
} }));
const { teacherWorkspaceApi } = await import("./teacherWorkspaceApi.js");
const { schoolApi } = await import("../schoolApi.js");

beforeEach(() => { sessionStorage.clear(); window.history.pushState({}, '', '/school/teacher'); });
afterEach(() => cleanup());

const ready = async () => {
  render(<TeacherConsole />);
  await waitFor(() => expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeTruthy());
};

describe('TeacherConsole workspace', () => {
  describe('"Log a book"', () => {
    // No camera in the test browser: the typed number is the way in.
    let mediaDevices;
    beforeEach(() => {
      mediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    });
    afterEach(() => {
      if (mediaDevices) Object.defineProperty(navigator, 'mediaDevices', mediaDevices);
      else delete navigator.mediaDevices;
    });

    const stubPhone = (phone) => {
      window.matchMedia = vi.fn((query) => ({
        matches: phone && query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      }));
    };
    let matchMedia;
    beforeEach(() => { matchMedia = window.matchMedia; });
    afterEach(() => { window.matchMedia = matchMedia; });

    it('is on the rail and on the phone bar, and opens over any page', async () => {
      stubPhone(true);
      await ready();
      const rail = screen.getByRole('complementary', { name: 'Teacher workspace navigation' });
      expect(within(rail).getByRole('button', { name: 'Log a book' })).toBeTruthy();
      // The tab's visible word and its name agree.
      const tab = within(screen.getByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Log book' });
      expect(tab.textContent).toBe('Log book');
      fireEvent.click(tab);
      const sheet = await screen.findByRole('dialog', { name: 'Log a book' });
      expect(await within(sheet).findByLabelText('ISBN')).toBeTruthy();
      // An action, not a section: the page underneath does not change.
      expect(window.location.pathname).toBe('/school/teacher');
      fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog', { name: 'Log a book' })).toBeNull();
      expect(document.activeElement).toBe(tab);
    });

    it('opened from the phone rail, closes the rail first, and gives focus to the menu button it came through', async () => {
      stubPhone(true);
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
      const rail = screen.getByRole('complementary', { name: 'Teacher workspace navigation' });
      expect(rail.className).toMatch(/is-open/);
      const entry = within(rail).getByRole('button', { name: 'Log a book' });
      fireEvent.click(entry);
      expect(rail.className).not.toMatch(/is-open/);
      expect(screen.queryByRole('button', { name: 'Close navigation' })).toBeNull();
      const sheet = await screen.findByRole('dialog', { name: 'Log a book' });
      fireEvent.keyDown(sheet, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'Log a book' })).toBeNull();
      // The rail is closed off-screen; the menu button is what is on screen.
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open navigation' }));
    });

    it('opened from the desk rail, gives focus back to the rail control', async () => {
      stubPhone(false);
      await ready();
      const rail = screen.getByRole('complementary', { name: 'Teacher workspace navigation' });
      const entry = within(rail).getByRole('button', { name: 'Log a book' });
      fireEvent.click(entry);
      fireEvent.keyDown(await screen.findByRole('dialog', { name: 'Log a book' }), { key: 'Escape' });
      expect(document.activeElement).toBe(entry);
    });
  });

  it('sizes the phone tab bar to its item count rather than a fixed four', () => {
    const scss = readFileSync(new URL('./Teacher.scss', import.meta.url), 'utf8');
    const start = scss.indexOf('.teacher-workspace__mobile-nav {');
    expect(start).toBeGreaterThan(-1);
    // The whole rule, to its matching brace.
    let depth = 0;
    let end = start;
    for (let i = scss.indexOf('{', start); i < scss.length; i += 1) {
      if (scss[i] === '{') depth += 1;
      if (scss[i] === '}') depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
    const rule = scss.slice(start, end);
    expect(rule.endsWith('}')).toBe(true);
    expect(rule).not.toMatch(/repeat\(\d+,\s*1fr\)/);
    expect(rule).toMatch(/grid-auto-flow: column/);
  });

  it('routes an in-console anchor through the shell instead of reloading', async () => {
    await ready();
    const probe = document.createElement('a');
    probe.href = '/school/teacher/students/user_2/history';
    probe.textContent = 'probe link';
    document.querySelector('.teacher-workspace__main').appendChild(probe);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => { probe.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe('/school/teacher/students/user_2/history');
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'User_2 workspace' })).toBeTruthy());
  });

  it('re-reads the open reading when an in-console link changes only the query', async () => {
    window.history.pushState({}, '', '/school/teacher/students/user_4/reading?reading=itm_1');
    render(<TeacherConsole />);
    await waitFor(() => expect(document.querySelector('.teacher-reading-detail')).toBeTruthy());
    const probe = document.createElement('a');
    probe.href = '/school/teacher/students/user_4/reading';
    probe.textContent = 'shelf link';
    document.querySelector('.teacher-workspace__main').appendChild(probe);
    act(() => { probe.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
    expect(window.location.search).toBe('');
    // Same path, so the shell's route is unchanged; the view must still
    // notice the query moved and close the detail.
    await waitFor(() => expect(document.querySelector('.teacher-reading-detail')).toBeNull());
    expect(screen.getByText('User_4’s shelf')).toBeTruthy();
  });

  it('returns a lesson opened from the dashboard to the dashboard with its learner open', async () => {
    window.history.pushState({}, '', '/school/teacher/students/user_4/history/sessions/ses_x?from=today');
    render(<TeacherConsole />);
    const back = await screen.findByRole('button', { name: /Back to dashboard/ });
    act(() => fireEvent.click(back));
    expect(`${window.location.pathname}${window.location.search}`).toBe('/school/teacher/dashboard?open=user_4');
  });

  it('returns a lesson opened from the action queue to the queue', async () => {
    window.history.pushState({}, '', '/school/teacher/students/user_4/history/sessions/ses_x?from=queue');
    render(<TeacherConsole />);
    const back = await screen.findByRole('button', { name: /Back to action queue/ });
    act(() => fireEvent.click(back));
    expect(`${window.location.pathname}${window.location.search}`).toBe('/school/teacher/queue');
  });

  it('returns a lesson opened from school operations to operations', async () => {
    window.history.pushState({}, '', '/school/teacher/students/user_4/history/sessions/ses_x?from=operations');
    render(<TeacherConsole />);
    const back = await screen.findByRole('button', { name: /Back to operations/ });
    act(() => fireEvent.click(back));
    expect(`${window.location.pathname}${window.location.search}`).toBe('/school/teacher/operations');
  });

  it('renders global navigation and dashboard at the root', async () => {
    await ready();
    // Rail + labeled mobile tab both answer to the full name since the
    // truthful-abbreviation wave — at least one each.
    for (const label of ['Dashboard', 'Action queue', 'Curriculum', 'Operations']) expect(screen.getAllByRole('button', { name: label }).length).toBeGreaterThan(0);
    expect(screen.getByText('Today at a glance')).toBeTruthy();
  });

  it('surfaces shell read failures instead of silently showing an empty school', async () => {
    schoolApi.roster.mockResolvedValueOnce({ ok: false, status: 503, data: null });
    // Once: a cold load reads the backlog ONE time (the dashboard asks; the
    // shell's own first read sees it fresh and skips — useBacklog). This file
    // never resets its mocks, so a spare one-shot would leak into the next test.
    schoolApi.lifecycleReview.mockResolvedValueOnce({ ok: false, status: 503, data: null });
    await ready();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Student roster unavailable'));
    expect(screen.getByRole('status').textContent).toContain('Action-queue totals unavailable');
  });

  it('the rail badge, the phone tab bar and the dashboard strip show one backlog count', async () => {
    // One read per cold load (see the test above); one-shots, because this
    // file never resets its mocks. A second read would fall back to empty
    // and the counts below would go to zero — which is the regression check.
    schoolApi.lifecycleReview.mockResolvedValueOnce({ ok: true, status: 200, data: { items: [{ id: 'r1' }] } });
    schoolApi.printPending.mockResolvedValueOnce({ ok: true, status: 200, data: [{ id: 'p1' }] });
    schoolApi.quizRequests.mockResolvedValueOnce({ ok: true, status: 200, data: [{ userId: 'user_2' }, { userId: 'user_4' }] });
    await ready();
    // Quiz requests count too — the badge used to leave them out.
    await waitFor(() => expect(screen.getByLabelText('4 items waiting').textContent).toBe('4'));
    const tabBar = document.querySelector('.teacher-workspace__mobile-nav');
    expect(within(tabBar).getByRole('button', { name: 'Action queue' }).querySelector('b').textContent).toBe('4');
    expect(screen.getByTestId('backlog-strip')).toHaveTextContent('1 to review · 1 print · 2 requests →');
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

  // The step-up first, then a link: opening a tab after an async PIN prompt
  // is what popup blockers refuse.
  it('shows the child\'s marked sheet after a step-up, as a link', async () => {
    sessionStorage.setItem('school-teacher-claim', 'teacher');
    const created = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:x');
    try {
      teacherWorkspaceApi.session.mockResolvedValueOnce({ ok: true, status: 200, data: {
        schema: 'school.teacher-session/v3', sessionId: 'ses_m', revision: 2,
        taxonomy: { subject: 'Math', lessonTitle: 'Fractions' },
        state: { learnerId: 'user_4', state: 'graded', machineGrade: { percent: 80 }, gradedPercent: 80 }, events: [],
        artifacts: [
          { artifactId: 'a1', kind: 'worksheet', availability: 'regenerable', reprintable: false },
          { artifactId: 'r1', kind: 'result-receipt', role: 'result-receipt', availability: 'exact', reprintable: false },
        ],
      } });
      teacherWorkspaceApi.artifactPostview.mockResolvedValueOnce({ ok: true, status: 200, data: new Blob(['%PDF']) });
      window.history.pushState({}, '', '/school/teacher/students/user_4/history/sessions/ses_m');
      render(<TeacherConsole />);
      // One per worksheet: a receipt is not the child's sheet.
      const button = await screen.findByRole('button', { name: 'See the marked sheet' });
      expect(screen.getAllByRole('button', { name: 'See the marked sheet' })).toHaveLength(1);
      fireEvent.click(button);
      await waitFor(() => expect(screen.getByText('Confirm sensitive action')).toBeTruthy());
      fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '4321' } });
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      const link = await screen.findByRole('link', { name: 'Open the marked sheet (PDF)' });
      expect(link).toHaveAttribute('href', 'blob:x');
      expect(teacherWorkspaceApi.stepUp).toHaveBeenCalledWith({ pin: '4321', action: 'artifact.postview', resource: 'a1' });
      expect(teacherWorkspaceApi.artifactPostview).toHaveBeenCalledWith('a1', 'grant-1');
    } finally {
      URL.createObjectURL = created;
    }
  });

  it('offers no marked sheet before the child has handed the work in', async () => {
    teacherWorkspaceApi.session.mockResolvedValueOnce({ ok: true, status: 200, data: {
      schema: 'school.teacher-session/v3', sessionId: 'ses_i', revision: 1,
      taxonomy: { subject: 'Math', lessonTitle: 'Fractions' },
      state: { learnerId: 'user_4', state: 'issued' }, events: [],
      artifacts: [{ artifactId: 'a2', kind: 'worksheet', availability: 'regenerable', reprintable: true }],
    } });
    window.history.pushState({}, '', '/school/teacher/students/user_4/history/sessions/ses_i');
    render(<TeacherConsole />);
    await screen.findByRole('heading', { name: 'Fractions' });
    expect(screen.queryByRole('button', { name: 'See the marked sheet' })).toBeNull();
  });

  // Only the states that carry marks offer the sheet — an allowlist, so a
  // state added later stays hidden until someone decides it has marks.
  const markedSession = (state) => ({ ok: true, status: 200, data: {
    schema: 'school.teacher-session/v3', sessionId: 'ses_s', revision: 1,
    taxonomy: { subject: 'Math', lessonTitle: 'Fractions' },
    state: { learnerId: 'user_4', state }, events: [],
    artifacts: [{ artifactId: 'a3', kind: 'worksheet', availability: 'regenerable', reprintable: false }],
  } });
  it.each([
    ['graded', true], ['outcome_recorded', true], ['remediation_opened', true], ['rewarded', true],
    ['submitted', false], ['abandoned', false], ['failed', false], [null, false],
  ])('a session in state %s offers the marked sheet: %s', async (state, offered) => {
    teacherWorkspaceApi.session.mockResolvedValueOnce(markedSession(state));
    window.history.pushState({}, '', '/school/teacher/students/user_4/history/sessions/ses_s');
    render(<TeacherConsole />);
    await screen.findByRole('heading', { name: 'Fractions' });
    expect(screen.queryAllByRole('button', { name: 'See the marked sheet' })).toHaveLength(offered ? 1 : 0);
  });

  // The route's own error text names entity ids (EntityNotFoundError); the
  // teacher reads a sentence instead.
  it.each([
    [404, 'This sheet is no longer on file.'],
    [400, 'This sheet can\'t be drawn with marks.'],
    [501, 'Marked sheets aren\'t set up on this install.'],
  ])('a %s from the marked sheet reads plainly', async (status, copy) => {
    sessionStorage.setItem('school-teacher-claim', 'teacher');
    teacherWorkspaceApi.session.mockResolvedValueOnce(markedSession('graded'));
    teacherWorkspaceApi.artifactPostview.mockResolvedValueOnce({ ok: false, status, data: { error: 'EntityNotFoundError: artifact a3 not found for ses_s' } });
    window.history.pushState({}, '', '/school/teacher/students/user_4/history/sessions/ses_s');
    render(<TeacherConsole />);
    fireEvent.click(await screen.findByRole('button', { name: 'See the marked sheet' }));
    await waitFor(() => expect(screen.getByText('Confirm sensitive action')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '4321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(copy)).toBeTruthy();
    expect(screen.queryByText(/EntityNotFoundError/)).toBeNull();
  });

  it('a marked-sheet error the copy does not cover keeps the hook\'s own message', async () => {
    sessionStorage.setItem('school-teacher-claim', 'teacher');
    teacherWorkspaceApi.session.mockResolvedValueOnce(markedSession('graded'));
    teacherWorkspaceApi.artifactPostview.mockResolvedValueOnce({ ok: false, status: 500, data: null });
    window.history.pushState({}, '', '/school/teacher/students/user_4/history/sessions/ses_s');
    render(<TeacherConsole />);
    fireEvent.click(await screen.findByRole('button', { name: 'See the marked sheet' }));
    await waitFor(() => expect(screen.getByText('Confirm sensitive action')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '4321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('That didn’t save — try again.')).toBeTruthy();
  });

  it('revokes the marked sheet\'s blob URL when the inspector closes mid-fetch', async () => {
    sessionStorage.setItem('school-teacher-claim', 'teacher');
    const created = URL.createObjectURL;
    const revoked = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:late');
    URL.revokeObjectURL = vi.fn();
    try {
      teacherWorkspaceApi.session.mockResolvedValueOnce(markedSession('graded'));
      let resolve;
      teacherWorkspaceApi.artifactPostview.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
      window.history.pushState({}, '', '/school/teacher/students/user_4/history/sessions/ses_s');
      const { unmount } = render(<TeacherConsole />);
      fireEvent.click(await screen.findByRole('button', { name: 'See the marked sheet' }));
      await waitFor(() => expect(screen.getByText('Confirm sensitive action')).toBeTruthy());
      fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '4321' } });
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await waitFor(() => expect(teacherWorkspaceApi.artifactPostview).toHaveBeenCalled());
      unmount();
      await act(async () => { resolve({ ok: true, status: 200, data: new Blob(['%PDF']) }); });
      await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late'));
    } finally {
      URL.createObjectURL = created;
      URL.revokeObjectURL = revoked;
    }
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

  // Settling with answers still unmarked is refused as `awaiting_review`
  // after the PIN; the inspector sends the teacher to mark them instead.
  it('points at the queue instead of offering a hand-settle while answers wait for a mark', async () => {
    teacherWorkspaceApi.session.mockResolvedValueOnce({ ok: true, status: 200, data: {
      schema: 'school.teacher-session/v5', sessionId: 's1', state: { state: 'submitted', learnerId: 'user_4' },
      capabilities: { manualSettlement: false, pendingReview: 2 }, taxonomy: {},
    } });
    window.history.pushState({}, '', '/school/teacher/students/user_4/history/sessions/s1');
    render(<TeacherConsole />);
    const link = await screen.findByRole('link', { name: /Mark them in the action queue/ });
    expect(link).toHaveAttribute('href', '/school/teacher/queue');
    expect(screen.getByText(/2 answers are waiting for your mark/)).toBeTruthy();
    expect(screen.queryByText('Settle this by hand')).toBeNull();
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

  // A "needs a grown-up" link says why it was sent; the page names the
  // problem, links the school-wide fix and preselects the credit form.
  it('learner operations names why it was opened and preselects the lesson', async () => {
    const units = schoolApi.curriculumUnits.getMockImplementation();
    schoolApi.curriculumUnits.mockImplementation(async () => ({ ok: true, status: 200, data: { units: [{ unitId: 'unit-a', title: 'Staccato', courseId: 'c1' }] } }));
    try {
      window.history.pushState({}, '', '/school/teacher/students/user_4/operations?reason=program_unavailable&subject=arts&unit=unit-a');
      render(<TeacherConsole />);
      expect(await screen.findByText(/This program can’t start/)).toBeTruthy();
      expect(screen.getByRole('link', { name: /Excuse or pause this lesson for everyone/ }))
        .toHaveAttribute('href', '/school/teacher/operations?unit=unit-a&learner=user_4');
      await waitFor(() => expect(screen.getByLabelText('Unit to attest').value).toBe('unit-a'));
    } finally {
      schoolApi.curriculumUnits.mockImplementation(units);
    }
  });

  // With no lesson picked, the school-wide repair is for "a" lesson, not "this" one.
  it('says "a lesson" in the repair notice when no lesson is picked', async () => {
    window.history.pushState({}, '', '/school/teacher/students/user_4/operations?reason=awaiting_grown_up&subject=arts');
    render(<TeacherConsole />);
    await screen.findByText(/Excuse or pause a lesson for everyone/);
    expect(screen.queryByText(/this lesson for everyone/)).toBeNull();
  });

  // Reopening Operations without a query is a different repair context: the
  // panels seed from the query only on mount, so the view must remount.
  it('drops a preselected repair when Operations is reopened without one', async () => {
    const units = schoolApi.curriculumUnits.getMockImplementation();
    schoolApi.curriculumUnits.mockImplementation(async () => ({ ok: true, status: 200, data: { units: [{ unitId: 'unit-a', title: 'Staccato', courseId: 'c1' }] } }));
    try {
      window.history.pushState({}, '', '/school/teacher/students/user_4/operations?reason=program_unavailable&unit=unit-a');
      render(<TeacherConsole />);
      await waitFor(() => expect(screen.getByLabelText('Unit to attest').value).toBe('unit-a'));
      // The learner tab strip's Operations (the rail has a school-wide one too).
      const learnerNav = document.querySelector('.teacher-workspace__learner-nav');
      act(() => fireEvent.click(within(learnerNav).getByRole('button', { name: 'Operations' })));
      expect(window.location.search).toBe('');
      await waitFor(() => expect(screen.queryByLabelText('Unit to attest')).toBeNull());
    } finally {
      schoolApi.curriculumUnits.mockImplementation(units);
    }
  });

  // Sent from a child's "excuse or pause this lesson for everyone" link: the
  // exception form opens on that lesson, its course and that child.
  it('school operations preselects the lesson and learner it was sent for', async () => {
    const units = schoolApi.curriculumUnits.getMockImplementation();
    schoolApi.curriculumUnits.mockImplementation(async () => ({ ok: true, status: 200, data: { units: [{ unitId: 'unit-a', title: 'Staccato', courseId: 'c1' }] } }));
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    // Hold the exception read: the scroll must wait for the form to load, or
    // the layout settling above and inside it pushes the form below the fold.
    let releaseExceptions;
    teacherWorkspaceApi.curriculumExceptions.mockImplementationOnce(() => new Promise((resolve) => {
      releaseExceptions = () => resolve({ ok: true, status: 200, data: { active: [] } });
    }));
    try {
      window.history.pushState({}, '', '/school/teacher/operations?unit=unit-a&learner=user_4');
      render(<TeacherConsole />);
      await waitFor(() => expect(releaseExceptions).toBeTypeOf('function'));
      await waitFor(() => expect(schoolApi.curriculumUnits).toHaveBeenCalled());
      expect(scrollIntoView).not.toHaveBeenCalled();
      await act(async () => { releaseExceptions(); });
      const field = (label) => [...document.querySelectorAll('#curriculum-exceptions label')]
        .find((node) => node.firstChild?.textContent === label)?.querySelector('select');
      await waitFor(() => expect(field('Lesson')?.value).toBe('unit-a'));
      expect(field('Student').value).toBe('user_4');
      await waitFor(() => expect(field('Course').value).toBe('c1'));
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
      expect(scrollIntoView.mock.contexts[0].id).toBe('curriculum-exceptions');
    } finally {
      schoolApi.curriculumUnits.mockImplementation(units);
      Element.prototype.scrollIntoView = original;
    }
  });

  // An id that is not on the roster would satisfy the form behind a Student
  // select that names nobody; it must not count as a pick.
  it('does not count an unknown learner in the link as a pick', async () => {
    const units = schoolApi.curriculumUnits.getMockImplementation();
    schoolApi.curriculumUnits.mockImplementation(async () => ({ ok: true, status: 200, data: { units: [{ unitId: 'unit-a', title: 'Staccato', courseId: 'c1' }] } }));
    try {
      window.history.pushState({}, '', '/school/teacher/operations?unit=unit-a&learner=nobody');
      render(<TeacherConsole />);
      const control = (label, tag = 'select') => [...document.querySelectorAll('#curriculum-exceptions label')]
        .find((node) => node.firstChild?.textContent === label)?.querySelector(tag);
      await waitFor(() => expect(control('Lesson')?.value).toBe('unit-a'));
      fireEvent.change(control('Decision'), { target: { value: 'excused' } });
      fireEvent.change(control('Reason', 'input'), { target: { value: 'Covered in class' } });
      fireEvent.change(control('Lesson'), { target: { value: 'unit-a' } });
      expect(control('Student').value).toBe('');
      expect(screen.getByRole('button', { name: 'Preview exception' }).disabled).toBe(true);
    } finally {
      schoolApi.curriculumUnits.mockImplementation(units);
    }
  });

  // The form seeds from the link only on mount. Opening Operations from the
  // rail is a fresh visit, so the repair the link preselected must not linger.
  it('school operations drops the preselected repair when reopened from the rail', async () => {
    const units = schoolApi.curriculumUnits.getMockImplementation();
    schoolApi.curriculumUnits.mockImplementation(async () => ({ ok: true, status: 200, data: { units: [{ unitId: 'unit-a', title: 'Staccato', courseId: 'c1' }] } }));
    try {
      window.history.pushState({}, '', '/school/teacher/operations?unit=unit-a&learner=user_4');
      render(<TeacherConsole />);
      const field = (label) => [...document.querySelectorAll('#curriculum-exceptions label')]
        .find((node) => node.firstChild?.textContent === label)?.querySelector('select');
      await waitFor(() => expect(field('Lesson')?.value).toBe('unit-a'));
      expect(field('Student').value).toBe('user_4');
      const workspace = screen.getByRole('navigation', { name: 'Workspace' });
      fireEvent.click(within(workspace).getByRole('button', { name: 'Operations' }));
      await waitFor(() => expect(window.location.search).toBe(''));
      await waitFor(() => expect(field('Lesson')?.value).toBe(''));
      expect(field('Student').value).toBe('');
    } finally {
      schoolApi.curriculumUnits.mockImplementation(units);
    }
  });

  // A regrade is about work already done: the range covers the last month,
  // and a linked `?bank=` arrives filled in rather than retyped from memory.
  it('systematic regrade defaults to the last 30 days and takes a linked bank', async () => {
    window.history.pushState({}, '', '/school/teacher/operations?bank=math/fractions/b1');
    render(<TeacherConsole />);
    await waitFor(() => expect(screen.getByText('Systematic regrade')).toBeTruthy());
    const regrade = screen.getByText('Systematic regrade').closest('section');
    expect(within(regrade).getByLabelText('Bank ID').value).toBe('math/fractions/b1');
    expect(within(regrade).getByLabelText('From').value).toBe(shiftDay(localDay(), -30));
    expect(within(regrade).getByLabelText('Through').value).toBe(localDay());
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
    // The exception panel above has a Reason field of its own.
    const regrade = screen.getByText('Systematic regrade').closest('section');
    fireEvent.change(within(regrade).getByLabelText('Reason'), { target: { value: 'Corrected answer key' } });
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
    fireEvent.click(screen.getByRole('button', { name: 'Preview printable agenda' }));
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

  it('returns a session opened from Day to the exact study day', async () => {
    teacherWorkspaceApi.session.mockResolvedValueOnce({ ok: true, status: 200, data: {
      schema: 'school.teacher-session/v5', sessionId: 'ses_from_day', revision: 1,
      taxonomy: { subject: 'Science', courseTitle: 'Mammals', lessonTitle: 'Fishing Cat' },
      state: { learnerId: 'user_4', state: 'created', terminal: false }, events: [], artifacts: [],
      capabilities: { launchPreview: true, gradeCorrection: false, companionRecovery: false,
        offerRetake: false, manualSettlement: false },
    } });
    window.history.pushState({}, '', '/school/teacher/students/user_4/history/sessions/ses_from_day?from=day&studyDay=2026-08-24');
    render(<TeacherConsole />);
    const back = await screen.findByRole('button', { name: '← Back to Monday, Aug 24' });
    fireEvent.click(back);
    expect(window.location.pathname).toBe('/school/teacher/students/user_4/day/2026-08-24');
    expect(window.location.search).toBe('');
  });

  it('opens the reading workspace from its own URL, read-only', async () => {
    window.history.pushState({}, '', '/school/teacher/students/user_4/reading');
    render(<TeacherConsole />);
    expect(await screen.findByText('User_4’s shelf')).toBeTruthy();
    // A coverless book draws its title as its cover, so the title appears
    // both on the art and as the row's label.
    expect((await screen.findAllByText('A Borrowed Title')).length).toBeGreaterThan(0);
    expect(teacherWorkspaceApi.readingShelf).toHaveBeenCalledWith('user_4');
    // Observation costs nothing: the shelf read is the only call this view makes.
    expect(screen.getByText('p. 84 / 184')).toBeTruthy();
  });

  it('reaches the reading workspace from the learner tab strip', async () => {
    window.history.pushState({}, '', '/school/teacher/students/user_4/day');
    render(<TeacherConsole />);
    const strip = await screen.findByRole('navigation', { name: 'User_4 workspace' });
    fireEvent.click(within(strip).getByRole('button', { name: 'Reading' }));
    expect(window.location.pathname).toBe('/school/teacher/students/user_4/reading');
    expect(await screen.findByText('User_4’s shelf')).toBeTruthy();
  });

  it('shows Day first in the learner tab strip', async () => {
    window.history.pushState({}, '', '/school/teacher/students/user_4/day');
    render(<TeacherConsole />);
    // Scoped to the learner strip: the global rail also owns an "Operations"
    // button, and it precedes this nav in document order.
    const strip = await screen.findByRole('navigation', { name: 'User_4 workspace' });
    const tabs = within(strip).getAllByRole('button');
    expect(tabs[0]).toHaveTextContent('Day');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Day', 'Courses', 'History', 'Reading', 'Cards', 'Debriefs', 'Coins', 'Reports', 'Operations']);
  });

  it('enrolls from the learner\'s Courses tab, on a grid of that learner alone', async () => {
    window.history.pushState({}, '', '/school/teacher/students/user_4/courses');
    render(<TeacherConsole />);
    const heading = await screen.findByRole('heading', { name: 'Enroll User_4 in courses' });
    // The heading paints with the panel's loading skeleton; the grid follows
    // its fetch, so wait for it rather than reading it in the same tick.
    const matrix = await within(heading.closest('section') ?? document.body).findByTestId('school-matrix');
    expect(within(matrix).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Course', 'User_4']);
  });

  it('puts the enrollment grid above syllabus admin on the Curriculum page', async () => {
    window.history.pushState({}, '', '/school/teacher/curriculum');
    render(<TeacherConsole />);
    const matrix = await screen.findByRole('heading', { name: 'The whole school' });
    const syllabi = await screen.findByRole('heading', { name: 'Syllabi' });
    expect(matrix.compareDocumentPosition(syllabi) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
