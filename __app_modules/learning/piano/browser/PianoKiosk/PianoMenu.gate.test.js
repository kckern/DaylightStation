import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
let schoolAccess;
const UNLOCKED = { status: 'ready', state: 'complete', unlocked: true };

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn(() => Promise.resolve(activityResponse)), DaylightAPIText: vi.fn(() => Promise.resolve('<work-title>Jesu Joy</work-title>')) }));
vi.mock('./PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({
    pianoId: 'test-piano',
    basePath: '/piano',
    config: { screensaver: { deviceId: 'piano-tablet' }, keyboard: { startNote: 21, endNote: 108 }, curfew: curfewConfig },
  }),
}));
vi.mock('./kioskDeviceIdentity.js', () => ({ KIOSK_DEVICE_ID: 'piano-tablet' }));
vi.mock('./PianoUserContext.jsx', () => ({
  usePianoUser: () => ({ currentUser, setCurrentUser: () => {}, users: [{ id: 'learner2', schoolLearner: true }, { id: 'parent1', schoolLearner: false }] }),
}));
vi.mock('./PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ pressNote: () => {}, releaseNote: () => {} }),
}));
vi.mock('./LiveKeyboard.jsx', () => ({ default: () => createElement('div', { 'data-testid': 'live-keyboard' }) }));
// This suite isolates the lesson gate; household karaoke is covered separately.
vi.mock('./useKaraokeSchoolAccess.js', () => ({ default: () => ({ status: 'ready', unlocked: true }) }));
vi.mock('./useSchoolGameAccess.js', () => ({
  default: () => schoolAccess,
}));
vi.mock('./usePianoLessonGate.js', async () => ({
  ...(await vi.importActual('./usePianoLessonGate.js')),
  default: () => gateState,
}));
vi.mock('../ask/AskSession.jsx', () => ({ default: () => createElement('div', { 'data-testid': 'ask-session' }) }));
vi.mock('../../../../../frontend/src/lib/logging/Logger.js', () => ({
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
  schoolAccess = UNLOCKED;
  __clearPianoListCache();
  localStorage.clear();
  atClock(14);
});
afterEach(() => { vi.useRealTimers(); });

describe('PianoMenu with an owed lesson', () => {
  // Sheet music is the exception (owner, 2026-11-19): a child who owes the video
  // lesson can still reach their pieces, through the strip's piece card or the
  // one Sheet Music tile beside the lesson. Every other mode stays behind it.
  it('keeps the lesson card, the progress strip and only the Sheet Music tile', async () => {
    gateState = GATED;
    renderMenu();
    expect(screen.getByText('Lesson 5: Broken Chords')).toBeTruthy();
    expect(document.querySelector('.piano-desk')).not.toBeNull();
    expect(tiles()).toHaveLength(1);
    expect(tiles()[0].textContent).toMatch(/Sheet Music/);
    fireEvent.click(tiles()[0]);
    expect(navigate).toHaveBeenCalledWith('/piano/sheetmusic');
    // The strip's own cards stay live: a course card here belongs to this child.
    expect(await screen.findByRole('button', { name: /learner2: Course B/ })).not.toBeDisabled();
  });

  it('puts the child latest piece above the Sheet Music tile, opening straight into it', async () => {
    gateState = GATED;
    const piece = { scoreId: 'files:docs/sheet-music/jesu.mxl', cover: '/api/cover.jpg', practicedAt: '2026-08-21T11:00:00Z', total: 2, silver: 1, gold: 0,
      next: { passageId: 'b' }, nextGoldPassageId: 'a', passages: [{ id: 'a', start: 0, end: 4, state: 'silver' }, { id: 'b', start: 5, end: 8, state: 'todo' }] };
    activityResponse = { players: [{ ...ACTIVITY.players[0], piece }] };
    renderMenu();
    const latest = await screen.findByRole('button', { name: /^Play / });
    expect(latest.querySelector('img')).toHaveAttribute('src', '/api/cover.jpg');
    expect(latest.closest('.piano-home__side').querySelector('.piano-tile')).not.toBeNull();
    fireEvent.click(latest);
    expect(navigate).toHaveBeenCalledWith('/piano/sheetmusic/view/files:docs/sheet-music/jesu.mxl?learnPassage=b');
  });

  it('encodes a score id with # and ? into the route, so the passage query survives', async () => {
    gateState = GATED;
    const scoreId = 'files:docs/sheet-music/odd #1 ?50%.musicxml';
    const piece = { scoreId, cover: null, practicedAt: '2026-08-21T11:00:00Z', total: 1, silver: 0, gold: 0,
      next: { passageId: 'a' }, nextGoldPassageId: null, passages: [{ id: 'a', start: 0, end: 4, state: 'todo' }] };
    activityResponse = { players: [{ ...ACTIVITY.players[0], piece }] };
    renderMenu();
    fireEvent.click(await screen.findByRole('button', { name: /^Play / }));
    expect(navigate).toHaveBeenCalledWith(`/piano/sheetmusic/view/files:docs/sheet-music/${encodeURIComponent('odd #1 ?50%.musicxml')}?learnPassage=a`);
  });

  it('leaves a PianoChallenge its whole screen, with no strip or tile', () => {
    gateState = { ...GATED, challenge: { id: 'c', ask: { id: 'a' }, materialSpec: {}, framing: null } };
    renderMenu();
    expect(tiles()).toHaveLength(0);
    expect(document.querySelector('.piano-desk')).toBeNull();
  });

  // Arcade standard: the card is the course poster, the lesson title and a play disc on its still.
  it('carries the lesson title and one start action, and nothing only to be read', () => {
    gateState = GATED;
    renderMenu();
    expect(document.querySelector('.piano-lesson-gate').textContent).toBe('Lesson 5: Broken Chords');
    expect(screen.getByRole('button', { name: /start today.s lesson/i })).toBeTruthy();
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
    expect(tiles()).toHaveLength(1);

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
    const course = await screen.findByRole('button', { name: /Course B/ });
    expect(course.disabled).toBe(true);
    course.click();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reopens the strip once the verdict lands', async () => {
    gateState = NOT_GATED;
    renderMenu();
    expect((await screen.findByRole('button', { name: /Course B/ })).disabled).toBe(false);
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

// The early pass (school economy slice 1, C5). The school-locked Games tile
// stays live while today's pass cap is unused, affordable or not, so a child
// with no silver can still reach the lock's Print button. A used cap or an
// unreadable ledger shuts it, as it always was.
describe('PianoMenu Games tile and the early pass', () => {
  const gamesTile = () => screen.getByText('Games').closest('button');
  const locked = (pass, offers = []) => ({
    status: 'ready', state: 'incomplete', unlocked: false,
    pass: { passId: null, state: 'none', capUsed: false, ...pass }, offers,
  });

  it('is enabled while locked when an affordable offer exists', () => {
    schoolAccess = locked({}, [{ coin: 'silver', price: 3, affordable: true }]);
    renderMenu();
    expect(gamesTile().disabled).toBe(false);
    expect(gamesTile().textContent).toContain('buy one game');
  });

  it('is enabled when the offer is not affordable, so Print is reachable', () => {
    schoolAccess = locked({}, [{ coin: 'silver', price: 3, affordable: false }]);
    renderMenu();
    expect(gamesTile().disabled).toBe(false);
    expect(gamesTile().textContent).toContain('Finish school to unlock');
  });

  it('is enabled when nothing is for sale (the shipped prices are 0)', () => {
    schoolAccess = locked({}, []);
    renderMenu();
    expect(gamesTile().disabled).toBe(false);
  });

  it('stays disabled when the bank could not be read at all', () => {
    schoolAccess = { status: 'ready', state: 'incomplete', unlocked: false, pass: null, offers: [] };
    renderMenu();
    expect(gamesTile().disabled).toBe(true);
  });

  it('stays disabled when the day is indeterminate', () => {
    schoolAccess = { ...locked({}, []), state: 'indeterminate' };
    renderMenu();
    expect(gamesTile().disabled).toBe(true);
  });

  it('stays disabled once the cap is used', () => {
    schoolAccess = locked({ state: 'consumed', capUsed: true }, [{ coin: 'silver', price: 3, affordable: true }]);
    renderMenu();
    expect(gamesTile().disabled).toBe(true);
  });

  it('stays disabled when the ledger could not be read', () => {
    schoolAccess = locked({ state: 'unknown', capUsed: null }, [{ coin: 'silver', price: 3, affordable: true }]);
    renderMenu();
    expect(gamesTile().disabled).toBe(true);
  });

  it('is enabled while a bought pass waits to be played', () => {
    schoolAccess = { status: 'ready', state: 'incomplete', unlocked: true, via: 'pass', pass: { passId: 'p1', state: 'active', capUsed: true }, offers: [] };
    renderMenu();
    expect(gamesTile().disabled).toBe(false);
    expect(gamesTile().textContent).toContain('One game today');
  });
});
