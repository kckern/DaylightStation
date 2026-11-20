import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgendaStatusBoard from "./AgendaStatusBoard.jsx";

vi.mock("../schoolApi.js", () => ({
  schoolApi: { agendaPreview: vi.fn(), teacherDay: vi.fn(), stateGates: vi.fn(), earningsRoster: vi.fn(), wallet: vi.fn() },
}));
vi.mock("../../../../../frontend/src/hooks/useWebSocket.js", () => ({
  useWebSocketSubscription: () => {},
}));
import { schoolApi } from "../schoolApi.js";

const kids = [{ id: 'learner1', name: 'Learner One' }];
const digest = { ok: true, data: { studyDay: '2026-09-10', learners: [{ learnerId: 'learner1', sessions: [] }] } };
const sections = [{ subject: 'scripture', next: { unitId: 'cfm.1' }, obligation: { state: 'obligated', reason: null } }];
const MAKEUP = { deadline: '2026-09-12', items: [{ day: '2026-09-07', subject: 'math' }] };

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  schoolApi.stateGates.mockResolvedValue({ ok: false });
  schoolApi.teacherDay.mockResolvedValue(digest);
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
