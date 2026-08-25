import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AgendaStatusBoard, { dayStatus, summarize } from './AgendaStatusBoard.jsx';

vi.mock('../schoolApi.js', () => ({ schoolApi: { agendaPreview: vi.fn(), teacherDay: vi.fn() } }));
import { schoolApi } from '../schoolApi.js';

const KIDS = [{ id: 'milo', name: 'Milo' }, { id: 'felix', name: 'Felix' }];

describe('AgendaStatusBoard model', () => {
  it('statuses read Not started / In progress / Done for the day', () => {
    expect(dayStatus({ total: 3, done: 0 })).toBe('Not started');
    expect(dayStatus({ total: 3, done: 1 })).toBe('In progress');
    expect(dayStatus({ total: 3, done: 3 })).toBe('Done for the day');
    expect(dayStatus({ total: 0, done: 0 })).toBeNull();
  });

  it('summarize joins the plan with passed sessions and excludes suppressed sections', () => {
    const sections = [
      { subject: 'civilization', servedToday: true },
      { subject: 'math' },
      { subject: 'reading', suppressed: { bySubject: 'math' } },
    ];
    const sessions = [{ subject: 'math', outcome: { result: 'passed' } }];
    expect(summarize(sections, sessions)).toEqual({ total: 2, done: 2 });
  });
});

describe('AgendaStatusBoard render', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders one non-interactive row per kid with pills, count, and status', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [
      { learnerId: 'milo', sessions: [{ subject: 'civilization', outcome: { result: 'passed' } }] },
    ] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: { sections: [
      { subject: 'civilization' }, { subject: 'math' }, { subject: 'reading' },
    ] } });
    render(<AgendaStatusBoard kids={KIDS} day="2026-08-24" />);
    await waitFor(() => expect(screen.getByTestId('agenda-status-board')).toBeTruthy());
    expect(screen.getByText('1 of 3')).toBeTruthy();      // Milo: civilization passed
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('0 of 3')).toBeTruthy();      // Felix: nothing yet
    expect(screen.getByText('Not started')).toBeTruthy();
    // Read-only: no buttons, no links.
    const board = screen.getByTestId('agenda-status-board');
    expect(board.querySelectorAll('button, a')).toHaveLength(0);
  });

  it('returns null when every agenda fetch fails — the keypad is never blocked by a broken board', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: false, status: 500, data: null });
    schoolApi.agendaPreview.mockResolvedValue({ ok: false, status: 500, data: null });
    const { container } = render(<AgendaStatusBoard kids={KIDS} day="2026-08-24" />);
    await waitFor(() => expect(schoolApi.agendaPreview).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
