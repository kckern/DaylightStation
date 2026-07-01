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

  // Task 5.5: detected key + editable tempo
  it('shows the detected key and an editable tempo, defaulting to base bpm', async () => {
    render(<Producer />);
    const baseBtn = await screen.findByText('Dm C · F Gm');
    fireEvent.click(baseBtn.closest('button'));
    // After picking a base (bpm 120), the tempo display updates to 120
    await waitFor(() => {
      const tempoEl = document.querySelector('[aria-label="tempo"]');
      expect(tempoEl).toBeTruthy();
      expect(tempoEl.textContent).toContain('120');
    });
    // key control is present in the deck
    expect(document.querySelector('.piano-producer-mode__key')).toBeTruthy();
  });

  // Task 5.6: per-layer Mute + Solo
  it('solo isolates a layer — M and S buttons present on each layer row', async () => {
    render(<Producer />);
    const baseBtn = await screen.findByText('Dm C · F Gm');
    fireEvent.click(baseBtn.closest('button'));
    await waitFor(() => expect(screen.getByText('Add a layer')).toBeInTheDocument());
    // Add the catchy hook as a second layer
    const layerBtn = await screen.findByText('Catchy Hook');
    fireEvent.click(layerBtn.closest('button'));
    await waitFor(() => {
      // Both M and S buttons should be present (one per layer)
      const soloButtons = document.querySelectorAll('[aria-label="solo"]');
      expect(soloButtons.length).toBeGreaterThan(0);
      const muteButtons = document.querySelectorAll('[aria-label="mute"]');
      expect(muteButtons.length).toBeGreaterThan(0);
    });
    // Clicking solo on the first layer: the S button becomes aria-pressed=true
    const soloBtn = document.querySelector('[aria-label="solo"]');
    fireEvent.click(soloBtn);
    await waitFor(() => {
      expect(document.querySelector('[aria-label="solo"].is-on')).toBeTruthy();
    });
  });

  // Task 5.8: peek preview — doesn't add to stack
  it('peek previews a loop without adding it to the stack', async () => {
    render(<Producer />);
    // In browse mode (no base), all rows have a peek button
    await waitFor(() => expect(document.querySelector('.piano-loop__peek')).toBeTruthy());
    // Click peek on a row
    const peekBtn = document.querySelector('.piano-loop__peek');
    fireEvent.click(peekBtn);
    // layers (the real stack) should still be empty — peek doesn't commit
    await waitFor(() => {
      expect(document.querySelectorAll('.piano-layer').length).toBe(0);
    });
  });

  // Task 5.7: base-swap keeps stack + browse library affordance
  it('removing the base promotes the next layer instead of clearing the stack', async () => {
    render(<Producer />);
    // Pick base
    const baseBtn = await screen.findByText('Dm C · F Gm');
    fireEvent.click(baseBtn.closest('button'));
    await waitFor(() => expect(screen.getByText('Add a layer')).toBeInTheDocument());
    // Add catchy hook as second layer — it's harmonically compatible (melody, null roman wildcard)
    const layerBtn = await screen.findByText('Catchy Hook');
    fireEvent.click(layerBtn.closest('button'));
    await waitFor(() => {
      const layers = document.querySelectorAll('.piano-layer');
      expect(layers.length).toBe(2);
    });
    // Remove the base (first layer's ✕ button)
    const removeBtn = document.querySelector('.piano-layer__remove');
    fireEvent.click(removeBtn);
    await waitFor(() => {
      // Stack should still have 1 layer (Catchy Hook promoted to base), not 0
      const layers = document.querySelectorAll('.piano-layer');
      expect(layers.length).toBe(1);
      // The "Add a layer" section is still visible (base still set)
      expect(screen.getByText('Add a layer')).toBeInTheDocument();
    });
  });

  it('a "Browse library" affordance is present while a base is set', async () => {
    render(<Producer />);
    const baseBtn = await screen.findByText('Dm C · F Gm');
    fireEvent.click(baseBtn.closest('button'));
    await waitFor(() => expect(screen.getByText('Add a layer')).toBeInTheDocument());
    // A browse library button should be present
    expect(screen.getByRole('button', { name: /browse library|add from library/i })).toBeTruthy();
  });

  // Task 5.11: showRoman toggle chip is present in the deck
  it('has a Roman toggle chip in the deck', async () => {
    render(<Producer />);
    await waitFor(() => expect(screen.getByText('Dm C · F Gm')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /roman/i })).toBeTruthy();
  });

  // Task 5.12: on-ramp hint before base is chosen
  it('shows a one-line on-ramp before a base is chosen', async () => {
    render(<Producer />);
    await waitFor(() => expect(screen.getByText('Dm C · F Gm')).toBeInTheDocument());
    expect(screen.getByText(/pick a base loop/i)).toBeTruthy();
  });

  // Task 5.12: staff thumbnails for melodic loops
  it('shows a staff thumbnail for a melodic loop with no roman', async () => {
    render(<Producer />);
    await waitFor(() => expect(screen.getByText('Catchy Hook')).toBeInTheDocument());
    // Catchy Hook has type:melody, roman:null → should render a staff element
    expect(document.querySelector('.action-staff, svg')).toBeTruthy();
  });

  // Task 5.4: harmonically-incompatible candidates excluded from suggestions
  it('omits harmonically-incompatible candidates from suggestions', async () => {
    render(<Producer />);
    // Pick the dm-c-f-gm base (signature i-bVII-bIII-iv)
    const baseBtn = await screen.findByText('Dm C · F Gm');
    fireEvent.click(baseBtn.closest('button'));
    // After base is picked, the "Add a layer" section appears
    await waitFor(() => expect(screen.getByText('Add a layer')).toBeInTheDocument());
    // "Different Progression Loop" has signature ii-V-I — must NOT appear as a candidate
    expect(screen.queryByText('Different Progression Loop')).toBeNull();
  });
});
