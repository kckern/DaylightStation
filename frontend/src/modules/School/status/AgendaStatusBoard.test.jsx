import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AgendaStatusBoard, { dayStatus, summarize, ringsByLearner } from './AgendaStatusBoard.jsx';

vi.mock('../schoolApi.js', () => ({
  schoolApi: { agendaPreview: vi.fn(), teacherDay: vi.fn(), measuresWeekly: vi.fn() },
}));
// Capture the board's `omr` handler so a scan can be delivered to it directly.
// The board must not wait out its five-minute poll to show a disc turning.
const wsHandlers = [];
vi.mock('../../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (topic, cb) => { wsHandlers.push({ topic, cb }); },
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

  it('draws ONE DISC PER ASSIGNMENT, not one per subject', () => {
    // The whole point of the change: two geography sheets are two globes.
    const sessions = [
      { unitId: 'geo.01', subject: 'civilization', outcome: { result: 'passed' } },
      { unitId: 'geo.02', subject: 'civilization', outcome: null },
    ];
    const summary = summarize([{ subject: 'civilization' }], sessions);
    expect(summary.total).toBe(2);
    expect(summary.done).toBe(1);
    expect(summary.segments.map((s) => s.subject)).toEqual(['civilization', 'civilization']);
  });

  it('maps the outcome vocabulary onto three disc states', () => {
    const sessions = [
      { unitId: 'a', subject: 'math', outcome: { result: 'passed' } },
      { unitId: 'b', subject: 'math', outcome: { result: 'needs_remediation' } },
      { unitId: 'c', subject: 'math', outcome: null },
    ];
    const summary = summarize([{ subject: 'math' }], sessions);
    expect(summary.segments.map((s) => s.state)).toEqual(['passed', 'needs-retry', 'pending']);
    // Only a pass counts toward done — a yellow disc is outstanding work.
    expect(summary.done).toBe(1);
  });

  it('takes the union of evidence and plan, so a "one more?" lesson still shows', () => {
    // A lesson taken through the chain never appears as a section's `next`
    // (the subject is already served), but the child is holding the sheet.
    const sections = [
      { subject: 'scripture', servedToday: true },
      { subject: 'math', next: { unitId: 'math.07' } },
    ];
    const sessions = [{ unitId: 'cfm.d2', subject: 'scripture', outcome: { result: 'passed' } }];
    const summary = summarize(sections, sessions, [{ unitId: 'math.07', subject: 'math' }]);
    expect(summary.segments.map((s) => s.unitId).sort()).toEqual(['cfm.d2', 'math.07']);
    expect(summary.done).toBe(1);
  });

  it('collapses a retry to its best outcome — a passed retry is not still yellow', () => {
    const sessions = [
      { unitId: 'a', subject: 'math', outcome: { result: 'needs_remediation' } },
      { unitId: 'a', subject: 'math', outcome: { result: 'passed' } },
    ];
    const summary = summarize([{ subject: 'math' }], sessions);
    expect(summary.total).toBe(1);
    expect(summary.segments[0].state).toBe('passed');
  });

  it('excludes a suppressed subject, evidence and all', () => {
    const sections = [
      { subject: 'math', next: { unitId: 'math.01' } },
      { subject: 'reading', suppressed: { bySubject: 'math' } },
    ];
    const sessions = [{ unitId: 'read.01', subject: 'reading', outcome: { result: 'passed' } }];
    const summary = summarize(sections, sessions, [{ unitId: 'math.01', subject: 'math' }]);
    expect(summary.segments.map((s) => s.unitId)).toEqual(['math.01']);
  });

  it('names a subject that is not one of the nine shelves', () => {
    const summary = summarize(
      [{ subject: 'nature-study' }],
      [{ unitId: 'n.01', subject: 'nature-study', outcome: null }],
    );
    expect(summary.segments).toEqual([
      { unitId: 'n.01', subject: 'nature-study', label: 'Nature Study', state: 'pending' },
    ]);
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
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: { sections: [{ subject: 'math', next: { unitId: 'math.01' } }],
      entries: [{ unitId: 'math.01', subject: 'math' }] } });
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
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: { sections: [{ subject: 'math', next: { unitId: 'math.01' } }],
      entries: [{ unitId: 'math.01', subject: 'math' }] } });
    schoolApi.measuresWeekly.mockResolvedValue({ ok: false, status: 500, data: null });

    render(<AgendaStatusBoard kids={KIDS} day="2026-08-26" />);
    await waitFor(() => expect(screen.getAllByText('0 of 1').length).toBe(2));
  });

  it('renders one non-interactive row per kid with pills and a single count readout', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [
      { learnerId: 'learner1', sessions: [
        { unitId: 'civ.01', subject: 'civilization', outcome: { result: 'passed' } },
      ] },
    ] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: {
      sections: [
        { subject: 'civilization', next: { unitId: 'civ.01' } },
        { subject: 'math', next: { unitId: 'math.01' } },
        { subject: 'reading', next: { unitId: 'read.01' } },
      ],
      entries: [
        { unitId: 'civ.01', subject: 'civilization' },
        { unitId: 'math.01', subject: 'math' },
        { unitId: 'read.01', subject: 'reading' },
      ],
    } });
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
  it('flags a fully cleared day, and the CHIP REPLACES the count', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [
      { learnerId: 'learner1', sessions: [
        { unitId: 'civ.01', subject: 'civilization', outcome: { result: 'passed' } },
        { unitId: 'math.01', subject: 'math', outcome: { result: 'passed' } },
      ] },
    ] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: {
      sections: [{ subject: 'civilization' }, { subject: 'math' }],
      entries: [
        { unitId: 'civ.01', subject: 'civilization' },
        { unitId: 'math.01', subject: 'math' },
      ],
    } });
    render(<AgendaStatusBoard kids={[{ id: 'learner1', name: 'Learner One' }]} day="2026-08-24" />);
    await waitFor(() => expect(screen.getByTestId('agenda-status-board')).toBeTruthy());
    const row = screen.getByTestId('agenda-status-board').querySelector('.school-status-board__row');
    expect(row.dataset.complete).toBe('true');
    // The chip stands IN PLACE OF "2 of 2" — a reader should not have to
    // compare two numbers to learn the one thing that matters.
    expect(screen.getByText('Done for the day')).toBeTruthy();
    expect(screen.queryByText('2 of 2')).toBeNull();
  });

  it('turns a failed scan yellow without the card going complete', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [
      { learnerId: 'learner1', sessions: [
        { unitId: 'civ.01', subject: 'civilization', outcome: { result: 'passed' } },
        { unitId: 'math.01', subject: 'math', outcome: { result: 'needs_remediation' } },
      ] },
    ] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: {
      sections: [{ subject: 'civilization' }, { subject: 'math' }],
      entries: [],
    } });
    render(<AgendaStatusBoard kids={[{ id: 'learner1', name: 'Learner One' }]} day="2026-08-24" />);
    await waitFor(() => expect(screen.getByText('1 of 2')).toBeTruthy());

    const board = screen.getByTestId('agenda-status-board');
    expect(board.querySelectorAll('[data-state="passed"]').length).toBe(1);
    expect(board.querySelectorAll('[data-state="needs-retry"]').length).toBe(1);
    const row = board.querySelector('.school-status-board__row');
    expect(row.dataset.complete).toBe('false');
    // No score anywhere on the panel — that number lives on the printout.
    expect(board.textContent).not.toMatch(/\d+%/);
  });

  it('every segment draws a subject icon and states its subject and state by name', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [
      { learnerId: 'learner1', sessions: [
        { unitId: 'civ.01', subject: 'civilization', outcome: { result: 'passed' } },
      ] },
    ] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: {
      sections: [
        { subject: 'civilization', next: { unitId: 'civ.01' } },
        { subject: 'math', next: { unitId: 'math.01' } },
        { subject: 'reading', next: { unitId: 'read.01' } },
      ],
      entries: [
        { unitId: 'civ.01', subject: 'civilization' },
        { unitId: 'math.01', subject: 'math' },
        { unitId: 'read.01', subject: 'reading' },
      ],
    } });
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

