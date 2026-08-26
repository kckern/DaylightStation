import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PianoMenu } from './PianoMenu.jsx';
import { __clearPianoListCache } from './usePianoList.js';

// Curfew (config-driven, data/household/piano/config.yml → `curfew:`): inside
// the window every door out of the home screen is shut — tiles and the
// activity strip's course buttons — while the piano's own auto-enter-Studio
// path (useAutoStudioEntry, wired in PianoApp, not here) is untouched.

const navigate = vi.fn();
let curfewConfig;
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
vi.mock('./PianoUserContext.jsx', () => ({ usePianoUser: () => ({ setCurrentUser: () => {} }) }));
vi.mock('./PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ pressNote: () => {}, releaseNote: () => {} }),
}));
vi.mock('./LiveKeyboard.jsx', () => ({ default: () => null }));
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info() {}, debug() {}, warn() {}, error() {} }) }),
}));

const CURFEW = { enabled: true, start: '19:00', end: '06:00' };
const ACTIVITY = {
  players: [{
    userId: 'learner2', name: 'learner2', lastPlayedAt: '2026-08-21T10:00:00Z',
    courses: [{
      courseId: 'plex:11', courseTitle: 'Course B', thumbnail: '/img/b',
      completed: 13, total: 57, percent: 23, lastPlayedAt: '2026-08-21T10:00:00Z',
    }],
  }],
};

const atClock = (h, m = 0) => vi.setSystemTime(new Date(2026, 7, 21, h, m, 0));
const renderMenu = () => render(createElement(MemoryRouter, null, createElement(PianoMenu)));
const tiles = () => Array.from(document.querySelectorAll('.piano-tile'));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  navigate.mockClear();
  curfewConfig = CURFEW;
  activityResponse = ACTIVITY;
  __clearPianoListCache();
  localStorage.clear();
});
afterEach(() => { vi.useRealTimers(); });

describe('PianoMenu under curfew', () => {
  it('greys out every tile after the cut-off', () => {
    atClock(20);
    renderMenu();
    const all = tiles();
    expect(all.length).toBe(10);
    expect(all.every((t) => t.disabled)).toBe(true);
    expect(all.every((t) => t.className.includes('is-disabled'))).toBe(true);
  });

  it('leaves the tiles alive outside the window', () => {
    atClock(14);
    renderMenu();
    // Only the two permanently-disabled tiles (Games, Producer) stay greyed.
    expect(tiles().filter((t) => t.disabled)).toHaveLength(2);
  });

  it('does not navigate when a greyed tile is somehow activated', () => {
    atClock(20);
    renderMenu();
    tiles()[0].click();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('tells the room why nothing responds', () => {
    atClock(20);
    renderMenu();
    expect(screen.getByText(/the piano is still on/i)).toBeTruthy();
  });

  it('says nothing outside the window', () => {
    atClock(14);
    renderMenu();
    expect(screen.queryByText(/the piano is still on/i)).toBeNull();
  });

  it('disables the activity strip’s course buttons', async () => {
    atClock(20);
    renderMenu();
    await waitFor(() => expect(screen.getByAltText('Course B')).toBeTruthy());
    const strip = document.querySelector('.piano-menu-activity');
    expect(strip.className).toContain('is-disabled');
    const course = document.querySelector('.piano-menu-activity__course');
    expect(course.disabled).toBe(true);
    course.click();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('greys out live when the clock crosses the cut-off — no reload', async () => {
    atClock(18, 59);
    renderMenu();
    expect(tiles().filter((t) => t.disabled)).toHaveLength(2);
    atClock(19, 0);
    await vi.advanceTimersByTimeAsync(31_000); // the hook's 30s poll
    await waitFor(() => expect(tiles().every((t) => t.disabled)).toBe(true));
  });

  it('ignores a curfew window that is turned off in config', () => {
    atClock(20);
    curfewConfig = { ...CURFEW, enabled: false };
    renderMenu();
    expect(tiles().filter((t) => t.disabled)).toHaveLength(2);
  });

  it('ignores a piano with no curfew configured at all', () => {
    atClock(20);
    curfewConfig = undefined;
    renderMenu();
    expect(tiles().filter((t) => t.disabled)).toHaveLength(2);
  });
});
