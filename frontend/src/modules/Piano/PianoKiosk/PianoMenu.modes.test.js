import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PianoMenu } from './PianoMenu.jsx';
import { PIANO_MODES } from './pianoModes.js';
import { __clearPianoListCache } from './usePianoList.js';

// Lightweight stubs so PianoMenu renders without its full context/hardware chain.
// The tile-grid assertion below only inspects the <ul>, so the tiles' innards and
// the live keyboard are irrelevant here — except the label, which the activity-strip
// integration test (below) needs to confirm the tile wall still renders.
let activityResponse;
const schoolGate = vi.hoisted(() => ({ status: 'ready', state: 'complete', unlocked: true }));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(() => Promise.resolve(activityResponse)) }));
vi.mock('./PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({
    pianoId: 'test-piano',
    basePath: '/piano',
    config: { keyboard: { startNote: 21, endNote: 108 } },
  }),
}));
vi.mock('./PianoUserContext.jsx', () => ({
  usePianoUser: () => ({ currentUser: 'learner1', setCurrentUser: () => {} }),
}));
vi.mock('./useSchoolGameAccess.js', () => ({
  default: () => schoolGate,
}));
// This file is about the tile wall and the School games gate. A named learner's
// lesson verdict is PENDING at first paint (it disables everything until it
// lands, by design — see PianoMenu.gate.test.js), so stub it as already-answered
// or every assertion here would be measuring the wrong gate.
vi.mock('./usePianoLessonGate.js', () => ({
  default: () => ({ status: 'ready', gated: false, course: null, unit: null, lesson: null, challenge: null }),
}));
vi.mock('./PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ pressNote: () => {}, releaseNote: () => {} }),
}));
vi.mock('./LiveKeyboard.jsx', () => ({ default: () => null }));
vi.mock('./PianoTile.jsx', () => ({
  default: ({ label, blurb, disabled }) => createElement('button', { disabled, title: blurb }, label),
}));
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info() {}, debug() {}, warn() {}, error() {} }) }),
}));

// Locks the home-menu tile contract: 10 tiles, Producer present but statically
// disabled (Games is dynamically gated from School completion), and the exercise bank surfaced as "Exercises"
// (formerly the hard-wired Hanon-only "Training" tile). Every tile carries an
// icon.
describe('PIANO_MODES (home menu tiles)', () => {
  it('has 10 tiles', () => {
    expect(PIANO_MODES).toHaveLength(10);
  });

  it('includes the expected mode ids in grid order', () => {
    expect(PIANO_MODES.map((m) => m.id)).toEqual([
      'videos', 'music', 'sheetmusic', 'studio', 'composer',
      'playalong', 'singalong', 'exercises', 'games', 'producer',
    ]);
  });

  it('labels the bank mode "Exercises"', () => {
    const exercises = PIANO_MODES.find((m) => m.id === 'exercises');
    expect(exercises.label).toBe('Exercises');
  });

  it('marks only Producer statically disabled; Games uses the runtime school gate', () => {
    const disabled = PIANO_MODES.filter((m) => m.disabled).map((m) => m.id);
    expect(disabled).toEqual(['producer']);
  });

  it('uses the expected icons for the new/renamed tiles', () => {
    expect(PIANO_MODES.find((m) => m.id === 'singalong').icon).toBe('singalong'); // Karaoke — mic icon
    expect(PIANO_MODES.find((m) => m.id === 'composer').icon).toBe('quill');      // quill = compose
    expect(PIANO_MODES.find((m) => m.id === 'exercises').icon).toBe('metronome'); // Exercises
  });

  it('gives every tile an icon', () => {
    for (const m of PIANO_MODES) expect(m.icon).toBeTruthy();
  });
});

// The tile grid's column count is driven by balancedColumns(itemCount) via a
// --tile-cols CSS custom property, so the shared grid centers any menu. The home
// menu has 10 tiles → 5 columns (fewest rows that fit within the 5-col cap).
describe('PianoMenu (tile grid columns)', () => {
  beforeEach(() => Object.assign(schoolGate, { status: 'ready', state: 'complete', unlocked: true }));

  it('sets --tile-cols from the balanced column count (10 modes → 5)', () => {
    // JSX-free render (this file is a .test.js) — wrap in a router for useNavigate.
    render(createElement(MemoryRouter, null, createElement(PianoMenu)));
    const ul = document.querySelector('.piano-menu__tiles');
    expect(ul).toBeTruthy();
    expect(ul.style.getPropertyValue('--tile-cols')).toBe('5');
  });
});

describe('PianoMenu (school completion gate)', () => {
  beforeEach(() => Object.assign(schoolGate, { status: 'ready', state: 'complete', unlocked: true }));

  it('enables Games after completion', () => {
    render(createElement(MemoryRouter, null, createElement(PianoMenu)));
    expect(screen.getByRole('button', { name: 'Games' }).disabled).toBe(false);
  });

  it('locks Games with an explanation while schoolwork is incomplete', () => {
    Object.assign(schoolGate, { status: 'ready', state: 'incomplete', unlocked: false });
    render(createElement(MemoryRouter, null, createElement(PianoMenu)));
    const games = screen.getByRole('button', { name: 'Games' });
    expect(games.disabled).toBe(true);
    expect(games.title).toBe('Finish school to unlock');
  });
});

// Integration-lite: the menu activity strip (Task 8, spec
// 2026-07-28-piano-menu-activity-strip) mounts inside PianoMenu, above the tile
// wall, without displacing it. Reuses Task 8's DaylightAPI mock pattern.
describe('PianoMenu (activity strip)', () => {
  // The strip reads through the shared SWR list cache — an earlier render in
  // this file already cached an empty strip, so clear it (and the remembered
  // skeleton shape) or this test would assert against that stale entry.
  beforeEach(() => {
    activityResponse = { players: [] };
    __clearPianoListCache();
    localStorage.clear();
  });

  it('renders the activity strip alongside the tile wall', async () => {
    activityResponse = {
      players: [{
        userId: 'learner2', name: 'learner2', lastPlayedAt: '2026-07-28T10:00:00Z',
        courses: [{
          courseId: 'plex:11', courseTitle: 'Course B', thumbnail: '/img/b',
          completed: 13, total: 57, percent: 23, lastPlayedAt: '2026-07-28T10:00:00Z',
        }],
      }],
    };
    render(createElement(MemoryRouter, null, createElement(PianoMenu)));
    await waitFor(() => expect(screen.getByAltText('Course B')).toBeTruthy());
    expect(screen.getByText('Courses')).toBeTruthy();
  });
});
