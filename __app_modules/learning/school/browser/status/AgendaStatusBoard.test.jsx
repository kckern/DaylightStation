import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass';
import AgendaStatusBoard from "./AgendaStatusBoard.jsx";
import { dayStatus, summarize, ringsByLearner, ringProgressByLearner, triangleRows, earningsByLearner } from "./agendaStatusModel.js";

vi.mock("../schoolApi.js", () => ({
  schoolApi: { agendaPreview: vi.fn(), teacherDay: vi.fn(), stateGates: vi.fn(), earningsRoster: vi.fn(), wallet: vi.fn() },
}));
// Capture the board's `omr` handler so a scan can be delivered to it directly.
// The board must not wait out its five-minute poll to show a disc turning.
const wsHandlers = [];
vi.mock("../../../../../frontend/src/hooks/useWebSocket.js", () => ({
  useWebSocketSubscription: (topic, cb) => { wsHandlers.push({ topic, cb }); },
}));
import { schoolApi } from "../schoolApi.js";
import { schoolLog } from "../schoolLog.js";
import { hasIcon } from "../home/icons/iconRegistry.js";

// jsdom has no layout: what the stylesheet promises about sizing is pinned by
// reading the compiled rule (the Keypad tests' pattern).
const schoolStylesheet = sass.compile(
  fileURLToPath(new URL("../School.scss", import.meta.url)),
).css.replace(/\s+/g, ' ');
const styleRule = (selector) => schoolStylesheet.match(
  new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`),
)?.[1] ?? '';

const KIDS = [{ id: 'learner1', name: 'Learner One' }, { id: 'learner2', name: 'Learner Two' }];
const ringGate = (learnerId, current, startsAt = 0, endsAt = 4_102_444_800_000) => ({
  evaluation: {
    gateId: 'fitness.weekly-rings', subject: { kind: 'learner', id: learnerId },
    period: { kind: 'interval', id: 'fitness-week:2026-08-30:2026-09-05', startsAt, endsAt },
    progress: { current, target: 1, unit: 'rings' },
  },
});

// The board paints from a localStorage snapshot; one test's board must not
// seed the next.
beforeEach(() => { localStorage.clear(); });

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
      { unitId: 'c', subject: 'math', state: 'created', outcome: null },
    ];
    const summary = summarize([{ subject: 'math' }], sessions);
    expect(summary.segments.map((s) => s.state)).toEqual(['passed', 'needs-retry', 'pending']);
    // Only a pass counts toward done — a yellow disc is outstanding work.
    expect(summary.done).toBe(1);
  });

  // 2026-09-09, from the wall: a learner typed a code, printed a scripture
  // sheet, walked back to the board — and the disc was still the grey it had
  // been before they started. A session with no outcome used to read exactly
  // like work never begun.
  it('turns a disc amber once the child has actually started it', () => {
    const started = (state) => summarize([{ subject: 'scripture' }],
      [{ unitId: 'cfm.d2', subject: 'scripture', state, outcome: null }]).segments[0].state;
    expect(started('issued')).toBe('in-progress');
    expect(started('reprinted')).toBe('in-progress');
    expect(started('submitted')).toBe('in-progress');
    expect(started('graded')).toBe('in-progress');
    expect(started('media_dispatched')).toBe('in-progress');
  });

  it('leaves a disc grey for the states that are not the child doing anything', () => {
    const notStarted = (state) => summarize([{ subject: 'math' }],
      [{ unitId: 'm.1', subject: 'math', state, outcome: null }]).segments[0].state;
    // PRINTING THE AGENDA creates sessions. If `created` went amber, a child's
    // whole day would turn yellow the moment their agenda came off the printer.
    expect(notStarted('created')).toBe('pending');
    expect(notStarted('abandoned')).toBe('pending');
    expect(notStarted('failed')).toBe('pending');
    expect(notStarted(undefined)).toBe('pending');
  });

  it('an open remediation outranks the needs-retry it came from', () => {
    const sessions = [
      { unitId: 'a', subject: 'math', state: 'outcome_recorded', outcome: { result: 'needs_remediation' } },
      { unitId: 'a', subject: 'math', state: 'issued', outcome: null },
    ];
    // Same colour either way; this decides what the disc is CALLED.
    expect(summarize([{ subject: 'math' }], sessions).segments[0].state).toBe('in-progress');
  });

  it('a started sheet is still outstanding work, never counted as done', () => {
    const summary = summarize([{ subject: 'scripture' }],
      [{ unitId: 'cfm.d2', subject: 'scripture', state: 'issued', outcome: null }]);
    expect(summary).toMatchObject({ total: 1, done: 0 });
  });

  it('keeps one story-time disc gray, amber, then green for 0/2, 1/2, 2/2', () => {
    const entry = { unitId: 'story-time:daily', subject: 'english' };
    const at = (completed) => summarize([{
      subject: 'english',
      next: { unitId: 'story-time:daily', obligationProgress: { completed, total: 2 } },
    }], [], [entry]);
    const done = summarize([{
      subject: 'english',
      servedWork: [{ unitId: 'story-time:daily', title: 'Story time' }],
    }], [], [entry]);

    expect(at(0)).toMatchObject({ total: 1, done: 0, segments: [{ state: 'pending' }] });
    expect(at(1)).toMatchObject({ total: 1, done: 0, segments: [{ state: 'in-progress' }] });
    expect(done).toMatchObject({ total: 1, done: 1, segments: [{ state: 'passed' }] });
  });

  it('does not infer obligation progress from a display label', () => {
    const summary = summarize([{
      subject: 'english', progressLabel: '1 of 2 stories', next: { unitId: 'story-time:daily' },
    }], [], [{ unitId: 'story-time:daily', subject: 'english' }]);
    expect(summary.segments[0].state).toBe('pending');
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

  it('does not count an excused Sunday offer as required Today work', () => {
    const sections = [
      { subject: 'civilization', servedToday: true },
      {
        subject: 'math',
        next: { unitId: 'math.01' },
        obligation: { state: 'excused', reason: 'not_a_school_day' },
      },
    ];
    const sessions = [{ unitId: 'atlas.kansas', subject: 'civilization', outcome: { result: 'passed' } }];
    const summary = summarize(sections, sessions, [{ unitId: 'math.01', subject: 'math' }]);

    expect(summary).toMatchObject({ total: 1, done: 1 });
    expect(summary.segments.map((segment) => segment.unitId)).toEqual(['atlas.kansas']);
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

  it('draws a disc for SERVED work that never opened a session — the piano case', () => {
    // Regression, 2026-08-26. Piano is a PROGRAM subject: it is served inside
    // its own app, so it finishes with no session row and no OMR outcome, and
    // only `servedWork` ever records it. User_4 was served four things that day
    // and the board could see three, reading "2 OF 3" for a 3-of-4 day.
    const sections = [
      {
        subject: 'civilization', servedToday: true,
        servedWork: [{ unitId: 'atlas.ohio', assignmentUnitId: 'atlas.ohio' }],
      },
      {
        subject: 'arts', servedToday: true,
        servedWork: [{ unitId: 'plex:676040', assignmentUnitId: 'piano-course:plex:675689' }],
      },
    ];
    const sessions = [{ unitId: 'atlas.ohio', subject: 'civilization', outcome: { result: 'passed' } }];
    const summary = summarize(sections, sessions);
    expect(summary.segments.map((s) => s.unitId).sort()).toEqual(['atlas.ohio', 'piano-course:plex:675689']);
    expect(summary.total).toBe(2);
    expect(summary.done).toBe(2);
  });

  it('keeps one assigned piano disc and badges seven extra lessons', () => {
    const assignmentUnitId = 'piano-course:plex:675689';
    const servedWork = Array.from({ length: 8 }, (_, index) => ({
      unitId: `plex:lesson-${index + 1}`, assignmentUnitId,
    }));
    const summary = summarize([{ subject: 'arts', servedToday: true, servedWork }], []);

    expect(summary).toEqual({
      total: 1,
      done: 1,
      segments: [{
        unitId: assignmentUnitId,
        subject: 'arts',
        label: 'Arts & Culture',
        state: 'passed',
        extraCount: 7,
      }],
      restDay: null,
    });
  });

  it('keeps same-subject program assignments separate and counts their own overflow', () => {
    const summary = summarize([{
      subject: 'arts', servedToday: true, servedWork: [
        { unitId: 'lesson-a1', assignmentUnitId: 'piano-course:a' },
        { unitId: 'lesson-b1', assignmentUnitId: 'piano-course:b' },
        { unitId: 'lesson-b2', assignmentUnitId: 'piano-course:b' },
        { unitId: 'lesson-b3', assignmentUnitId: 'piano-course:b' },
      ],
    }], []);

    expect(summary.total).toBe(2);
    expect(summary.done).toBe(2);
    expect(summary.segments.map(({ unitId, extraCount }) => ({ unitId, extraCount }))).toEqual([
      { unitId: 'piano-course:a', extraCount: undefined },
      { unitId: 'piano-course:b', extraCount: 2 },
    ]);
  });

  it('deduplicates repeated completion rows before calculating the badge', () => {
    const assignmentUnitId = 'piano-course:plex:675689';
    const summary = summarize([{
      subject: 'arts', servedToday: true, servedWork: [
        { unitId: 'lesson-1', assignmentUnitId },
        { unitId: 'lesson-1', assignmentUnitId },
        { unitId: 'lesson-2', assignmentUnitId },
      ],
    }], []);

    expect(summary.segments).toHaveLength(1);
    expect(summary.segments[0].extraCount).toBe(1);
  });

  it('lets an open sheet stay pending even though the planner calls it served', () => {
    // The other half of the same change, and the reason servedWork cannot just
    // paint everything green: a partial scan the grader refused to bridge is
    // still SERVED by the planner's reckoning, but the child is not done with
    // it. Evidence runs first and wins.
    const sections = [{
      subject: 'scripture',
      servedToday: true,
      servedWork: [{ unitId: 'cfm.d2' }, { unitId: 'cfm.d3' }],
    }];
    const sessions = [
      { unitId: 'cfm.d2', subject: 'scripture', outcome: { result: 'passed' } },
      { unitId: 'cfm.d3', subject: 'scripture', outcome: null },
    ];
    const summary = summarize(sections, sessions);
    expect(summary.total).toBe(2);
    expect(summary.done).toBe(1);
    expect(summary.segments.find((s) => s.unitId === 'cfm.d3').state).toBe('pending');
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

describe('triangleRows', () => {
  it('matches the design table, base at the bottom, capped at three rows', () => {
    const table = { 0: [], 1: [1], 2: [2], 3: [1, 2], 4: [1, 3], 5: [2, 3], 6: [1, 2, 3], 7: [3, 4], 8: [1, 3, 4], 9: [2, 3, 4], 10: [1, 4, 5], 12: [3, 4, 5] };
    for (const [n, rows] of Object.entries(table)) expect(triangleRows(Number(n))).toEqual(rows);
    expect(triangleRows(-1)).toEqual([]);
    expect(triangleRows(2.5)).toEqual([]);
  });
});

describe('ringProgressByLearner', () => {
  it('carries the count and only a real target — a gte-1 gate has none', () => {
    expect(ringProgressByLearner({ items: [ringGate('user_4', 40, 500, 1500)] }, 1000)).toEqual({ user_4: { current: 40, target: null } });
    const goal = ringGate('user_4', 3, 500, 1500);
    goal.evaluation.progress.target = 5;
    expect(ringProgressByLearner({ items: [goal] }, 1000)).toEqual({ user_4: { current: 3, target: 5 } });
  });
});

describe('ringsByLearner', () => {
  it('picks current ring progress out of active State Gate evaluations', () => {
    expect(ringsByLearner({
      items: [ringGate('user_4', 40, 500, 1500), ringGate('user_3', 0, 500, 1500)],
    }, 1000)).toEqual({ user_4: 40, user_3: 0 });
  });

  it('omits missing progress rather than showing a false zero', () => {
    // null means "we could not find out". Rendering it as 0 would state that
    // the child did no exercise, which is a different and possibly wrong claim.
    expect(ringsByLearner({
      items: [{ ...ringGate('user_4', 2, 500, 1500), evaluation: { ...ringGate('user_4', 2, 500, 1500).evaluation, progress: null } }],
    }, 1000)).toEqual({});
  });

  it('ignores inactive or unrelated gates and survives an empty payload', () => {
    expect(ringsByLearner({
      items: [
        ringGate('old', 9, 0, 500),
        { evaluation: { ...ringGate('other', 9, 500, 1500).evaluation, gateId: 'something.else' } },
      ],
    }, 1000)).toEqual({});
    expect(ringsByLearner(null)).toEqual({});
  });
});

describe('AgendaStatusBoard render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no ring data. Individual tests opt in.
    schoolApi.stateGates.mockResolvedValue({ ok: false, status: 0, data: null });
  });

  it('shows a ring count when the State Gates read lands', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: { sections: [{ subject: 'math', next: { unitId: 'math.01' } }],
      entries: [{ unitId: 'math.01', subject: 'math' }] } });
    schoolApi.stateGates.mockResolvedValue({ ok: true, status: 200, data: {
      items: [ringGate('learner1', 42)],
    } });

    render(<AgendaStatusBoard kids={KIDS} day="2026-08-26" />);
    await waitFor(() => expect(screen.getByText('42')).toBeTruthy());
    // learner2 has no ring row, so no number is invented for them.
    expect(screen.queryByText('0')).toBeNull();
  });

  it('still renders the day when the State Gates read fails — rings are additive', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: { sections: [{ subject: 'math', next: { unitId: 'math.01' } }],
      entries: [{ unitId: 'math.01', subject: 'math' }] } });
    schoolApi.stateGates.mockResolvedValue({ ok: false, status: 500, data: null });

    render(<AgendaStatusBoard kids={KIDS} day="2026-08-26" />);
    await waitFor(() => expect(screen.getAllByLabelText('0 of 1 done').length).toBe(2));
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
    await waitFor(() => {
      expect(screen.getByLabelText('1 of 3 done')).toBeTruthy();
      expect(screen.getByLabelText('0 of 3 done')).toBeTruthy();
    });
    // ONE readout per card, in the corner. The status WORD used to sit there
    // with the count repeated under the discs — two lines for one fact, and
    // the word said nothing the filled discs did not already show.
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
  it('flags a fully cleared day, with one check mark and no DONE words', async () => {
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
    // WAIT ON THE THING BEING ASSERTED, not on the board existing. The board
    // renders as soon as it has rows — `loading` ones included — and this test
    // needs TWO independent fetches to have landed. Waiting for the element
    // and then reading `data-complete` synchronously left a window where a
    // still-loading row was read as not-complete; it opened wide enough to
    // fail under a full parallel suite run and never alone, which is what a
    // flake looks like from the outside.
    const row = await waitFor(() => {
      const el = screen.getByTestId('agenda-status-board').querySelector('.school-status-board__row');
      expect(el?.dataset.complete).toBe('true');
      return el;
    });
    expect(row.dataset.complete).toBe('true');
    // At 100% the count gives way to one check mark (no words): the row is
    // green end to end — nameplate, card, every disc — and a "DONE" chip would
    // be a third statement of the same fact.
    expect(screen.getByTestId('board-day-done')).toBeTruthy();
    expect(screen.queryByText(/^Done$/i)).toBeNull();
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
    await waitFor(() => expect(screen.getByLabelText('1 of 2 done')).toBeTruthy());

    const board = screen.getByTestId('agenda-status-board');
    expect(board.querySelectorAll('[data-state="passed"]').length).toBe(1);
    expect(board.querySelectorAll('[data-state="needs-retry"]').length).toBe(1);
    const row = board.querySelector('.school-status-board__row');
    expect(row.dataset.complete).toBe('false');
    // No score anywhere on the panel — that number lives on the printout.
    expect(board.textContent).not.toMatch(/\d+%/);
  });

  it('renders partial program progress amber with accessible in-progress wording', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: {
      sections: [{
        subject: 'english',
        next: { unitId: 'story-time:daily', obligationProgress: { completed: 1, total: 2 } },
      }],
      entries: [{ unitId: 'story-time:daily', subject: 'english' }],
    } });
    render(<AgendaStatusBoard kids={[{ id: 'learner1', name: 'Learner One' }]} day="2026-08-24" />);
    await waitFor(() => expect(screen.getByLabelText('0 of 1 done')).toBeTruthy());

    const board = screen.getByTestId('agenda-status-board');
    expect(board.querySelectorAll('[data-state="in-progress"]')).toHaveLength(1);
    expect(screen.getByLabelText('English & Literature: in progress')).toBeTruthy();
  });

  it('renders program overflow as one accessible assignment disc with a badge', async () => {
    const assignmentUnitId = 'piano-course:plex:675689';
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: {
      sections: [{
        subject: 'arts', servedToday: true,
        servedWork: Array.from({ length: 8 }, (_, index) => ({
          unitId: `plex:lesson-${index + 1}`, assignmentUnitId,
        })),
      }],
      entries: [{ unitId: assignmentUnitId, subject: 'arts', program: 'piano-course' }],
    } });

    render(<AgendaStatusBoard kids={[{ id: 'learner1', name: 'Learner One' }]} day="2026-08-24" />);
    await waitFor(() => expect(screen.getByText('+7')).toBeTruthy());

    const board = screen.getByTestId('agenda-status-board');
    const pills = board.querySelector('.school-status-board__pills');
    expect(pills.querySelectorAll('.school-status-board__pill')).toHaveLength(1);
    expect(screen.getByLabelText('Arts & Culture: done, 7 extra items completed')).toBeTruthy();
    expect(board.querySelector('.school-status-board__extra').getAttribute('aria-hidden')).toBe('true');
    expect(board.querySelector('.school-status-board__row').dataset.complete).toBe('true');
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
    await waitFor(() => expect(screen.getByLabelText('1 of 3 done')).toBeTruthy());

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
    expect(screen.getByTestId('agenda-status-board').querySelector('.school-status-board__extra')).toBeNull();
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
    schoolApi.stateGates.mockResolvedValue({ ok: false, status: 0, data: null });
  });

  it('subscribes to the omr topic', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: { sections: [], entries: [] } });
    render(<AgendaStatusBoard kids={KIDS} day="2026-08-26" />);
    await waitFor(() => expect(wsHandlers.some((h) => h.topic === 'omr')).toBe(true));
    expect(wsHandlers.some((h) => h.topic === 'school')).toBe(true);
    expect(wsHandlers.some((h) => h.topic === 'state-gates')).toBe(true);
  });

  it('re-reads ring progress immediately on a fitness State Gates observation', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: {
      sections: [{ subject: 'math', next: { unitId: 'm.01' } }],
      entries: [{ unitId: 'm.01', subject: 'math' }],
    } });
    render(<AgendaStatusBoard kids={[{ id: 'learner1', name: 'Learner One' }]} day="2026-08-26" />);
    await waitFor(() => expect(wsHandlers.some((h) => h.topic === 'state-gates')).toBe(true));
    const before = schoolApi.stateGates.mock.calls.length;
    wsHandlers.find((h) => h.topic === 'state-gates').cb({
      kind: 'StateObservation',
      payload: { current: { gateId: 'fitness.weekly-rings', subject: { kind: 'learner', id: 'learner1' } } },
    });
    await waitFor(() => expect(schoolApi.stateGates.mock.calls.length).toBeGreaterThan(before));
  });

  it('re-reads on a scan, so the disc turns without waiting out the poll', async () => {
    // Before the scan: one pending assignment.
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [
      { learnerId: 'learner1', sessions: [{ unitId: 'm.01', subject: 'math', outcome: null }] },
    ] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: { sections: [{ subject: 'math' }], entries: [] } });

    render(<AgendaStatusBoard kids={[{ id: 'learner1', name: 'Learner One' }]} day="2026-08-26" />);
    await waitFor(() => expect(screen.getByLabelText('0 of 1 done')).toBeTruthy());

    // The scan lands; the SAME endpoints now report it passed.
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [
      { learnerId: 'learner1', sessions: [{ unitId: 'm.01', subject: 'math', outcome: { result: 'passed' } }] },
    ] } });
    const omr = wsHandlers.find((h) => h.topic === 'omr');
    omr.cb({ event: 'scan-graded', learnerId: 'learner1', result: 'passed', percent: 100 });

    // The card goes complete without any timer advancing.
    await waitFor(() => expect(
      document.querySelector('.school-status-board__row').dataset.complete,
    ).toBe('true'));
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

  it.each(['story-read', 'piano-lesson-complete', 'program-day-bypass-changed', 'session-grade-changed'])(
    're-reads immediately on a relevant %s event for a displayed learner',
    async (event) => {
      schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [] } });
      schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: {
        sections: [{ subject: 'math', next: { unitId: 'm.01' } }],
        entries: [{ unitId: 'm.01', subject: 'math' }],
      } });
      render(<AgendaStatusBoard kids={[{ id: 'learner1', name: 'Learner One' }]} day="2026-08-26" />);
      await waitFor(() => expect(screen.getByLabelText('0 of 1 done')).toBeTruthy());
      const before = schoolApi.teacherDay.mock.calls.length;

      wsHandlers.find((h) => h.topic === 'school').cb({
        event, learnerId: 'learner1', studyDay: '2026-08-26', studyDate: '2026-08-26',
      });

      await waitFor(() => expect(schoolApi.teacherDay.mock.calls.length).toBeGreaterThan(before));
    },
  );

  it('ignores story events outside the displayed roster, from another study day, and unrelated traffic', async () => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: {
      sections: [{ subject: 'math', next: { unitId: 'm.01' } }],
      entries: [{ unitId: 'm.01', subject: 'math' }],
    } });
    render(<AgendaStatusBoard kids={[{ id: 'learner1', name: 'Learner One' }]} day="2026-08-26" />);
    await waitFor(() => expect(screen.getByLabelText('0 of 1 done')).toBeTruthy());
    const school = wsHandlers.find((h) => h.topic === 'school');
    const before = schoolApi.teacherDay.mock.calls.length;

    school.cb({ event: 'story-read', learnerId: 'learner2', studyDay: '2026-08-26' });
    school.cb({ event: 'story-read', learnerId: 'learner1', studyDay: '2026-08-25' });
    school.cb({ event: 'reader-heartbeat', learnerId: 'learner1', studyDay: '2026-08-26' });

    expect(schoolApi.teacherDay.mock.calls.length).toBe(before);
  });
});


const READING_ACTIVITY = { status: 'ok', studyDay: '2026-09-07', hasActivity: true, progressCount: 3, finishedCount: 2, bookCount: 2 };
describe('independent reading acknowledgment', () => {
  it('adds one supplemental circle without changing required counts or day completion', () => {
    expect(summarize([], [], [], READING_ACTIVITY)).toMatchObject({ total: 0, done: 0, segments: [
      { supplemental: true, programId: 'book-log', label: 'Reading', state: 'passed', unitId: 'book-log:activity:2026-09-07' },
    ] });
    expect(dayStatus(summarize([], [], [], READING_ACTIVITY))).toBeNull();
  });
  it('leaves Story time pending despite shared English subject', () => {
    const summary = summarize([{ subject: 'english', next: { unitId: 'story-time:daily' } }], [],
      [{ unitId: 'story-time:daily', subject: 'english', program: 'story-time' }], READING_ACTIVITY);
    expect(summary).toMatchObject({ total: 1, done: 0, segments: [
      { label: 'Story time', state: 'pending' }, { label: 'Reading', supplemental: true, state: 'passed' },
    ] });
  });
  it.each([null, { status: 'unavailable', hasActivity: true }, { ...READING_ACTIVITY, hasActivity: false }])('invents no credit without authoritative activity: %j', activity => {
    expect(summarize([], [], [], activity).segments).toEqual([]);
  });
  it('keeps actual/target required reading partial and independently acknowledges activity', () => {
    const summary = summarize([{ subject: 'english', next: { unitId: 'book-log:shelf', obligationProgress: { actual: 5, target: 20, met: false, metric: 'pages' } } }], [],
      [{ unitId: 'book-log:shelf', program: 'book-log', subject: 'english' }], READING_ACTIVITY);
    expect(summary).toMatchObject({ total: 1, done: 0, segments: [
      { programId: 'book-log', state: 'in-progress' }, { supplemental: true, state: 'passed' },
    ] });
  });
  it('avoids redundant supplemental credit for completed required reading', () => {
    const summary = summarize([{ subject: 'english', servedWork: [{ unitId: 'book-log:shelf', title: 'Reading' }] }], [],
      [{ unitId: 'book-log:shelf', program: 'book-log', subject: 'english' }], READING_ACTIVITY);
    expect(summary).toMatchObject({ total: 1, done: 1, segments: [{ programId: 'book-log', label: 'Reading', state: 'passed' }] });
    expect(summary.segments).toHaveLength(1);
  });
});

const FITNESS_ACTIVITY = { status: 'ok', studyDay: '2026-09-07', hasActivity: true, rings: 3, sessionCount: 1 };
describe('physical education acknowledgment', () => {
  it('adds one supplemental circle without changing required counts or day completion', () => {
    expect(summarize([], [], [], null, FITNESS_ACTIVITY)).toMatchObject({ total: 0, done: 0, segments: [
      { supplemental: true, programId: 'fitness', subject: 'physical-education', label: 'Fitness', state: 'passed', unitId: 'fitness:activity:2026-09-07' },
    ] });
    expect(dayStatus(summarize([], [], [], null, FITNESS_ACTIVITY))).toBeNull();
  });
  it('cannot finish a day of school work on a workout alone', () => {
    const summary = summarize([{ subject: 'math', next: { unitId: 'math:1' } }], [], [], null, FITNESS_ACTIVITY);
    expect(summary).toMatchObject({ total: 1, done: 0, segments: [
      { subject: 'math', state: 'pending' }, { subject: 'physical-education', supplemental: true, state: 'passed' },
    ] });
    expect(dayStatus(summary)).toBe('Not started');
  });
  it('rides alongside a cleared day without inflating it', () => {
    const summary = summarize([{ subject: 'math', servedWork: [{ unitId: 'math:1' }] }], [], [], null, FITNESS_ACTIVITY);
    expect(summary).toMatchObject({ total: 1, done: 1 });
    expect(summary.segments).toHaveLength(2);
    expect(dayStatus(summary)).toBe('Done for the day');
  });
  it.each([null, { status: 'unavailable', hasActivity: true }, { ...FITNESS_ACTIVITY, hasActivity: false }, { ...FITNESS_ACTIVITY, studyDay: null }])('invents no credit without authoritative activity: %j', activity => {
    expect(summarize([], [], [], null, activity).segments).toEqual([]);
  });
  it('acknowledges reading and physical education independently', () => {
    expect(summarize([], [], [], READING_ACTIVITY, FITNESS_ACTIVITY)).toMatchObject({ total: 0, done: 0, segments: [
      { programId: 'book-log', label: 'Reading' }, { programId: 'fitness', label: 'Fitness' },
    ] });
  });
});

describe('rest day', () => {
  const off = (subject, next = { unitId: `${subject}.next` }) => ({
    subject, next, obligation: { state: 'excused', reason: 'not_a_school_day' },
  });

  it('marks a day where every section is excused as not_a_school_day', () => {
    const summary = summarize([off('math'), off('language')], []);
    expect(summary.total).toBe(0);
    expect(summary.segments).toEqual([]);
    expect(summary.restDay).toEqual({ optionalCount: 2 });
  });

  it('still counts it as a rest day beside optional_backlog / elective_only sections', () => {
    // The real 2026-09-26 shape: scripture was optional_backlog, science elective_only.
    const summary = summarize([
      off('math'),
      { subject: 'scripture', next: { unitId: 'cfm.1' }, obligation: { state: 'excused', reason: 'optional_backlog' } },
      { subject: 'science', next: { unitId: 'sci.1' }, obligation: { state: 'excused', reason: 'elective_only' } },
    ], []);
    // Every offered lesson counts toward the hint: the scan prints them all.
    expect(summary.restDay).toEqual({ optionalCount: 3 });
  });

  it('keeps the hint on a holiday whose only offer is an optional_backlog lesson', () => {
    const summary = summarize([
      off('math', null),
      { subject: 'scripture', next: { unitId: 'cfm.1' }, obligation: { state: 'excused', reason: 'optional_backlog' } },
    ], []);
    expect(summary.restDay).toEqual({ optionalCount: 1 });
  });

  it('is not a rest day when any section is still obligated', () => {
    const summary = summarize([off('math'), { subject: 'language', next: { unitId: 'fc.1' }, obligation: { state: 'obligated' } }], []);
    expect(summary.restDay).toBeNull();
    expect(summary.total).toBe(1);
  });

  it('is not a rest day when nothing is excused as not_a_school_day', () => {
    const summary = summarize([
      { subject: 'scripture', next: { unitId: 'cfm.1' }, obligation: { state: 'excused', reason: 'optional_backlog' } },
      { subject: 'math', next: { unitId: 'm.1' }, obligation: { state: 'excused', reason: 'suppressed_by_focus' } },
    ], []);
    expect(summary.restDay).toBeNull();
  });

  it('is not a rest day with no sections at all (plan failed or empty)', () => {
    expect(summarize([], []).restDay).toBeNull();
    expect(summarize(undefined, undefined).restDay).toBeNull();
  });

  it('ignores suppressed sections when deciding', () => {
    const summary = summarize([off('math'), { subject: 'art', suppressed: 'focus', obligation: { state: 'obligated' } }], []);
    expect(summary.restDay).toEqual({ optionalCount: 1 });
  });

  it('reports zero optional work on a holiday with nothing offered', () => {
    const summary = summarize([off('math', null), off('language', {})], []);
    expect(summary.restDay).toEqual({ optionalCount: 0 });
  });

  it('keeps drawing work the child already did on a rest day', () => {
    const summary = summarize([off('language', { unitId: 'fc.1' })],
      [{ unitId: 'fc.1', subject: 'language', state: 'issued', outcome: null }]);
    expect(summary.segments.map((s) => s.state)).toEqual(['in-progress']);
    expect(summary.total).toBe(1);
    expect(summary.restDay).toEqual({ optionalCount: 1 });
  });

  it('survives a JSON round-trip (the board caches summaries in localStorage)', () => {
    const summary = summarize([off('math')], []);
    expect(JSON.parse(JSON.stringify(summary)).restDay).toEqual({ optionalCount: 1 });
  });
});

describe('persisted reading on the board', () => {
  const kids = [KIDS[0]];
  const digest = (activity = READING_ACTIVITY) => ({ ok: true, data: { studyDay: '2026-09-07', learners: [{ learnerId: 'learner1', sessions: [], readingActivity: activity }] } });
  beforeEach(() => {
    vi.clearAllMocks(); wsHandlers.length = 0;
    schoolApi.stateGates.mockResolvedValue({ ok: false });
    schoolApi.teacherDay.mockResolvedValue(digest());
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: { sections: [], entries: [] } });
  });
  it.each([false, true])('renders optional Reading with no required assignments, plan failed=%s', async failed => {
    if (failed) schoolApi.agendaPreview.mockRejectedValue(new Error('offline'));
    render(<AgendaStatusBoard kids={kids} day="2026-09-07" />);
    expect(await screen.findByRole('img', { name: 'Reading: done, 2 books, 2 finishes, 3 progress entries' })).toBeInTheDocument();
    expect(screen.queryByText('Done for the day')).toBeNull();
    expect(document.querySelector('[data-complete="true"]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('uses the server study day before the household boundary, not the browser date', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-08T09:00:00Z'));
    try {
      render(<AgendaStatusBoard kids={kids} />);
      expect(await screen.findByRole('img', { name: 'Reading: done, 2 books, 2 finishes, 3 progress entries' })).toBeInTheDocument();
      expect(schoolApi.teacherDay).toHaveBeenCalledWith();
      expect(schoolApi.agendaPreview).toHaveBeenCalledWith('learner1', '2026-09-07');
      const count = schoolApi.teacherDay.mock.calls.length;
      await act(async () => wsHandlers.filter(h => h.topic === 'school').at(-1).cb({ event: 'story-read', learnerId: 'learner1', studyDay: '2026-09-07' }));
      expect(schoolApi.teacherDay.mock.calls.length).toBeGreaterThan(count);
    } finally { now.mockRestore(); }
  });
  it('rereads on book changes including backdated undo, ignores unrelated learners, and trusts only persisted evidence', async () => {
    schoolApi.teacherDay.mockResolvedValue(digest({ ...READING_ACTIVITY, hasActivity: false }));
    render(<AgendaStatusBoard kids={kids} day="2026-09-07" />);
    await screen.findByText('No plan to show');
    const send = payload => act(async () => wsHandlers.filter(h => h.topic === 'school').at(-1).cb(payload));
    const calls = schoolApi.teacherDay.mock.calls.length;
    await send({ event: 'book-log-changed', learnerId: 'outsider' });
    expect(schoolApi.teacherDay).toHaveBeenCalledTimes(calls);
    await send({ event: 'book-log-changed', learnerId: 'learner1', hasActivity: true });
    expect(schoolApi.teacherDay).toHaveBeenCalledTimes(calls + 1);
    expect(screen.queryByRole('img', { name: 'Reading: done, 2 books, 2 finishes, 3 progress entries' })).toBeNull();
    schoolApi.teacherDay.mockResolvedValue(digest());
    await send({ event: 'book-log-changed', learnerId: 'learner1' });
    expect(await screen.findByRole('img', { name: 'Reading: done, 2 books, 2 finishes, 3 progress entries' })).toBeInTheDocument();
    schoolApi.teacherDay.mockResolvedValue(digest({ ...READING_ACTIVITY, hasActivity: false }));
    await send({ event: 'book-log-changed', learnerId: 'learner1', studyDay: '2026-09-01', action: 'undo' });
    await waitFor(() => expect(screen.queryByRole('img', { name: 'Reading: done, 2 books, 2 finishes, 3 progress entries' })).toBeNull());
  });
});

describe('persisted physical education on the board', () => {
  const kids = [KIDS[0]];
  const digest = (activity = FITNESS_ACTIVITY) => ({ ok: true, data: { studyDay: '2026-09-07', learners: [{ learnerId: 'learner1', sessions: [], fitnessActivity: activity }] } });
  beforeEach(() => {
    vi.clearAllMocks(); wsHandlers.length = 0;
    schoolApi.stateGates.mockResolvedValue({ ok: false });
    schoolApi.teacherDay.mockResolvedValue(digest());
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: { sections: [], entries: [] } });
  });
  it('has a real subject icon of its own, not the missing-icon apple', () => {
    expect(hasIcon('physical-education')).toBe(true);
  });
  it('draws the workout disc and speaks the rings it took', async () => {
    render(<AgendaStatusBoard kids={kids} day="2026-09-07" />);
    expect(await screen.findByRole('img', { name: 'Fitness: done, 3 rings' })).toBeInTheDocument();
    expect(screen.queryByText('Done for the day')).toBeNull();
    expect(document.querySelector('[data-complete="true"]')).toBeNull();
  });
  it('draws the disc for a ride that scored nothing, and claims no rings for it', async () => {
    schoolApi.teacherDay.mockResolvedValue(digest({ ...FITNESS_ACTIVITY, rings: 0 }));
    render(<AgendaStatusBoard kids={kids} day="2026-09-07" />);
    expect(await screen.findByRole('img', { name: 'Fitness: done' })).toBeInTheDocument();
  });
  it('says one session in the singular', async () => {
    schoolApi.teacherDay.mockResolvedValue(digest({ ...FITNESS_ACTIVITY, rings: 1 }));
    render(<AgendaStatusBoard kids={kids} day="2026-09-07" />);
    expect(await screen.findByRole('img', { name: 'Fitness: done, 1 ring' })).toBeInTheDocument();
  });
  it('draws no disc at all on a day nobody worked out, rather than an empty one to fill', async () => {
    schoolApi.teacherDay.mockResolvedValue(digest({ status: 'ok', studyDay: '2026-09-07', hasActivity: false, rings: 0, sessionCount: 0 }));
    render(<AgendaStatusBoard kids={kids} day="2026-09-07" />);
    expect(await screen.findByText('No plan to show')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Fitness/ })).toBeNull();
    expect(document.querySelector('.school-status-board__pill')).toBeNull();
  });
});

describe('the four partitions', () => {
  const kids = [{ id: 'learner1', name: 'Learner One' }];
  const plan = (n) => ({ ok: true, status: 200, data: {
    sections: Array.from({ length: n }, (_, i) => ({ subject: 'math', next: { unitId: `m.${i}` } })),
    entries: [],
  } });
  const term = {
    ok: true, status: 200, data: {
      termId: '2026-fall', label: 'Fall 2026', from: '2026-09-01', to: '2026-09-13', today: '2026-09-09',
      days: [
        { studyDay: '2026-09-07', state: 'met' }, { studyDay: '2026-09-08', state: 'exempt' }, { studyDay: '2026-09-09', state: 'partial' },
      ],
      weeks: [{ weekId: '2026-08-31', state: 'exempt', asked: 0 }, { weekId: '2026-09-07', state: 'unknown', asked: 0 }],
    },
  };

  beforeEach(() => {
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [] } });
    schoolApi.stateGates.mockResolvedValue({ ok: false, status: 0, data: null });
  });

  it('packs seven assignments as pins in rows of 3 and 4, with how many are left beside them', async () => {
    schoolApi.agendaPreview.mockResolvedValue(plan(7));
    schoolApi.learnerTerm = vi.fn().mockResolvedValue(term);
    render(<AgendaStatusBoard kids={kids} day="2026-09-09" />);
    const count = await screen.findByTestId('board-day-count');
    const day = screen.getByTestId('board-day');
    const rows = day.querySelectorAll('.school-status-board__pills');
    expect([...rows].map((row) => row.querySelectorAll('.school-status-board__pill').length)).toEqual([3, 4]);
    expect(day.contains(count)).toBe(true);
    expect(count.parentElement.firstElementChild).toBe(count);
    // The pins sit in their own room beside the count, so their width is
    // measured against what is LEFT after the count, not the whole cell.
    const room = count.nextElementSibling;
    expect(room).toHaveClass('school-status-board__pins-room');
    expect(room.firstElementChild).toBe(day.querySelector('.school-status-board__pins'));
    expect(count.textContent).toBe('7');
    expect(count).toHaveAttribute('role', 'progressbar');
    expect(count).toHaveAttribute('aria-label', '0 of 7 done');
    expect(day.querySelector('.school-status-board__segment')).toBeNull();
  });

  it('a finished day shows one check mark instead of a count, and no DONE text', async () => {
    schoolApi.agendaPreview.mockResolvedValue(plan(2));
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [
      { learnerId: 'learner1', sessions: [
        { unitId: 'm.0', subject: 'math', outcome: { result: 'passed' } },
        { unitId: 'm.1', subject: 'math', outcome: { result: 'passed' } },
      ] },
    ] } });
    schoolApi.learnerTerm = vi.fn().mockResolvedValue(term);
    render(<AgendaStatusBoard kids={kids} day="2026-09-09" />);
    const done = await screen.findByTestId('board-day-done');
    expect(done).toHaveAttribute('aria-label', 'Done for the day');
    expect(done.querySelector('svg')).toBeTruthy();
    expect(screen.queryByTestId('board-day-count')).toBeNull();
    expect(screen.queryByText(/^Done$/i)).toBeNull();
    expect(done.closest('.school-status-board__row')).toHaveAttribute('data-complete', 'true');
  });

  it('a rest day keeps its copy, with no count and no check mark', async () => {
    const off = (subject) => ({
      subject, next: { unitId: `${subject}.next` }, obligation: { state: 'excused', reason: 'not_a_school_day' },
    });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: { sections: [off('math'), off('language')], entries: [] } });
    schoolApi.learnerTerm = vi.fn().mockResolvedValue(term);
    schoolApi.teacherDay.mockResolvedValue({ ok: true, data: { studyDay: '2026-09-26', learners: [{ learnerId: 'learner1', sessions: [] }] } });
    render(<AgendaStatusBoard kids={kids} />);
    expect(await screen.findByText('No school today')).toBeInTheDocument();
    expect(screen.queryByTestId('board-day-count')).toBeNull();
    expect(screen.queryByTestId('board-day-done')).toBeNull();
    // No count and no pins: no empty row standing above the copy.
    expect(screen.getByTestId('board-day').querySelector('.school-status-board__today')).toBeNull();
  });

  it('shows last week above this week, seven squares each, today outlined, no part titles', async () => {
    schoolApi.agendaPreview.mockResolvedValue(plan(1));
    schoolApi.learnerTerm = vi.fn().mockResolvedValue(term);
    render(<AgendaStatusBoard kids={kids} day="2026-09-09" />);
    const grid = await screen.findByTestId('board-days-grid');
    expect(grid.classList.contains('school-daygrid--weeks-as-rows')).toBe(true);
    const cells = [...grid.querySelectorAll('.school-daygrid__cell')];
    expect(cells).toHaveLength(14);
    // Row 1 is the week of 2026-08-31; row 2 is 2026-09-07 (today's week).
    expect(cells[0]).toHaveAttribute('data-day', '2026-08-31');
    expect(cells[7]).toHaveAttribute('data-day', '2026-09-07');
    expect(cells[7]).toHaveAttribute('data-state', 'met');
    expect(screen.getByTestId('board-days-today')).toHaveAttribute('data-day', '2026-09-09');
    expect(screen.getByTestId('board-days').querySelector('.school-status-board__week-letters').textContent).toBe('MTWTFSS');
    expect(screen.queryByText('This week')).toBeNull();
    expect(screen.queryByText('This term')).toBeNull();
    expect(screen.queryByTestId('board-term')).toBeNull();
  });

  it('last week before the term starts draws as blank squares, not a missing row', async () => {
    schoolApi.agendaPreview.mockResolvedValue(plan(1));
    const fresh = { ...term, data: { ...term.data, from: '2026-09-07', days: [{ studyDay: '2026-09-07', state: 'met' }] } };
    schoolApi.learnerTerm = vi.fn().mockResolvedValue(fresh);
    render(<AgendaStatusBoard kids={kids} day="2026-09-09" />);
    const grid = await screen.findByTestId('board-days-grid');
    const cells = [...grid.querySelectorAll('.school-daygrid__cell')];
    expect(cells).toHaveLength(14);
    // Last week (2026-08-31..09-06) has no verdicts at all: seven hollow squares.
    const lastWeek = cells.slice(0, 7);
    expect(lastWeek.map((c) => c.getAttribute('data-day'))).toEqual([
      '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06',
    ]);
    expect(lastWeek.every((c) => c.getAttribute('data-state') === 'unknown')).toBe(true);
  });

  it('a pinned past day shows that day\'s week and the one before', async () => {
    schoolApi.agendaPreview.mockResolvedValue(plan(1));
    // The term read is NOT pinned: its `today` is the real today (09-09), a
    // week after the pinned day. The board must anchor on the pinned day.
    expect(term.data.today).toBe('2026-09-09');
    schoolApi.learnerTerm = vi.fn().mockResolvedValue(term);
    render(<AgendaStatusBoard kids={kids} day="2026-09-02" />);
    const grid = await screen.findByTestId('board-days-grid');
    expect(grid.querySelector('.school-daygrid__cell')).toHaveAttribute('data-day', '2026-08-24');
    expect(screen.getByTestId('board-days-today')).toHaveAttribute('data-day', '2026-09-02');
  });

  it('the rings sit under the days with their icon, and a failed term read costs only the squares', async () => {
    schoolApi.agendaPreview.mockResolvedValue(plan(1));
    schoolApi.learnerTerm = vi.fn().mockRejectedValue(new Error('boom'));
    schoolApi.stateGates.mockResolvedValue({ ok: true, status: 200, data: { items: [ringGate('learner1', 42)] } });
    render(<AgendaStatusBoard kids={kids} day="2026-09-09" />);
    await waitFor(() => expect(screen.getByLabelText('42 rings this week')).toBeTruthy());
    expect(screen.getAllByTestId('board-days')[0].contains(screen.getByLabelText('42 rings this week'))).toBe(true);
    expect(screen.queryByTestId('board-days-grid')).toBeNull();
  });

  it('discs are inert marks by default — the Portal never gets a door', async () => {
    schoolApi.agendaPreview.mockResolvedValue(plan(2));
    schoolApi.learnerTerm = vi.fn().mockResolvedValue(term);
    render(<AgendaStatusBoard kids={kids} day="2026-09-09" />);
    await waitFor(() => expect(screen.getByLabelText('0 of 2 done')).toBeTruthy());
    expect(screen.getByTestId('agenda-status-board').querySelectorAll('button, a')).toHaveLength(0);
  });

  it('given a door, each disc is a button that hands back its learner and subject', async () => {
    schoolApi.agendaPreview.mockResolvedValue(plan(2));
    schoolApi.learnerTerm = vi.fn().mockResolvedValue(term);
    const onOpenSegment = vi.fn();
    render(<AgendaStatusBoard kids={kids} day="2026-09-09" onOpenSegment={onOpenSegment} />);
    await waitFor(() => expect(screen.getByLabelText('0 of 2 done')).toBeTruthy());
    const doors = screen.getAllByRole('button', { name: /^Open / });
    expect(doors).toHaveLength(2);
    fireEvent.click(doors[0]);
    expect(onOpenSegment).toHaveBeenCalledWith('learner1', expect.objectContaining({ subject: 'math' }));
  });

  // CSS rules asserted (jsdom cannot see layout). The pins size their disc
  // from `cqw`; inside the day cell that measured the whole cell, so the big
  // count beside the pins pushed a wide day out of the card. The room is an
  // INLINE-size container: `cqw` measures what is left after the count, while
  // `cqh` still resolves against the day cell (a size container).
  it('sizes the pins against the room left beside the count, not the whole cell', () => {
    const room = styleRule('.school-status-board__pins-room');
    expect(room).toContain('flex: 1 1 0');
    expect(room).toContain('min-width: 0');
    expect(room).toContain('container-type: inline-size');
    expect(styleRule('.school-status-board__today')).toContain('align-self: stretch');
    expect(styleRule('.school-status-board__day')).toContain('container-type: size');
  });

  // From the live render at 1920x1080: the pins centred in their room left
  // the count stranded far from its discs, and the day squares sat at their
  // 18px cap in a cell twice their width.
  it('keeps the pins against their count, and grows the day squares with the card', () => {
    expect(styleRule('.school-status-board__pins-room')).toContain('justify-content: flex-start');
    expect(styleRule('.school-status-board__two-weeks')).toContain('--grid-cell: clamp(10px, min(2.6vh, 1.6vw), 28px)');
  });

  it('hangs each +N after its own number, not at the end of the column', () => {
    expect(styleRule('.school-status-board__figure')).toContain('justify-self: start');
  });

  it('fits a three-digit silver figure and its +NN inside the coins column', () => {
    // The reserve for the hanging +NN is ~0.9 of the silver size, and the
    // silver size follows the viewport WIDTH (the column is 13vw), so
    // "123 +NN" fits at 1280×800 instead of crossing the card edge.
    const grid = styleRule('.school-status-board__coin-grid');
    expect(grid).toMatch(/padding-right: calc\(var\(--silver\) \* 0\.9\)/);
    expect(grid).toMatch(/--silver: clamp\([^;]*vw/);
    expect(styleRule('.school-status-board__figure--silver')).toContain('font-size: var(--silver)');
  });

});

// 2026-09-25, from the wall: the board "keeps on spinning and shimmering". Every
// bus event reset all four cards to skeletons and re-read the whole roster, and
// those reads take seconds. Now it paints the last snapshot, refreshes in place,
// and re-reads only what the event is about.
describe('AgendaStatusBoard — cached, in-place refresh', () => {
  const planWithMath = { ok: true, status: 200, data: { sections: [{ subject: 'math' }], entries: [] } };
  const dayWith = (result) => ({ ok: true, status: 200, data: { studyDay: '2026-08-26', learners: [
    { learnerId: 'learner1', sessions: [{ unitId: 'm.01', subject: 'math', outcome: result ? { result } : null }] },
    { learnerId: 'learner2', sessions: [{ unitId: 'm.01', subject: 'math', outcome: null }] },
  ] } });
  const rowFor = (name) => screen.getByText(name).closest('.school-status-board__row');

  beforeEach(() => {
    vi.clearAllMocks(); wsHandlers.length = 0;
    schoolApi.stateGates.mockResolvedValue({ ok: false, status: 0, data: null });
    schoolApi.agendaPreview.mockResolvedValue(planWithMath);
    schoolApi.teacherDay.mockResolvedValue(dayWith(null));
  });

  it('paints the cached board on mount — no skeletons — before any read lands', async () => {
    render(<AgendaStatusBoard kids={KIDS} />);
    await waitFor(() => expect(screen.getAllByLabelText('0 of 1 done')).toHaveLength(2));
    cleanup();

    // Second mount: the reads hang, yet both cards are already drawn.
    schoolApi.teacherDay.mockReturnValue(new Promise(() => {}));
    schoolApi.agendaPreview.mockReturnValue(new Promise(() => {}));
    render(<AgendaStatusBoard kids={KIDS} />);
    expect(screen.getAllByLabelText('0 of 1 done')).toHaveLength(2);
    expect(document.querySelector('.school-status-board__pill--skeleton')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('drops cached discs when the server names another study day', async () => {
    render(<AgendaStatusBoard kids={KIDS} />);
    await waitFor(() => expect(screen.getAllByLabelText('0 of 1 done')).toHaveLength(2));
    cleanup();

    let release;
    schoolApi.teacherDay.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    schoolApi.agendaPreview.mockReturnValue(new Promise(() => {}));
    render(<AgendaStatusBoard kids={KIDS} />);
    expect(screen.getAllByLabelText('0 of 1 done')).toHaveLength(2);
    await act(async () => release({ ok: true, status: 200, data: { studyDay: '2026-08-27', learners: [] } }));
    expect(screen.queryAllByLabelText('0 of 1 done')).toHaveLength(0);
    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(2);
  });

  it('a scan for one learner re-reads that learner only, and no card goes back to a skeleton', async () => {
    render(<AgendaStatusBoard kids={KIDS} />);
    await waitFor(() => expect(screen.getAllByLabelText('0 of 1 done')).toHaveLength(2));
    schoolApi.agendaPreview.mockClear();

    let releasePlan;
    schoolApi.agendaPreview.mockReturnValue(new Promise((resolve) => { releasePlan = resolve; }));
    schoolApi.teacherDay.mockResolvedValue(dayWith('passed'));
    await act(async () => wsHandlers.filter((h) => h.topic === 'omr').at(-1).cb({ event: 'scan-graded', learnerId: 'learner1' }));

    // In flight: both cards still show what they showed.
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getAllByLabelText('0 of 1 done')).toHaveLength(2);
    expect(schoolApi.agendaPreview.mock.calls.map(([id]) => id)).toEqual(['learner1']);

    await act(async () => releasePlan(planWithMath));
    await waitFor(() => expect(rowFor('Learner One').dataset.complete).toBe('true'));
    expect(rowFor('Learner Two').dataset.complete).toBe('false');
  });

  it("a ring observation re-reads the rings and that learner's card, nobody else's", async () => {
    render(<AgendaStatusBoard kids={KIDS} />);
    await waitFor(() => expect(screen.getAllByLabelText('0 of 1 done')).toHaveLength(2));
    const plans = schoolApi.agendaPreview.mock.calls.length;
    const days = schoolApi.teacherDay.mock.calls.length;
    const gates = schoolApi.stateGates.mock.calls.length;

    await act(async () => wsHandlers.filter((h) => h.topic === 'state-gates').at(-1).cb({
      kind: 'StateObservation',
      payload: { current: { gateId: 'fitness.weekly-rings', subject: { kind: 'learner', id: 'learner1' } } },
    }));

    expect(schoolApi.stateGates.mock.calls.length).toBe(gates + 1);
    await waitFor(() => expect(schoolApi.agendaPreview.mock.calls.length).toBe(plans + 1));
    expect(schoolApi.agendaPreview.mock.calls.at(-1)[0]).toBe('learner1');
    expect(schoolApi.teacherDay.mock.calls.length).toBe(days + 1);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('a failed re-read keeps the card as it was', async () => {
    render(<AgendaStatusBoard kids={KIDS} />);
    await waitFor(() => expect(screen.getAllByLabelText('0 of 1 done')).toHaveLength(2));
    schoolApi.agendaPreview.mockRejectedValue(new Error('offline'));
    await act(async () => wsHandlers.filter((h) => h.topic === 'school').at(-1).cb({ event: 'session-issued', learnerId: 'learner1' }));
    expect(screen.getAllByLabelText('0 of 1 done')).toHaveLength(2);
  });
});

describe('rest day on the board', () => {
  const kids = [{ id: 'learner1', name: 'Learner One' }];
  const off = (subject, next = { unitId: `${subject}.next` }) => ({
    subject, next, obligation: { state: 'excused', reason: 'not_a_school_day' },
  });
  const digest = (extra = {}) => ({ ok: true, data: { studyDay: '2026-09-26', learners: [{ learnerId: 'learner1', sessions: [], ...extra }] } });
  beforeEach(() => {
    vi.clearAllMocks(); wsHandlers.length = 0;
    schoolApi.stateGates.mockResolvedValue({ ok: false });
    schoolApi.teacherDay.mockResolvedValue(digest());
  });

  it('says No school today and how to get extra work, never No plan to show', async () => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: { sections: [off('math'), off('language')], entries: [] } });
    render(<AgendaStatusBoard kids={kids} />);
    expect(await screen.findByText('No school today')).toBeInTheDocument();
    expect(screen.getByText('Scan your card for extra work')).toBeInTheDocument();
    expect(screen.queryByText('No plan to show')).toBeNull();
    expect(document.querySelector('.school-status-board__pill')).toBeNull();
  });

  it('drops the hint on a holiday with nothing offered', async () => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: { sections: [off('math', null)], entries: [] } });
    render(<AgendaStatusBoard kids={kids} />);
    expect(await screen.findByText('No school today')).toBeInTheDocument();
    expect(screen.queryByText('Scan your card for extra work')).toBeNull();
  });

  it('on a pinned past day says No school, with no scan hint', async () => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: { sections: [off('math')], entries: [] } });
    render(<AgendaStatusBoard kids={kids} day="2026-09-19" />);
    expect(await screen.findByText('No school')).toBeInTheDocument();
    expect(screen.queryByText('No school today')).toBeNull();
    expect(screen.queryByText('Scan your card for extra work')).toBeNull();
  });

  it('never claims a day off when the plan read fails', async () => {
    schoolApi.agendaPreview.mockRejectedValue(new Error('offline'));
    schoolApi.teacherDay.mockResolvedValue(digest({
      readingActivity: { status: 'ok', studyDay: '2026-09-26', hasActivity: false },
    }));
    render(<AgendaStatusBoard kids={kids} />);
    // Plan-less and activity-less: the card settles to null and the board
    // steps off the panel entirely, so assert the rest-day copy never appears.
    await waitFor(() => expect(schoolApi.agendaPreview).toHaveBeenCalled());
    expect(screen.queryByText('No school today')).toBeNull();
  });

  it('shows the rest-day copy under supplemental pins (reading done on a Saturday)', async () => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: { sections: [off('math')], entries: [] } });
    schoolApi.teacherDay.mockResolvedValue(digest({
      readingActivity: { status: 'ok', studyDay: '2026-09-26', hasActivity: true, bookCount: 1, finishedCount: 0, progressCount: 1 },
    }));
    render(<AgendaStatusBoard kids={kids} />);
    expect(await screen.findByRole('img', { name: /Reading: done/ })).toBeInTheDocument();
    expect(screen.getByText('No school today')).toBeInTheDocument();
    expect(screen.queryByText('No plan to show')).toBeNull();
  });

  it('draws the count, not the rest copy, once a Saturday lesson is under way', async () => {
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, data: { sections: [off('language', { unitId: 'fc.1' })], entries: [] } });
    schoolApi.teacherDay.mockResolvedValue(digest({ sessions: [{ unitId: 'fc.1', subject: 'language', state: 'issued', outcome: null }] }));
    render(<AgendaStatusBoard kids={kids} />);
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText('No school today')).toBeNull();
  });
});

const WEEK = { from: '2026-10-19', to: '2026-10-25' };
const priced = (learnerId, silver, { gems = 0, pending = {}, lines = [{ status: 'earned' }] } = {}) => ({
  learnerId, totals: { silver, gems }, pending: { silver: 0, gems: 0, ...pending }, lines, windows: { school: WEEK },
});
const roster = (...learners) => ({ ok: true, status: 200, data: { windows: { school: WEEK }, learners } });

describe('earningsByLearner', () => {
  it('maps the roster preview by learner, with the week it prices', () => {
    expect(earningsByLearner(roster(priced('user_4', 21), priced('user_5', 23, { pending: { silver: 5, gems: 1 } })).data)).toEqual({
      user_4: { silver: 21, gems: 0, pendingSilver: 0, pendingGems: 0, from: WEEK.from, to: WEEK.to },
      user_5: { silver: 23, gems: 0, pendingSilver: 5, pendingGems: 1, from: WEEK.from, to: WEEK.to },
    });
  });

  it("leaves out a learner it cannot price: every line 'can't tell', or no totals", () => {
    const unknown = priced('user_4', 0, { lines: [{ status: 'indeterminate' }, { status: 'indeterminate' }] });
    const broken = { learnerId: 'user_5', lines: [] };
    expect(earningsByLearner(roster(unknown, broken).data)).toEqual({});
    expect(earningsByLearner(null)).toEqual({});
  });
});

describe('AgendaStatusBoard silver this week', () => {
  const DAY = '2026-10-20';
  beforeEach(() => {
    vi.clearAllMocks();
    schoolApi.wallet.mockResolvedValue({ ok: false, status: 0, data: null });
    schoolApi.stateGates.mockResolvedValue({ ok: false, status: 0, data: null });
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: { sections: [{ subject: 'math', next: { unitId: 'math.01' } }],
      entries: [{ unitId: 'math.01', subject: 'math' }] } });
  });
  const silverOf = (name) => screen.queryByLabelText(new RegExp(`^${name} silver this week$`));

  it('shows each learner\'s silver once the read lands, and nothing before it', async () => {
    let land;
    schoolApi.earningsRoster.mockReturnValue(new Promise((r) => { land = r; }));
    render(<AgendaStatusBoard kids={KIDS} day={DAY} />);
    await waitFor(() => expect(screen.getAllByLabelText('0 of 1 done').length).toBe(2));
    expect(silverOf('\\d+')).toBeNull();
    await act(async () => land(roster(priced('learner1', 21))));
    expect(silverOf('21')).toBeTruthy();
    // learner2 was not priced: no number is invented for them.
    expect(screen.getAllByLabelText(/silver this week$/).length).toBe(1);
    expect(schoolApi.earningsRoster).toHaveBeenCalledWith(DAY);
  });

  it('pending is a faded +N after the number, gems a third line only when earned or pending', async () => {
    schoolApi.earningsRoster.mockResolvedValue(roster(
      priced('learner1', 23, { pending: { silver: 5, gems: 1 } }),
      priced('learner2', 10, { gems: 2 }),
    ));
    render(<AgendaStatusBoard kids={KIDS} day={DAY} />);
    const [one, two] = await waitFor(() => {
      const cells = screen.getAllByTestId('board-coins');
      expect(within(cells[0]).getByRole('img', { name: '23 silver this week, 5 more possible' })).toBeTruthy();
      return cells;
    });
    // Pending is part of the figure's ONE spoken name; the visible "+5" is
    // decoration, hidden from the accessibility tree.
    const silver = within(one).getByRole('img', { name: '23 silver this week, 5 more possible' });
    const plus = silver.querySelector('.school-status-board__more');
    expect(plus.textContent).toBe('+5');
    expect(plus).toHaveAttribute('aria-hidden', 'true');
    const gems = within(one).getByRole('img', { name: '0 gems this week, 1 more possible' });
    expect(gems.querySelector('.school-status-board__more').textContent).toBe('+1');
    expect(within(two).getByRole('img', { name: '10 silver this week' })).toBeTruthy();
    expect(within(two).getByRole('img', { name: '2 gems this week' })).toBeTruthy();
    expect(within(two).queryByRole('img', { name: /more possible$/ })).toBeNull();
    // No visible captions anywhere in the cell.
    expect(one.textContent).not.toMatch(/silver|gold|gem/i);
  });

  it('the coins sit in one cell per card, silver then gold, as a two-column grid', async () => {
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('learner1', 21)));
    schoolApi.wallet.mockResolvedValue({ ok: true, status: 200, data: { balance: 0 } });
    render(<AgendaStatusBoard kids={KIDS} day={DAY} />);
    await waitFor(() => expect(silverOf('21')).toBeTruthy());
    const cell = screen.getAllByTestId('board-coins')[0];
    const grid = cell.querySelector('.school-status-board__coin-grid');
    const names = [...grid.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label'));
    expect(names.slice(0, 2)).toEqual(['21 silver this week', '0 gold']);
    // Each figure is an icon cell followed by a number cell: the grid aligns them.
    expect(grid.children.length % 2).toBe(0);
  });

  it('a failed re-read keeps the figure already on the card', async () => {
    schoolApi.earningsRoster.mockResolvedValueOnce(roster(priced('learner1', 21)));
    render(<AgendaStatusBoard kids={KIDS} day={DAY} />);
    await waitFor(() => expect(silverOf('21')).toBeTruthy());
    schoolApi.earningsRoster.mockResolvedValue({ ok: false, status: 500, data: null });
    await act(async () => wsHandlers.filter((h) => h.topic === 'school').at(-1).cb({ event: 'story-read', learnerId: 'learner1', studyDay: DAY }));
    expect(silverOf('21')).toBeTruthy();
  });

  it('a school event for a learner re-reads the silver', async () => {
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('learner1', 21)));
    render(<AgendaStatusBoard kids={KIDS} day={DAY} />);
    await waitFor(() => expect(silverOf('21')).toBeTruthy());
    schoolApi.earningsRoster.mockResolvedValue(roster(priced('learner1', 24)));
    await act(async () => wsHandlers.filter((h) => h.topic === 'school').at(-1).cb({ event: 'story-read', learnerId: 'learner1', studyDay: DAY }));
    await waitFor(() => expect(silverOf('24')).toBeTruthy());
  });

  it('a cached figure from another week is not painted', async () => {
    // The snapshot IS of this study day (so the seed is accepted), but its
    // silver prices LAST week: the Coins week check alone must hide it.
    localStorage.setItem('daylight.school.status-board.v1', JSON.stringify({
      studyDay: DAY, learners: {}, rings: {},
      earnings: { learner1: { silver: 99, gems: 0, pendingSilver: 0, pendingGems: 0, from: '2026-10-12', to: '2026-10-18' } },
    }));
    schoolApi.earningsRoster.mockReturnValue(new Promise(() => {}));
    render(<AgendaStatusBoard kids={KIDS} day={DAY} />);
    await waitFor(() => expect(screen.getAllByLabelText('0 of 1 done').length).toBe(2));
    expect(silverOf('99')).toBeNull();
  });

  it('a cached figure from this week paints before the read lands', async () => {
    localStorage.setItem('daylight.school.status-board.v1', JSON.stringify({
      studyDay: DAY, learners: {}, rings: {},
      earnings: { learner1: { silver: 17, gems: 0, pendingSilver: 0, pendingGems: 0, from: WEEK.from, to: WEEK.to } },
    }));
    schoolApi.earningsRoster.mockReturnValue(new Promise(() => {}));
    render(<AgendaStatusBoard kids={KIDS} day={DAY} />);
    expect(silverOf('17')).toBeTruthy();
  });
});

describe('AgendaStatusBoard gold', () => {
  const DAY = '2026-10-20';
  beforeEach(() => {
    vi.clearAllMocks();
    schoolApi.stateGates.mockResolvedValue({ ok: false, status: 0, data: null });
    schoolApi.earningsRoster.mockResolvedValue({ ok: false, status: 0, data: null });
    schoolApi.teacherDay.mockResolvedValue({ ok: true, status: 200, data: { learners: [] } });
    schoolApi.agendaPreview.mockResolvedValue({ ok: true, status: 200, data: { sections: [{ subject: 'math', next: { unitId: 'math.01' } }],
      entries: [{ unitId: 'math.01', subject: 'math' }] } });
  });
  const wallet = (balance) => ({ ok: true, status: 200, data: { balance, session: null } });

  it('gold shows without silver, per learner, once its wallet read lands', async () => {
    schoolApi.wallet.mockImplementation((id) => Promise.resolve(id === 'learner1' ? wallet(7) : { ok: false, status: 500, data: null }));
    render(<AgendaStatusBoard kids={KIDS} day={DAY} />);
    expect(await screen.findByLabelText('7 gold')).toBeTruthy();
    // learner2's read failed: no figure is invented for them.
    expect(screen.getAllByLabelText(/ gold$/)).toHaveLength(1);
    expect(schoolApi.wallet).toHaveBeenCalledWith('learner1');
    expect(schoolApi.wallet).toHaveBeenCalledWith('learner2');
  });

  it('a zero balance is shown as 0, not hidden', async () => {
    schoolApi.wallet.mockResolvedValue(wallet(0));
    render(<AgendaStatusBoard kids={KIDS} day={DAY} />);
    await waitFor(() => expect(screen.getAllByLabelText('0 gold')).toHaveLength(2));
  });

  it('a failed re-read keeps the gold already shown', async () => {
    schoolApi.wallet.mockResolvedValue(wallet(4));
    render(<AgendaStatusBoard kids={KIDS} day={DAY} />);
    await waitFor(() => expect(screen.getAllByLabelText('4 gold')).toHaveLength(2));
    expect(schoolApi.wallet).toHaveBeenCalledTimes(2);
    schoolApi.wallet.mockRejectedValue(new Error('down'));
    await act(async () => wsHandlers.filter((h) => h.topic === 'school').at(-1).cb({ event: 'story-read', learnerId: 'learner1', studyDay: DAY }));
    // The re-read really happened (one wallet per learner) and failed.
    expect(schoolApi.wallet).toHaveBeenCalledTimes(4);
    expect(screen.getAllByLabelText('4 gold')).toHaveLength(2);
  });

  it('logs a wallet read that comes back not-ok, with the learner and status', async () => {
    const logged = vi.spyOn(schoolLog, 'selfServiceError');
    schoolApi.wallet.mockImplementation((id) => Promise.resolve(id === 'learner1' ? wallet(7) : { ok: false, status: 503, data: null }));
    render(<AgendaStatusBoard kids={KIDS} day={DAY} />);
    expect(await screen.findByLabelText('7 gold')).toBeTruthy();
    await waitFor(() => expect(logged).toHaveBeenCalledWith('status-board.wallet-failed', { learnerId: 'learner2', status: 503 }));
    expect(logged).not.toHaveBeenCalledWith('status-board.wallet-failed', expect.objectContaining({ learnerId: 'learner1' }));
    logged.mockRestore();
  });
});
