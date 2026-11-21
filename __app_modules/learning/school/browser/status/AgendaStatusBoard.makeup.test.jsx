import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import AgendaStatusBoard from "./AgendaStatusBoard.jsx";

vi.mock("../schoolApi.js", () => ({
  schoolApi: { agendaPreview: vi.fn(), teacherDay: vi.fn(), stateGates: vi.fn(), earningsRoster: vi.fn(), wallet: vi.fn(), learnerTerm: vi.fn() },
}));
vi.mock("../../../../../frontend/src/hooks/useWebSocket.js", () => ({
  useWebSocketSubscription: () => {},
}));
import { schoolApi } from "../schoolApi.js";
import { makeupLines } from "./agendaStatusModel.js";

const kids = [{ id: 'learner1', name: 'Learner One' }];
const digest = { ok: true, data: { studyDay: '2026-09-10', learners: [{ learnerId: 'learner1', sessions: [] }] } };
const sections = [{ subject: 'scripture', next: { unitId: 'cfm.1' }, obligation: { state: 'obligated', reason: null } }];
const MAKEUP = { deadline: '2026-09-12', items: [{ day: '2026-09-07', subject: 'math' }] };

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  schoolApi.stateGates.mockResolvedValue({ ok: false });
  schoolApi.teacherDay.mockResolvedValue(digest);
  schoolApi.learnerTerm.mockResolvedValue({ ok: false });
});

// Owner 2026-11-20: the board carries no makeup line; the printed agenda's
// makeup card is where makeup work is announced.
describe('makeup work on the board', () => {
  it('shows no makeup line even when the preview carries makeup', async () => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: { sections, entries: [], makeup: MAKEUP } });
    render(<AgendaStatusBoard kids={kids} />);
    await screen.findByTestId('board-day');
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('board-makeup')).toBeNull();
    expect(screen.queryByText(/Makeup work/)).toBeNull();
  });
});

// Owner 2026-11-21: tapping an amber day in the week says what is still to do
// and that a card scan is how to do it. It lives in the term popup, the thing
// a tap on the week opens; the card itself still carries no makeup line.
describe('still to do this week, in the term popup', () => {
  const TERM = {
    from: '2026-08-31', to: '2026-09-13', today: '2026-09-10',
    weeks: [{ weekId: '2026-08-31' }, { weekId: '2026-09-07' }],
    days: [
      { studyDay: '2026-09-07', state: 'partial' },
      { studyDay: '2026-09-08', state: 'met' },
      { studyDay: '2026-09-10', state: 'pending' },
    ],
  };

  it('groups the server makeup list by day and names the deadline', () => {
    const lines = makeupLines({
      deadline: '2026-09-12',
      items: [
        { day: '2026-09-08', subject: 'math' },
        { day: '2026-09-07', subject: 'math' },
        { day: '2026-09-07', subject: 'language' },
        { day: '2026-09-07', subject: 'math' },
      ],
    }, '2026-09-10');
    expect(lines.days.map((d) => [d.day, d.weekday])).toEqual([['2026-09-07', 'Monday'], ['2026-09-08', 'Tuesday']]);
    expect(lines.days[0].subjects).toHaveLength(2);
    expect(lines.due).toBe('Saturday');
    expect(makeupLines({ deadline: '2026-09-12', items: [{ day: '2026-09-07', subject: 'math' }] }, '2026-09-12').due).toBe('today');
    expect(makeupLines(null)).toBeNull();
    expect(makeupLines({ deadline: null, items: [] })).toBeNull();
  });

  it('a tap on the week lists what is missing and says to scan the card', async () => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: { sections, entries: [], makeup: MAKEUP } });
    schoolApi.learnerTerm.mockResolvedValue({ ok: true, data: TERM });
    render(<AgendaStatusBoard kids={kids} />);
    const grid = await screen.findByTestId('board-days-grid');
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('term-modal-makeup')).toBeNull();
    fireEvent.click(grid);
    const todo = await screen.findByTestId('term-modal-makeup');
    expect(within(todo).getByText('Still to do this week')).toBeInTheDocument();
    expect(within(todo).getByText('Monday')).toBeInTheDocument();
    expect(within(todo).getByText('Scan your card to make it up by Saturday')).toBeInTheDocument();
  });

  it('nothing owed: the popup has no still-to-do block', async () => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: { sections, entries: [], makeup: null } });
    schoolApi.learnerTerm.mockResolvedValue({ ok: true, data: TERM });
    render(<AgendaStatusBoard kids={kids} />);
    const grid = await screen.findByTestId('board-days-grid');
    fireEvent.click(grid);
    await screen.findByTestId('term-modal-grid');
    expect(screen.queryByTestId('term-modal-makeup')).toBeNull();
  });
});
