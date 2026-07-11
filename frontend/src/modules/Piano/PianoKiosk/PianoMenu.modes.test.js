import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PIANO_MODES, PianoMenu } from './PianoMenu.jsx';

// Lightweight stubs so PianoMenu renders without its full context/hardware chain.
// The tile-grid assertion below only inspects the <ul>, so the tiles' innards and
// the live keyboard are irrelevant here.
vi.mock('./PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({
    pianoId: 'test-piano',
    basePath: '/piano',
    config: { keyboard: { startNote: 21, endNote: 108 } },
  }),
}));
vi.mock('./PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ pressNote: () => {}, releaseNote: () => {} }),
}));
vi.mock('./LiveKeyboard.jsx', () => ({ default: () => null }));
vi.mock('./PianoTile.jsx', () => ({ default: () => null }));
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info() {}, debug() {}, warn() {}, error() {} }) }),
}));

// Locks the home-menu tile contract: 10 tiles, the Producer tile present but
// disabled (greyed, non-clickable — reachable only via its route), and the
// Lessons mode surfaced under the "Training" label. Every tile carries an icon.
describe('PIANO_MODES (home menu tiles)', () => {
  it('has 10 tiles', () => {
    expect(PIANO_MODES).toHaveLength(10);
  });

  it('includes the expected mode ids in grid order', () => {
    expect(PIANO_MODES.map((m) => m.id)).toEqual([
      'videos', 'music', 'sheetmusic', 'studio', 'composer',
      'playalong', 'singalong', 'lessons', 'games', 'producer',
    ]);
  });

  it('labels the lessons mode "Training"', () => {
    const lessons = PIANO_MODES.find((m) => m.id === 'lessons');
    expect(lessons.label).toBe('Training');
  });

  it('marks Producer disabled and leaves every other tile enabled', () => {
    const disabled = PIANO_MODES.filter((m) => m.disabled).map((m) => m.id);
    expect(disabled).toEqual(['producer']);
  });

  it('uses the expected icons for the new/renamed tiles', () => {
    expect(PIANO_MODES.find((m) => m.id === 'singalong').icon).toBe('singalong');
    expect(PIANO_MODES.find((m) => m.id === 'composer').icon).toBe('quill');      // quill = compose
    expect(PIANO_MODES.find((m) => m.id === 'lessons').icon).toBe('metronome');   // Training
  });

  it('gives every tile an icon', () => {
    for (const m of PIANO_MODES) expect(m.icon).toBeTruthy();
  });
});

// The tile grid's column count is driven by balancedColumns(itemCount) via a
// --tile-cols CSS custom property, so the shared grid centers any menu. The home
// menu has 10 tiles → 5 columns (its shipped 5×2 layout must not change).
describe('PianoMenu (tile grid columns)', () => {
  it('sets --tile-cols from the balanced column count (10 modes → 5)', () => {
    // JSX-free render (this file is a .test.js) — wrap in a router for useNavigate.
    render(createElement(MemoryRouter, null, createElement(PianoMenu)));
    const ul = document.querySelector('.piano-menu__tiles');
    expect(ul).toBeTruthy();
    expect(ul.style.getPropertyValue('--tile-cols')).toBe('5');
  });
});
