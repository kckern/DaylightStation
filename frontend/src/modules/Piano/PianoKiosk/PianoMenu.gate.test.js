import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PianoMenu } from './PianoMenu.jsx';
import { __clearPianoListCache } from './usePianoList.js';

// The lesson gate: while a learner still owes today's assigned piano lesson,
// the home screen is that ONE lesson and nothing else. It clears the moment
// School says the obligation is discharged. Curfew outranks it — there is no
// point offering a lesson after bedtime — and the piano's own
// auto-enter-Studio path (useAutoStudioEntry, wired in PianoApp on the menu
// ROUTE, not in this component) is untouched either way.

const navigate = vi.fn();
let curfewConfig;
let gateState;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(() => Promise.resolve({ players: [] })) }));
vi.mock('./PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({
    pianoId: 'test-piano',
    basePath: '/piano',
    config: { keyboard: { startNote: 21, endNote: 108 }, curfew: curfewConfig },
  }),
}));
vi.mock('./PianoUserContext.jsx', () => ({
  usePianoUser: () => ({ currentUser: 'learner2', setCurrentUser: () => {} }),
}));
vi.mock('./PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ pressNote: () => {}, releaseNote: () => {} }),
}));
vi.mock('./LiveKeyboard.jsx', () => ({ default: () => createElement('div', { 'data-testid': 'live-keyboard' }) }));
vi.mock('./useSchoolGameAccess.js', () => ({
  default: () => ({ status: 'ready', state: 'complete', unlocked: true }),
}));
vi.mock('./usePianoLessonGate.js', () => ({ default: () => gateState }));
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info() {}, debug() {}, warn() {}, error() {} }) }),
}));

const NOT_GATED = { status: 'ready', gated: false, course: null, unit: null, lesson: null };
const GATED = {
  status: 'ready',
  gated: true,
  course: { id: 'plex:1', title: 'Hoffman Academy' },
  unit: { id: '3', title: 'Unit 3' },
  lesson: { id: 'plex:2', title: 'Lesson 5: Broken Chords' },
};
const CURFEW_ON = { enabled: true, start: '19:00', end: '06:00' };

const atClock = (h, m = 0) => vi.setSystemTime(new Date(2026, 7, 21, h, m, 0));
const renderMenu = () => render(createElement(MemoryRouter, null, createElement(PianoMenu)));
const tiles = () => Array.from(document.querySelectorAll('.piano-tile'));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  navigate.mockClear();
  curfewConfig = { ...CURFEW_ON, enabled: false };
  gateState = NOT_GATED;
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
    expect(tiles()).toHaveLength(10);
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
    await waitFor(() => expect(tiles()).toHaveLength(10));
  });
});