describe('a scan updates the board immediately', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsHandlers.length = 0;
    schoolApi.measuresWeekly.mockResolvedValue({ ok: false, status: 0, data: null });
  });

  it('subscribes to the omr topic', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: { sections: [], entries: [] } });
    render(<AgendaStatusBoard kids={KIDS} day="2026-08-26" />);
    await waitFor(() => expect(wsHandlers.some((h) => h.topic === 'omr')).toBe(true));
  });

  it('re-reads on a scan, so the disc turns without waiting out the poll', async () => {
    // Before the scan: one pending assignment.
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [
      { learnerId: 'learner1', sessions: [{ unitId: 'm.01', subject: 'math', outcome: null }] },
    ] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: { sections: [{ subject: 'math' }], entries: [] } });

    render(<AgendaStatusBoard kids={[{ id: 'learner1', name: 'Learner One' }]} day="2026-08-26" />);
    await waitFor(() => expect(screen.getByText('0 of 1')).toBeTruthy());

    // The scan lands; the SAME endpoints now report it passed.
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [
      { learnerId: 'learner1', sessions: [{ unitId: 'm.01', subject: 'math', outcome: { result: 'passed' } }] },
    ] } });
    const omr = wsHandlers.find((h) => h.topic === 'omr');
    omr.cb({ event: 'scan-graded', learnerId: 'learner1', result: 'passed', percent: 100 });

    // The chip appears without any timer advancing.
    await waitFor(() => expect(screen.getByText('Done for the day')).toBeTruthy());
  });

  it('ignores traffic on the topic that is not a scan', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: { sections: [], entries: [] } });
    render(<AgendaStatusBoard kids={KIDS} day="2026-08-26" />);
    await waitFor(() => expect(wsHandlers.some((h) => h.topic === 'omr')).toBe(true));

    const calls = schoolApi.teacherDay.mock.calls.length;
    wsHandlers.find((h) => h.topic === 'omr').cb({ event: 'reader-heartbeat' });
    expect(schoolApi.teacherDay.mock.calls.length).toBe(calls);
  });
});
