import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgendaStatusBoard from "./AgendaStatusBoard.jsx";
import { makeupHint } from "./agendaStatusModel.js";

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

describe('makeup hint', () => {
  it('names the deadline weekday, and nothing when nothing is owed', () => {
    expect(makeupHint(MAKEUP)).toBe('Makeup work: print your makeup sheet (due Sat)');
    expect(makeupHint({ deadline: null, items: [{ day: '2026-09-07', subject: 'math' }] })).toBe('Makeup work: print your makeup sheet');
    expect(makeupHint({ deadline: '2026-09-12', items: [] })).toBeNull();
    expect(makeupHint(undefined)).toBeNull();
  });

  it('the board shows one makeup line when the preview carries makeup', async () => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: { sections, entries: [], makeup: MAKEUP } });
    render(<AgendaStatusBoard kids={kids} />);
    expect(await screen.findByTestId('board-makeup')).toHaveTextContent('Makeup work: print your makeup sheet (due Sat)');
  });

  it('no makeup in the preview, no line', async () => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: { sections, entries: [] } });
    render(<AgendaStatusBoard kids={kids} />);
    await screen.findByTestId('board-day');
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('board-makeup')).toBeNull();
  });
});
