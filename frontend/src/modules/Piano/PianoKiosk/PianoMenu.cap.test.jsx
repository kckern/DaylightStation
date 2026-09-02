/**
 * The Videos tile under the daily cap.
 *
 * The redirect in Videos.jsx is the enforcement; this is the explanation. A
 * tile that stayed live and bounced a child straight back to the menu would
 * read as a broken kiosk, which is the same failure the school lock had until
 * it started naming whose day it was reading.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = { lessonGate: null, gameAccess: null };

vi.mock('./PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({ pianoId: 'p1', basePath: '/piano', config: { keyboard: { startNote: 21, endNote: 108 } } }),
}));
vi.mock('./PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ pressNote: vi.fn(), releaseNote: vi.fn() }),
}));
vi.mock('./LiveKeyboard.jsx', () => ({ default: () => <div data-testid="live-keyboard" /> }));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(async () => ({ items: [] })) }));
vi.mock('./PianoUserContext.jsx', () => ({
  usePianoUser: () => ({ users: [{ id: 'learner-one', name: 'Learner One' }], currentUser: 'learner-one', setCurrentUser: vi.fn() }),
}));
vi.mock('./useSchoolGameAccess.js', () => ({ default: () => state.gameAccess }));
vi.mock('./usePianoLessonGate.js', async () => ({
  ...(await vi.importActual('./usePianoLessonGate.js')),
  default: () => state.lessonGate,
}));
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info() {}, debug() {}, warn() {}, error() {} }) }),
  getLogger: () => ({ child: () => ({ info() {}, debug() {}, warn() {}, error() {} }) }),
}));

import { PianoMenu } from './PianoMenu.jsx';

const OPEN_GATE = {
  status: 'ready', pending: false, gated: false, course: null,
  videosLocked: false, videos: { locked: false, reason: 'no-cap', completedToday: 0, cap: null },
};

// PianoTile renders a real <button class="piano-tile" disabled>, so the tile's
// own disabled attribute is the assertion — not an aria hint over a live control.
const tile = (label) => Array.from(document.querySelectorAll('.piano-tile'))
  .find((t) => t.textContent.includes(label));

beforeEach(() => {
  state.lessonGate = { ...OPEN_GATE };
  state.gameAccess = { status: 'ready', state: 'complete', unlocked: true };
});

const renderMenu = () => render(<MemoryRouter><PianoMenu /></MemoryRouter>);

describe('PianoMenu videos tile under the daily cap', () => {
  it('leaves the tile live under the cap', () => {
    renderMenu();
    expect(tile('Courses').disabled).toBe(false);
  });

  it('disables the tile once the cap is reached', () => {
    state.lessonGate = {
      ...OPEN_GATE, videosLocked: true,
      videos: { locked: true, reason: 'daily-cap', completedToday: 2, cap: 2 },
    };
    renderMenu();
    expect(tile('Courses').disabled).toBe(true);
  });

  it('says why, with the count that closed it', () => {
    state.lessonGate = {
      ...OPEN_GATE, videosLocked: true,
      videos: { locked: true, reason: 'daily-cap', completedToday: 2, cap: 2 },
    };
    renderMenu();
    expect(screen.getByText(/2 of 2 lessons today/i)).toBeTruthy();
  });

  it('leaves every other tile alone — the cap is about video, not the kiosk', () => {
    state.lessonGate = {
      ...OPEN_GATE, videosLocked: true,
      videos: { locked: true, reason: 'daily-cap', completedToday: 2, cap: 2 },
    };
    renderMenu();
    expect(tile('Games').disabled).toBe(false);
  });
});
