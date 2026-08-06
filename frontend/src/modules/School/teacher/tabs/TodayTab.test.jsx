import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import TodayTab from './TodayTab.jsx';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: {
    teacherToday: vi.fn(),
    lifecycleReview: vi.fn(),
    learnerSessions: vi.fn(),
    progress: vi.fn(),
    printPending: vi.fn(),
    quizRequests: vi.fn(),
  },
}));
const { schoolApi } = await import('../../schoolApi.js');

const KIDS = [{ id: 'felix', name: 'Felix' }, { id: 'milo', name: 'Milo' }];
const ok = (data) => ({ ok: true, status: 200, data });
const fail = (status) => ({ ok: false, status, data: null });

beforeEach(() => {
  vi.clearAllMocks();
  schoolApi.teacherToday.mockResolvedValue(ok([
    { learnerId: 'felix', attemptsToday: 7, correctToday: 5, sessionsToday: [{ unitId: 'math.01', state: 'graded' }], pendingReview: 2 },
    { learnerId: 'milo', attemptsToday: 0, correctToday: 0, sessionsToday: [], pendingReview: 0 },
  ]));
  schoolApi.lifecycleReview.mockResolvedValue(ok({ items: [
    { sessionId: 'ses_1', itemId: 'q3', learnerId: 'felix', prompt: 'Explain photosynthesis', given: 'plants eat light', questionNumber: 3 },
  ] }));
  schoolApi.learnerSessions.mockResolvedValue(ok({ sessions: [{ sessionId: 'ses_1', state: 'graded', unitId: 'math.01' }] }));
  schoolApi.progress.mockResolvedValue(ok({ recentScores: [] }));
  schoolApi.printPending.mockResolvedValue(ok([
    { id: 'pr_1', userId: 'felix', printableId: 'state-capitals', label: 'US State Capitals', pages: 6, copies: 1 },
  ]));
  schoolApi.quizRequests.mockResolvedValue(ok([
    { at: '2026-08-06T10:00:00Z', userId: 'milo', unitId: 'plex:123', unitTitle: 'Fractions Ep. 4', materialTitle: 'Math Course' },
  ]));
});

describe('TodayTab', () => {
  it('joins digest rows with roster names and shows the day numbers', async () => {
    render(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Felix/ })).toBeTruthy());
    expect(screen.getByRole('button', { name: /Milo/ })).toBeTruthy();
    expect(screen.getByText(/5\s*\/\s*7/)).toBeTruthy(); // correct/attempts
  });

  it('drill-in fetches the learner sessions with the study-day window', async () => {
    render(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Felix/ })).toBeTruthy());
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Felix/ })); });
    await waitFor(() => expect(schoolApi.learnerSessions).toHaveBeenCalledWith('felix', { window: 'today' }));
  });

  it('one failing panel leaves its siblings rendered', async () => {
    schoolApi.printPending.mockResolvedValue(fail(500));
    render(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Felix/ })).toBeTruthy());
    expect(screen.getByText(/Explain photosynthesis/)).toBeTruthy();
    expect(screen.getAllByText(/couldn.t load/i).length).toBe(1);
  });

  it('all lifecycle panels unavailable -> exactly one banner, no per-panel noise', async () => {
    schoolApi.lifecycleReview.mockResolvedValue(fail(404));
    schoolApi.teacherToday.mockResolvedValue(ok([])); // empty beside a non-empty roster = unwired tell
    render(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getAllByText(/lifecycle is not enabled/i).length).toBe(1));
    expect(screen.queryByText(/couldn.t load/i)).toBe(null);
  });

  it('mixed availability -> no banner; the healthy panel still renders', async () => {
    schoolApi.lifecycleReview.mockResolvedValue(fail(404));
    render(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Felix/ })).toBeTruthy());
    expect(screen.queryByText(/lifecycle is not enabled/i)).toBe(null);
  });

  it('pending prints and quiz requests render their rows', async () => {
    render(<TodayTab kids={KIDS} />);
    await waitFor(() => expect(screen.getByText(/US State Capitals/)).toBeTruthy());
    expect(screen.getByText(/Fractions Ep\. 4/)).toBeTruthy();
  });
});
