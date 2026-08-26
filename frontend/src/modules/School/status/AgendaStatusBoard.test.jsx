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
    const summary = summarize(sections, sessions);
    expect(summary.total).toBe(2);
    expect(summary.done).toBe(2);
    // Which subject is done is the segment's whole content now that the tiles
    // carry icons instead of text, so the join has to survive as a list.
    expect(summary.segments).toEqual([
      { subject: 'civilization', label: 'Civilization', done: true },
      { subject: 'math', label: 'Math & Money', done: true },
    ]);
  });

  it('summarize names a subject that is not one of the nine shelves', () => {
    const summary = summarize([{ subject: 'nature-study' }], []);
    expect(summary.segments).toEqual([{ subject: 'nature-study', label: 'Nature Study', done: false }]);
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

  it('every segment draws a subject icon and states its subject and state by name', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [
      { learnerId: 'milo', sessions: [{ subject: 'civilization', outcome: { result: 'passed' } }] },
    ] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: { sections: [
      { subject: 'civilization' }, { subject: 'math' }, { subject: 'reading' },
    ] } });
    render(<AgendaStatusBoard kids={[{ id: 'milo', name: 'Milo' }]} day="2026-08-24" />);
    await waitFor(() => expect(screen.getByTestId('agenda-status-board')).toBeTruthy());

    const segments = screen.getByTestId('agenda-status-board').querySelectorAll('.school-status-board__pill');
    expect(segments).toHaveLength(3);
    // Done-ness is an attribute, not a colour — jsdom cannot see colour, and a
    // test that pretended to would go green over a broken stylesheet.
    expect([...segments].map((el) => el.dataset.done)).toEqual(['true', 'false', 'false']);
    // No text in the tiles: the subject rides on the accessible name instead.
    expect([...segments].every((el) => el.textContent.trim() === '')).toBe(true);
    // ...and every one of them HAS an icon and a name, including 'reading',
    // which is not one of the nine shelves and falls back to the apple.
    expect([...segments].every((el) => el.querySelector('svg'))).toBe(true);
    expect(screen.getByLabelText('Civilization: done')).toBeTruthy();
    expect(screen.getByLabelText('Math & Money: not done')).toBeTruthy();
    expect(screen.getByLabelText('Reading: not done')).toBeTruthy();
  });

  it('returns null when every agenda fetch fails — the keypad is never blocked by a broken board', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: false, status: 500, data: null });
    schoolApi.agendaPreview.mockResolvedValue({ ok: false, status: 500, data: null });
    const { container } = render(<AgendaStatusBoard kids={KIDS} day="2026-08-24" />);
    await waitFor(() => expect(schoolApi.agendaPreview).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
