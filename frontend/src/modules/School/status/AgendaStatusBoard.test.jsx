import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AgendaStatusBoard, { dayStatus, summarize, ringsByLearner } from './AgendaStatusBoard.jsx';

vi.mock('../schoolApi.js', () => ({
  schoolApi: { agendaPreview: vi.fn(), teacherDay: vi.fn(), measuresWeekly: vi.fn() },
}));
import { schoolApi } from '../schoolApi.js';

const KIDS = [{ id: 'learner1', name: 'Learner One' }, { id: 'learner2', name: 'Learner Two' }];

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

describe('ringsByLearner', () => {
  it('picks the fitness.rings measure out of the roster payload', () => {
    expect(ringsByLearner({
      learners: [
        { learnerId: 'milo', measures: [{ id: 'fitness.rings', value: 40 }] },
        { learnerId: 'felix', measures: [{ id: 'fitness.rings', value: 0 }] },
      ],
    })).toEqual({ milo: 40, felix: 0 });
  });

  it('omits a learner whose measure could not be read, rather than showing a false zero', () => {
    // null means "we could not find out". Rendering it as 0 would state that
    // the child did no exercise, which is a different and possibly wrong claim.
    expect(ringsByLearner({
      learners: [{ learnerId: 'milo', measures: [{ id: 'fitness.rings', value: null }] }],
    })).toEqual({});
  });

  it('ignores other measures and survives an empty payload', () => {
    expect(ringsByLearner({
      learners: [{ learnerId: 'milo', measures: [{ id: 'something.else', value: 9 }] }],
    })).toEqual({});
    expect(ringsByLearner(null)).toEqual({});
  });
});

describe('AgendaStatusBoard render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no ring data. Individual tests opt in.
    schoolApi.measuresWeekly.mockResolvedValue({ ok: false, status: 0, data: null });
  });

  it('shows a ring count when the measures read lands', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: { sections: [{ subject: 'math' }] } });
    schoolApi.measuresWeekly.mockResolvedValue({ ok: true, status: 200, data: { learners: [
      { learnerId: 'learner1', measures: [{ id: 'fitness.rings', value: 42 }] },
    ] } });

    render(<AgendaStatusBoard kids={KIDS} day="2026-08-26" />);
    await waitFor(() => expect(screen.getByText('42')).toBeTruthy());
    // learner2 has no ring row, so no number is invented for them.
    expect(screen.queryByText('0')).toBeNull();
  });

  it('still renders the day when the measures read fails — rings are additive', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: { sections: [{ subject: 'math' }] } });
    schoolApi.measuresWeekly.mockResolvedValue({ ok: false, status: 500, data: null });

    render(<AgendaStatusBoard kids={KIDS} day="2026-08-26" />);
    await waitFor(() => expect(screen.getAllByText('0 of 1').length).toBe(2));
  });

  it('renders one non-interactive row per kid with pills and a single count readout', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [
      { learnerId: 'learner1', sessions: [{ subject: 'civilization', outcome: { result: 'passed' } }] },
    ] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: { sections: [
      { subject: 'civilization' }, { subject: 'math' }, { subject: 'reading' },
    ] } });
    render(<AgendaStatusBoard kids={KIDS} day="2026-08-24" />);
    await waitFor(() => expect(screen.getByTestId('agenda-status-board')).toBeTruthy());
    // ONE readout per card, in the corner. The status WORD used to sit there
    // with the count repeated under the discs — two lines for one fact, and
    // the word said nothing the filled discs did not already show.
    expect(screen.getByText('1 of 3')).toBeTruthy();      // Learner One: civilization passed
    expect(screen.getByText('0 of 3')).toBeTruthy();      // Learner Two: nothing yet
    expect(screen.queryByText('In progress')).toBeNull();
    expect(screen.queryByText('Not started')).toBeNull();
    // Read-only: no buttons, no links.
    const board = screen.getByTestId('agenda-status-board');
    expect(board.querySelectorAll('button, a')).toHaveLength(0);
  });

  // A cleared day has to be visible from across the room without reading
  // anything. jsdom cannot see the colour or the glow — the harness screenshot
  // gate covers those — so the contract pinned here is the ATTRIBUTE the
  // stylesheet hangs both on.
  it('flags a fully cleared day on the card itself', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [
      { learnerId: 'learner1', sessions: [
        { subject: 'civilization', outcome: { result: 'passed' } },
        { subject: 'math', outcome: { result: 'passed' } },
      ] },
    ] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: { sections: [
      { subject: 'civilization' }, { subject: 'math' },
    ] } });
    render(<AgendaStatusBoard kids={[{ id: 'learner1', name: 'Learner One' }]} day="2026-08-24" />);
    await waitFor(() => expect(screen.getByTestId('agenda-status-board')).toBeTruthy());
    const row = screen.getByTestId('agenda-status-board').querySelector('.school-status-board__row');
    expect(row.dataset.complete).toBe('true');
    expect(screen.getByText('2 of 2')).toBeTruthy();
  });

  it('every segment draws a subject icon and states its subject and state by name', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [
      { learnerId: 'learner1', sessions: [{ subject: 'civilization', outcome: { result: 'passed' } }] },
    ] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: { sections: [
      { subject: 'civilization' }, { subject: 'math' }, { subject: 'reading' },
    ] } });
    render(<AgendaStatusBoard kids={[{ id: 'learner1', name: 'Learner One' }]} day="2026-08-24" />);
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
