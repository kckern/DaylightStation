import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Midi } from '@tonejs/midi';

// Mock the kiosk contexts the Producer depends on.
const pressNote = vi.fn();
const releaseNote = vi.fn();
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ activeNotes: new Map(), pressNote, releaseNote, subscribe: () => () => {} }),
}));
vi.mock('../../PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({ config: { keyboard: { startNote: 21, endNote: 108 } } }),
}));
vi.mock('../../usePianoScreensaver.jsx', () => ({ useKeepScreenAwake: () => {} }));
vi.mock('../../../components/PianoKeyboard.jsx', () => ({ PianoKeyboard: () => <div data-testid="keyboard" /> }));

import { Producer } from './Producer.jsx';

// A small but valid loop library + a real MIDI buffer for note loading.
const INDEX_YML = `
- slug: dm-c-f-gm
  path: chord-progressions/niko/dm-c-f-gm.mid
  type: chord-progression
  sources: [niko-chord]
  mood: Catchy
  chords: [Dm, C, F, Gm]
  roman: [i, bVII, bIII, iv]
  title: "Dm C · F Gm"
  signature: i-bVII-bIII-iv
  barSpan: 4
  bpm: 120
- slug: catchy-hook-5-6-1
  path: melodies/starters/catchy/catchy-hook-5-6-1.mid
  type: melody
  sources: [melody-starters]
  mood: Catchy
  degrees: [5, 6, 1]
  title: "Catchy Hook"
- slug: am-f-g-am
  path: chord-progressions/other/am-f-g-am.mid
  type: chord-progression
  sources: [other]
  mood: Sad
  roman: [iii, I, II, iii]
  title: "Am F · G Am"
  signature: iii-I-II-iii
  barSpan: 4
  bpm: 100
- slug: different-progression-loop
  path: chord-progressions/other/different-progression-loop.mid
  type: chord-progression
  sources: [other]
  mood: Catchy
  roman: [ii, V, I]
  title: "Different Progression Loop"
  signature: ii-V-I
  barSpan: 3
  bpm: 120
`;

function midiBuffer() {
  const m = new Midi();
  const tr = m.addTrack();
  tr.addNote({ midi: 62, time: 0, duration: 0.5 });
  tr.addNote({ midi: 65, time: 0.5, duration: 0.5 });
  return m.toArray(); // Uint8Array
}

beforeEach(() => {
  pressNote.mockClear();
  global.fetch = vi.fn((url) => {
    if (url.endsWith('index.yml')) return Promise.resolve({ text: () => Promise.resolve(INDEX_YML) });
    return Promise.resolve({ arrayBuffer: () => Promise.resolve(midiBuffer().buffer) });
  });
});

describe('Producer (loop-layering)', () => {
  it('loads the loop library and lists browseable loops', async () => {
    render(<Producer />);
    // After 5.3, the primary label is title (or slug if no title), not raw slug
    await waitFor(() => expect(screen.getByText('Dm C · F Gm')).toBeInTheDocument());
    expect(screen.getByText('Catchy Hook')).toBeInTheDocument();
    // roman progression rendered via RomanProgression component
    expect(document.querySelector('.roman-progression')).toBeTruthy();
  });

  it('picks a base and shows it as the base layer plus ranked layer suggestions', async () => {
    render(<Producer />);
    const baseBtn = await screen.findByText('Dm C · F Gm');
    fireEvent.click(baseBtn.closest('button'));

    // base now appears in the layer rack with its role…
    await waitFor(() => expect(screen.getByText('Add a layer')).toBeInTheDocument());
    expect(screen.getAllByText('chords').length).toBeGreaterThan(0); // base role label
    // …and the complementary melody is offered as a layer suggestion.
    expect(screen.getByText('Catchy Hook')).toBeInTheDocument();
  });

  it('starts the transport when Play is pressed (fires loop notes through pressNote)', async () => {
    render(<Producer />);
    fireEvent.click((await screen.findByText('Dm C · F Gm')).closest('button'));
    const play = await screen.findByText(/Play/);
    fireEvent.click(play);
    await waitFor(() => expect(pressNote).toHaveBeenCalled());
  });

  // Task 5.3: title + roman notation replaces slug labels
  it('labels a loop by title + roman, not the slug', async () => {
    render(<Producer />);
    await waitFor(() => expect(screen.getByText('Dm C · F Gm')).toBeInTheDocument());
    expect(screen.queryByText('dm-c-f-gm')).toBeNull();
    expect(document.querySelector('.roman-progression')).toBeTruthy();
  });
});
