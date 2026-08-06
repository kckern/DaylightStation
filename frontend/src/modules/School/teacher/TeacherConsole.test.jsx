import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import TeacherConsole from './TeacherConsole.jsx';
import { TODO } from './todoRegistry.js';

vi.mock('../schoolApi.js', () => {
  const okEmpty = async () => ({ ok: true, status: 200, data: [] });
  return { schoolApi: {
    teachers: vi.fn(async () => ({
      ok: true, status: 200, data: { configured: true, teachers: [{ id: 'kckern', name: 'KC' }] },
    })),
    roster: vi.fn(async () => ({
      ok: true, status: 200, data: [{ id: 'felix', name: 'Felix' }, { id: 'milo', name: 'Milo' }],
    })),
    // Panel reads — benign empties; panel behavior has its own per-tab tests.
    teacherToday: vi.fn(async () => ({ ok: true, status: 200, data: [{ learnerId: 'felix', attemptsToday: 0, correctToday: 0, sessionsToday: [], pendingReview: 0 }, { learnerId: 'milo', attemptsToday: 0, correctToday: 0, sessionsToday: [], pendingReview: 0 }] })),
    lifecycleReview: vi.fn(async () => ({ ok: true, status: 200, data: { items: [] } })),
    learnerSessions: vi.fn(async () => ({ ok: true, status: 200, data: { sessions: [] } })),
    progress: vi.fn(async () => ({ ok: true, status: 200, data: { recentScores: [] } })),
    printPending: vi.fn(okEmpty),
    quizRequests: vi.fn(okEmpty),
    assignments: vi.fn(async () => ({ ok: false, status: 404, data: null })),
    periods: vi.fn(okEmpty),
    curriculumUnits: vi.fn(okEmpty),
    learningCatalogs: vi.fn(okEmpty),
    reportCard: vi.fn(async () => ({ ok: true, status: 200, data: null })),
    reportCardFrozen: vi.fn(okEmpty),
    instructionalInsights: vi.fn(async () => ({ ok: true, status: 200, data: null })),
    reviewLearner: vi.fn(okEmpty),
    agendaPreview: vi.fn(async () => ({ ok: true, status: 200, data: { sections: [] } })),
    materials: vi.fn(async () => ({ ok: true, status: 200, data: { materials: [] } })),
    attemptDays: vi.fn(async () => ({ ok: true, status: 200, data: { days: [] } })),
    retract: vi.fn(okEmpty),
    transcript: vi.fn(okEmpty),
    offerRetake: vi.fn(okEmpty),
    passOverrides: vi.fn(async () => ({ ok: true, status: 200, data: { overrides: {} } })),
    milestones: vi.fn(async () => ({ ok: true, status: 200, data: { milestones: [] } })),
    enrichment: vi.fn(async () => ({ ok: true, status: 200, data: { entries: [] } })),
    putAssignments: vi.fn(okEmpty),
    putPeriods: vi.fn(okEmpty),
    putPassOverride: vi.fn(okEmpty),
    putMilestones: vi.fn(okEmpty),
    postEnrichment: vi.fn(okEmpty),
    resolveReview: vi.fn(okEmpty),
    printApprove: vi.fn(okEmpty),
    printDeny: vi.fn(okEmpty),
    quizRequestDismiss: vi.fn(okEmpty),
  } };
});
const { schoolApi } = await import('../schoolApi.js');

beforeEach(() => {
  sessionStorage.clear();
  window.history.pushState({}, '', '/school/teacher');
});

const ready = async () => {
  render(<TeacherConsole />);
  await waitFor(() => expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy());
};

describe('TeacherConsole shell', () => {
  it('renders the four tabs, Today active at the root URL', async () => {
    await ready();
    for (const label of ['Today', 'Planning', 'Records', 'Repair']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-current')).toBe('page');
  });

  it('tab click updates the URL; learner pick appends the id', async () => {
    await ready();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Planning' })); });
    expect(window.location.pathname).toBe('/school/teacher/planning');
    await waitFor(() => expect(screen.getByRole('button', { name: /Felix/ })).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Felix/ })); });
    expect(window.location.pathname).toBe('/school/teacher/planning/felix');
  });

  it('popstate re-parses the URL into tab + learner', async () => {
    await ready();
    act(() => {
      window.history.pushState({}, '', '/school/teacher/records/milo');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => (
      expect(screen.getByRole('button', { name: 'Records' }).getAttribute('aria-current')).toBe('page')
    ));
  });

  it('every registry todoId renders exactly once across the four tabs, and stubs carry no controls', async () => {
    await ready();
    const seen = new Map();
    for (const label of ['Today', 'Planning', 'Records', 'Repair']) {
      act(() => { fireEvent.click(screen.getByRole('button', { name: label })); });
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(document.querySelector('.teacher-tab')).toBeTruthy());
      for (const el of document.querySelectorAll('[data-todo]')) {
        const id = el.getAttribute('data-todo');
        seen.set(id, (seen.get(id) ?? 0) + 1);
        expect(el.querySelectorAll('button, input, select, textarea').length).toBe(0);
        expect(el.textContent).toContain('Planned — not built yet.');
      }
    }
    const expected = Object.values(TODO).sort();
    expect([...seen.keys()].sort()).toEqual(expected);
    for (const [id, count] of seen) expect({ id, count }).toEqual({ id, count: 1 });
  });

  it('configured:false renders the no-teachers card instead of the sign-in chip', async () => {
    schoolApi.teachers.mockResolvedValueOnce({ ok: true, status: 200, data: { configured: false, teachers: [] } });
    render(<TeacherConsole />);
    await waitFor(() => expect(screen.getByText(/No teachers configured/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Sign in/ })).toBe(null);
  });

  it('configured-but-none-resolve renders the resolve-failure copy', async () => {
    schoolApi.teachers.mockResolvedValueOnce({ ok: true, status: 200, data: { configured: true, teachers: [] } });
    render(<TeacherConsole />);
    await waitFor(() => expect(screen.getByText(/No listed teacher resolves/)).toBeTruthy());
  });
});
