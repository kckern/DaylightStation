import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PianoMenu } from './PianoMenu.jsx';
import { __clearPianoListCache } from './usePianoList.js';
import { PIANO_MODES } from './pianoModes.js';
import { PENDING_CAPTION } from './usePianoLessonGate.js';

// The lesson gate: while a learner still owes today's assigned piano lesson,
// the home screen is that ONE lesson and nothing else. It clears the moment
// School says the obligation is discharged. Curfew outranks it — there is no
// point offering a lesson after bedtime — and the piano's own
// auto-enter-Studio path (useAutoStudioEntry, wired in PianoApp on the menu
// ROUTE, not in this component) is untouched either way.

const navigate = vi.fn();
let curfewConfig;
let gateState;
let currentUser;
let activityResponse;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(() => Promise.resolve(activityResponse)) }));
vi.mock('./PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({
    pianoId: 'test-piano',
    basePath: '/piano',
    config: { keyboard: { startNote: 21, endNote: 108 }, curfew: curfewConfig },
  }),
}));
vi.mock('./PianoUserContext.jsx', () => ({
  usePianoUser: () => ({ currentUser, setCurrentUser: () => {} }),
}));
vi.mock('./PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ pressNote: () => {}, releaseNote: () => {} }),
}));
vi.mock('./LiveKeyboard.jsx', () => ({ default: () => createElement('div', { 'data-testid': 'live-keyboard' }) }));
vi.mock('./useSchoolGameAccess.js', () => ({
  default: () => ({ status: 'ready', state: 'complete', unlocked: true }),
}));
vi.mock('./usePianoLessonGate.js', async () => ({
  ...(await vi.importActual('./usePianoLessonGate.js')),
  default: () => gateState,
}));
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info() {}, debug() {}, warn() {}, error() {} }) }),
}));

const NOT_GATED = {
  status: 'ready', pending: false, gated: false,
  course: null, unit: null, lesson: null, challenge: null,
};
// The verdict has not come back yet. Not the same thing as "not gated".
const LOADING = { ...NOT_GATED, status: 'loading', pending: true };
// Both ways of giving up. `pending` false: the hook has stopped waiting, so
// the menu opens (verified against the real hook in usePianoLessonGate.test.js
// and end-to-end in PianoMenu.gateIntegration.test.js).
const TIMED_OUT = { ...NOT_GATED, status: 'timeout' };
const READ_FAILED = { ...NOT_GATED, status: 'error' };
const GATED = {
  status: 'ready',
  pending: false,
  gated: true,
  course: { id: 'plex:1', title: 'Hoffman Academy' },
  unit: { id: '3', title: 'Unit 3' },
  lesson: { id: 'plex:2', title: 'Lesson 5: Broken Chords' },
};
const CURFEW_ON = { enabled: true, start: '19:00', end: '06:00' };
const ACTIVITY = {
  players: [{
    userId: 'learner2', name: 'learner2', lastPlayedAt: '2026-08-21T10:00:00Z',
    courses: [{
      courseId: 'plex:11', courseTitle: 'Course B', thumbnail: '/img/b',
      completed: 13, total: 57, percent: 23, lastPlayedAt: '2026-08-21T10:00:00Z',
    }],
  }],
};

// Sourced from the mode table itself, not counted by hand: School games are
// unlocked in this file's mock, so only the permanently-disabled modes
// (Producer) stay greyed once the gate is open.
const ALWAYS_DISABLED = PIANO_MODES.filter((m) => m.disabled).length;

const atClock = (h, m = 0) => vi.setSystemTime(new Date(2026, 7, 21, h, m, 0));
const renderMenu = () => render(createElement(MemoryRouter, null, createElement(PianoMenu)));
const tiles = () => Array.from(document.querySelectorAll('.piano-tile'));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  navigate.mockClear();
  curfewConfig = { ...CURFEW_ON, enabled: false };
  gateState = NOT_GATED;
  currentUser = 'learner2';
  activityResponse = ACTIVITY;
  __clearPianoListCache();
  localStorage.clear();
  atClock(14);
});
afterEach(() => { vi.useRealTimers(); });

