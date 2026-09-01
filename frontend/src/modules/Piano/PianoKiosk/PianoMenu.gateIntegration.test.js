import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PianoMenu } from './PianoMenu.jsx';
import { PIANO_MODES } from './pianoModes.js';
import { PENDING_CAPTION, LOADING_CEILING_MS } from './usePianoLessonGate.js';
import { __clearPianoListCache } from './usePianoList.js';

// The seam the 2026-09-01 incident actually lived in: the REAL hook driving the
// REAL menu. Every other suite here cuts it — PianoMenu.gate.test.js mocks the
// hook, PianoMenu.modes.test.js stubs it, and PianoMenu.curfew.test.js supplies
// no currentUser so the hook takes its guest short-circuit and never fetches.
// So the menu could read one field of the hook's contract and ignore another
// while both sides stayed green, which is exactly what happened.
//
// Nothing below stubs the gate: it fetches, and these tests answer the fetch.

const navigate = vi.fn();
let gateDeferred;
let currentUser;

const defer = () => {
  let settle;
  const promise = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  return { promise, ...settle };
};

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});
// One mock, two endpoints: the gate read is the one under test, the activity
// strip's read is answered flatly so the strip does not drive the assertions.
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn((url) => (String(url).includes('piano-lesson-gate')
    ? gateDeferred.promise
    : Promise.resolve({ players: [] }))),
}));
vi.mock('./PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({
    pianoId: 'test-piano',
    basePath: '/piano',
    config: { keyboard: { startNote: 21, endNote: 108 }, curfew: { enabled: false } },
  }),
}));
vi.mock('./PianoUserContext.jsx', () => ({
  usePianoUser: () => ({ currentUser, setCurrentUser: () => {} }),
}));
vi.mock('./PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ pressNote: () => {}, releaseNote: () => {} }),
}));
vi.mock('./LiveKeyboard.jsx', () => ({ default: () => null }));
vi.mock('./useSchoolGameAccess.js', () => ({
  default: () => ({ status: 'ready', state: 'complete', unlocked: true }),
}));
vi.mock('../../../hooks/useWebSocket.js', () => ({ useWebSocketSubscription: () => {} }));
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info() {}, debug() {}, warn() {}, error() {} }) }),
}));

const ALWAYS_DISABLED = PIANO_MODES.filter((m) => m.disabled).length;
const renderMenu = () => render(createElement(MemoryRouter, null, createElement(PianoMenu)));
const tiles = () => Array.from(document.querySelectorAll('.piano-tile'));
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

const OWED = {
  gated: true,
  reason: 'owed',
  course: { id: 'plex:695598', title: 'Reading Music' },
  unit: { id: '2', title: 'Unit 2' },
  lesson: { id: 'plex:695611', title: 'Meet the Eighth Note' },
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 8, 1, 14, 0, 0));
  navigate.mockClear();
  gateDeferred = defer();
  currentUser = 'learner-c';
  __clearPianoListCache();
  localStorage.clear();
});
afterEach(() => { vi.useRealTimers(); });

describe('PianoMenu driven by the real lesson gate', () => {
  it('is shut at first paint, before the read has answered', async () => {
    renderMenu();
    await flush();
    expect(tiles()).toHaveLength(PIANO_MODES.length);
    expect(tiles().every((t) => t.disabled)).toBe(true);
    expect(screen.getByText(PENDING_CAPTION)).toBeTruthy();
  });

  it('opens when the read answers "nothing owed"', async () => {
    renderMenu();
    await flush();
    expect(tiles().every((t) => t.disabled)).toBe(true);

    await act(async () => {
      gateDeferred.resolve({ gated: false, reason: 'done' });
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => expect(tiles().filter((t) => t.disabled)).toHaveLength(ALWAYS_DISABLED));
    expect(screen.queryByText(PENDING_CAPTION)).toBeNull();
  });

  it('replaces the menu with the one owed lesson when the read says so', async () => {
    renderMenu();
    await flush();
    await act(async () => {
      gateDeferred.resolve(OWED);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => expect(screen.getByText('Meet the Eighth Note')).toBeTruthy());
    expect(tiles()).toHaveLength(0);
  });

  // The incident, reconstructed: a learner picks their name and reaches for a
  // course 3.5s later, while the cold read (measured at 11.1s) is still out.
  it('is still shut 3.5s in — the reach that started the incident', async () => {
    renderMenu();
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
    expect(tiles().every((t) => t.disabled)).toBe(true);
    tiles()[0].click();
    expect(navigate).not.toHaveBeenCalled();
  });

  // Bounded: a read that never lands must not leave a child at a dead screen.
  it('gives up and opens at the ceiling when the read never lands', async () => {
    renderMenu();
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(LOADING_CEILING_MS + 10); });
    await waitFor(() => expect(tiles().filter((t) => t.disabled)).toHaveLength(ALWAYS_DISABLED));
    expect(screen.queryByText(PENDING_CAPTION)).toBeNull();
  });

  // A 500 answers in milliseconds. Before the fix that reopened every door
  // before a finger could land — the same escape with no pending window.
  it('does not open on a fast server error; it waits like any other non-answer', async () => {
    renderMenu();
    await flush();
    await act(async () => {
      gateDeferred.reject(Object.assign(new Error('HTTP 500'), { status: 500 }));
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(tiles().every((t) => t.disabled)).toBe(true);
    expect(screen.getByText(PENDING_CAPTION)).toBeTruthy();
  });

  // ...but a School-less install answers 404 to every read, and those learners
  // must not wait out the ceiling on every single pick.
  it('opens immediately on a 404', async () => {
    renderMenu();
    await flush();
    await act(async () => {
      gateDeferred.reject(Object.assign(new Error('HTTP 404'), { status: 404 }));
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => expect(tiles().filter((t) => t.disabled)).toHaveLength(ALWAYS_DISABLED));
  });

  // Guest is never assigned a lesson, so the gate never fetches for them and
  // the menu is open from the first frame. This is the rule PianoMenu used to
  // re-derive for itself; here it is proved through the real hook.
  it('never makes Guest wait, and never even asks', async () => {
    currentUser = 'guest';
    renderMenu();
    await flush();
    expect(tiles().filter((t) => t.disabled)).toHaveLength(ALWAYS_DISABLED);
    expect(screen.queryByText(PENDING_CAPTION)).toBeNull();
  });
});
