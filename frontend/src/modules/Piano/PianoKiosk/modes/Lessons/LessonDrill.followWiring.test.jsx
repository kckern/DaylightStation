import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const api = vi.fn();
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));

// Stub the notation renderer (pulls abcjs / DOM) but keep the real expander and
// sequence helpers — the drill's follow targets are pure and are what this test
// exercises. Mirrors the pattern in Lessons.test.jsx.
vi.mock('../../../../MusicNotation/index.js', async (orig) => {
  const actual = await orig();
  return { ...actual, AbcRenderer: () => <div data-testid="abc" />, generateMelodyAbc: () => 'X:1' };
});

// Capture the drill's MIDI subscription handler so the test can drive synthetic
// note_on events, instead of the no-op subscribe Lessons.test.jsx uses.
let midiHandler = null;
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({
    subscribe: (cb) => { midiHandler = cb; return () => {}; },
    pressNote: () => {},
    releaseNote: () => {},
  }),
  usePianoMidiNotes: () => ({ activeNotes: new Map(), noteHistory: [], sustainPedal: false, isPlaying: false }),
}));
vi.mock('../../../components/PianoKeyboard.jsx', () => ({ PianoKeyboard: () => <div data-testid="keyboard" /> }));

import { ActivePianoProvider } from '../../PianoConfig.jsx';
import { __clearPianoListCache } from '../../usePianoList.js';
import { Lessons } from './Lessons.jsx';

// A minimal seed that expands (via the real expandDrill) to exactly two right-hand
// cells of two notes each: [60, 64] then [62, 65] — span_octaves = 2/7 makes
// DEGREES_PER_OCTAVE(7) * span_octaves land on exactly 2 steps.
const DRILL = {
  title: 'Two-Cell Drill',
  key: 'C',
  transpose: { direction: 'up', span_octaves: 2 / 7 },
  hands: {
    right: [{ role: 'ascending', notes: [{ midi: 60 }, { midi: 64 }] }],
    left: [],
  },
};

const renderDrill = () => render(
  <MemoryRouter initialEntries={['/lessons/ex-1']}>
    <ActivePianoProvider
      pianoId="test"
      config={{ videos: { plexCollection: null }, music: {}, lessons: { collection: 'hannon' }, voices: [], midi: {}, inactivityMinutes: 10 }}
    >
      <Routes>
        <Route path="lessons/*" element={<Lessons />} />
      </Routes>
    </ActivePianoProvider>
  </MemoryRouter>
);

const press = (note) => act(() => { midiHandler?.({ type: 'note_on', note, velocity: 80 }); });

beforeEach(() => { api.mockReset(); __clearPianoListCache(); midiHandler = null; });

describe('LessonDrill follow wiring', () => {
  it('advances the cursor across cells, tolerates a near-miss, and completes with a score', async () => {
    api.mockImplementation((path) => {
      if (path === 'api/v1/piano/lessons/hannon/ex-1') return Promise.resolve(DRILL);
      return Promise.resolve({});
    });

    renderDrill();
    await screen.findByText('Two-Cell Drill');
    expect(await screen.findByText('1 / 4')).toBeTruthy();
    expect(midiHandler).toBeTruthy();

    press(60); // cell 1, note 1 — correct
    expect(await screen.findByText('2 / 4')).toBeTruthy();

    press(63); // a near-miss (target is 64, within the plausibility window): counts against
    // the current cell but must not advance or stall the cursor.
    expect(await screen.findByText('2 / 4')).toBeTruthy();

    press(64); // cell 1, note 2 — correct, closes cell 1
    expect(await screen.findByText('3 / 4')).toBeTruthy();

    press(62); // cell 2, note 1 — correct
    expect(await screen.findByText('4 / 4')).toBeTruthy();

    press(65); // cell 2, note 2 — correct, completes the drill
    expect(await screen.findByText('Complete')).toBeTruthy();

    const result = await screen.findByText(/^Score /);
    expect(result.textContent).toMatch(/^Score \d+/);
  });
});