describe('PianoMenu with an owed lesson', () => {
  it('shows only the lesson card — no tile grid, no activity strip', () => {
    gateState = GATED;
    renderMenu();
    expect(screen.getByText('Lesson 5: Broken Chords')).toBeTruthy();
    expect(tiles()).toHaveLength(0);
    expect(document.querySelector('.piano-menu-activity')).toBeNull();
  });

  it('names the course and unit the lesson belongs to', () => {
    gateState = GATED;
    renderMenu();
    expect(screen.getByText(/Hoffman Academy/)).toBeTruthy();
    expect(screen.getByText(/Unit 3/)).toBeTruthy();
  });

  it('restores the ordinary menu once the day is discharged', () => {
    renderMenu();
    expect(tiles()).toHaveLength(PIANO_MODES.length);
    expect(screen.queryByText('Lesson 5: Broken Chords')).toBeNull();
  });

  // The keyboard is how a child discovers that playing still works, so it must
  // survive the gate — the whole point is that the PIANO is never gated.
  it('keeps the live keyboard in both branches', () => {
    gateState = GATED;
    const gated = renderMenu();
    expect(gated.getByTestId('live-keyboard')).toBeTruthy();
    gated.unmount();

    gateState = NOT_GATED;
    expect(renderMenu().getByTestId('live-keyboard')).toBeTruthy();
  });

  it('lets curfew outrank the gate — no lesson offered after bedtime', () => {
    gateState = GATED;
    curfewConfig = CURFEW_ON;
    atClock(20);
    renderMenu();
    expect(screen.queryByText('Lesson 5: Broken Chords')).toBeNull();
    expect(screen.getByText(/the piano is still on/i)).toBeTruthy();
    expect(tiles().every((t) => t.disabled)).toBe(true);
  });

  it('clears live when School says the lesson landed — no reload', async () => {
    gateState = GATED;
    const view = renderMenu();
    expect(tiles()).toHaveLength(0);

    gateState = NOT_GATED;
    view.rerender(createElement(MemoryRouter, null, createElement(PianoMenu)));
    await waitFor(() => expect(tiles()).toHaveLength(PIANO_MODES.length));
  });
});

// 2026-09-01: a learner picked his name and 3.5s later left through the
// recent-courses strip, which only renders in the NOT-gated branch. The
// verdict took 11.1s to arrive; for all of it `gated` was false and the menu
// was wide open. An unanswered read is PENDING — every door stays shut until
// School says otherwise, or until the hook gives up on it.
describe('PianoMenu while the lesson verdict is still outstanding', () => {
  it('disables every tile for a named learner', () => {
    gateState = LOADING;
    renderMenu();
    const all = tiles();
    expect(all.length).toBe(PIANO_MODES.length);
    expect(all.every((t) => t.disabled)).toBe(true);
    expect(screen.getByText(PENDING_CAPTION)).toBeTruthy();
  });

  // The strip is the door the 2026-09-01 escape actually went through.
  it('shuts the recent-courses strip the escape went through', async () => {
    gateState = LOADING;
    renderMenu();
    await waitFor(() => expect(screen.getByAltText('Course B')).toBeTruthy());
    expect(document.querySelector('.piano-menu-activity').className).toContain('is-disabled');
    const course = document.querySelector('.piano-menu-activity__course');
    expect(course.disabled).toBe(true);
    course.click();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reopens the strip once the verdict lands', async () => {
    gateState = NOT_GATED;
    renderMenu();
    await waitFor(() => expect(screen.getByAltText('Course B')).toBeTruthy());
    expect(document.querySelector('.piano-menu-activity').className).not.toContain('is-disabled');
    expect(document.querySelector('.piano-menu-activity__course').disabled).toBe(false);
  });

  // Not belt-and-braces coverage: PianoTile renders a real <button disabled>,
  // so this fails only if `pending` stops reaching the tiles at all.
  it('leaves a pending tile inert under a real click', () => {
    gateState = LOADING;
    renderMenu();
    tiles()[0].click();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens the menu once a verdict — any verdict — arrives', () => {
    gateState = TIMED_OUT;
    renderMenu();
    expect(tiles().filter((t) => t.disabled)).toHaveLength(ALWAYS_DISABLED);
    expect(screen.queryByText(PENDING_CAPTION)).toBeNull();
  });

  it('opens the menu when the read failed outright', () => {
    gateState = READ_FAILED;
    renderMenu();
    expect(tiles().filter((t) => t.disabled)).toHaveLength(ALWAYS_DISABLED);
    expect(screen.queryByText(PENDING_CAPTION)).toBeNull();
  });

  // "Guest is never made to wait" is no longer assertable here: who is pending
  // is the hook's rule now, and the hook is mocked in this file. It is pinned
  // where it lives (usePianoLessonGate.test.js, "reports pending for exactly
  // the learners whose verdict is outstanding") and end-to-end through this
  // very component in PianoMenu.gateIntegration.test.js.

  it('lets curfew outrank pending — one message, not two', () => {
    gateState = LOADING;
    curfewConfig = CURFEW_ON;
    atClock(20);
    renderMenu();
    expect(tiles().every((t) => t.disabled)).toBe(true);
    expect(screen.getByText(/the piano is still on/i)).toBeTruthy();
    expect(screen.queryByText(PENDING_CAPTION)).toBeNull();
  });
});
