/**
 * Producer shell tests (Task 4.4) — WIRING tests, not audio tests.
 *
 * gmSynth / voiceRouter / useProducerTransport are mocked (they carry their
 * own suites in producer/); these tests assert the shell wires them right:
 * front doors → overlay → ADD_LAYER → rows → transport inputs → teardown.
 *
 * Delta from the old suite (single-stack jam): the tap-▶ peek preview test is
 * gone deliberately — the library surface (LibraryBrowser) has no audition;
 * Task 5.2 brings press-to-peek. The "transport fires pressNote" test became "play
 * routes through useProducerTransport" — loop sound goes through the
 * voiceRouter now, never pressNote (the user's own path). Everything else has
 * an equivalent here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Midi } from '@tonejs/midi';

// ── kiosk context mocks ───────────────────────────────────────────────────────
const pressNote = vi.fn();
const releaseNote = vi.fn();
const midiMock = vi.hoisted(() => ({}));
vi.mock('../../PianoMidiContext.jsx', () => ({ usePianoMidi: () => midiMock }));
vi.mock('../../PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({
    config: {
      keyboard: { startNote: 21, endNote: 108 },
      producer: { voiceTiers: { onboardGm: false } },
    },
  }),
}));
vi.mock('../../usePianoScreensaver.jsx', () => ({ useKeepScreenAwake: () => {} }));
vi.mock('../../../components/PianoKeyboard.jsx', () => ({ PianoKeyboard: () => <div data-testid="keyboard" /> }));

// ── sound-engine mocks (wiring focus) ─────────────────────────────────────────
const synthMock = vi.hoisted(() => ({
  dispose: vi.fn(),
  resume: vi.fn(() => Promise.resolve()),
  load: vi.fn(() => Promise.resolve()),
  loadDrums: vi.fn(() => Promise.resolve()),
  noteOn: vi.fn(),
  noteOff: vi.fn(),
  setChannelProgram: vi.fn(),
  setChannelGain: vi.fn(),
  allNotesOff: vi.fn(),
}));
const createGmSynth = vi.hoisted(() => vi.fn(() => synthMock));
vi.mock('../../producer/gmSynth.js', () => ({ createGmSynth, default: createGmSynth }));

const routerMock = vi.hoisted(() => ({
  noteOn: vi.fn(),
  noteOff: vi.fn(),
  configureLayer: vi.fn(),
  allNotesOff: vi.fn(),
  panic: vi.fn(),
  dispose: vi.fn(),
}));
const createVoiceRouter = vi.hoisted(() => vi.fn(() => routerMock));
vi.mock('../../producer/voiceRouter.js', () => ({ createVoiceRouter, default: createVoiceRouter }));

const transportMock = vi.hoisted(() => ({
  isPlaying: false,
  play: vi.fn(),
  stop: vi.fn(),
  toggle: vi.fn(),
  positionRef: { current: { normalized: 0, bar: 0, beat: 0, blockIndex: -1 } },
  queueJump: vi.fn(),
  pendingJumpRef: { current: null },
  lengthMs: 0,
}));
const transportArgs = vi.hoisted(() => ({ last: null }));
vi.mock('../../producer/useProducerTransport.js', () => ({
  useProducerTransport: (args) => { transportArgs.last = args; return transportMock; },
  default: (args) => { transportArgs.last = args; return transportMock; },
}));

import { Producer } from './Producer.jsx';

// ── fixture library ───────────────────────────────────────────────────────────
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
  timeline: [[0, 3, 7], [10, 2, 5], [3, 7, 10], [5, 8, 0]]
  timelineRoot: 2
  specificity: triad
- slug: catchy-hook-5-6-1
  path: melodies/starters/catchy/catchy-hook-5-6-1.mid
  type: melody
  sources: [melody-starters]
  mood: Catchy
  degrees: [5, 6, 1]
  title: "Catchy Hook"
  timeline: [[0], [3], [7], [5]]
  timelineRoot: 2
  specificity: root
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
  timeline: [[2, 5, 9], [7, 11, 2], [0, 4, 7]]
  timelineRoot: 0
  specificity: triad
- slug: broken-melody
  path: melodies/other/broken-melody.mid
  type: melody
  sources: [other]
  title: "Broken Melody"
- slug: basic-rock
  path: grooves/basic-rock.mid
  type: groove
  feel: rock
  title: "Basic Rock"
  barSpan: 2
`;

function midiBuffer() {
  const m = new Midi();
  const tr = m.addTrack();
  tr.addNote({ midi: 62, time: 0, duration: 0.5 });
  tr.addNote({ midi: 65, time: 0.5, duration: 0.5 });
  return m.toArray(); // Uint8Array
}

/** A structurally valid MIDI file with ZERO notes — the "load lands empty" case. */
function emptyMidiBuffer() {
  const m = new Midi();
  m.addTrack();
  return m.toArray();
}

beforeEach(() => {
  vi.clearAllMocks();
  transportMock.isPlaying = false;
  transportArgs.last = null;
  Object.assign(midiMock, {
    activeNotes: new Map(),
    pressNote,
    releaseNote,
    connected: false,
    subscribe: () => () => {},
    sendNote: vi.fn(),
    sendNoteOff: vi.fn(),
    sendProgramChange: vi.fn(),
    sendControlChange: vi.fn(),
  });
  // ensureAudio path: createGmSynth is mocked, but the shell still constructs
  // a real-looking AudioContext first.
  global.window.AudioContext = class { close() { return Promise.resolve(); } };
  global.fetch = vi.fn((url) => {
    if (url.endsWith('index.yml')) return Promise.resolve({ text: () => Promise.resolve(INDEX_YML) });
    if (url.includes('broken-melody')) return Promise.resolve({ arrayBuffer: () => Promise.resolve(emptyMidiBuffer().buffer) });
    return Promise.resolve({ arrayBuffer: () => Promise.resolve(midiBuffer().buffer) });
  });
});

/** Open the library via the Browse front door. */
async function openLibrary() {
  fireEvent.click(await screen.findByRole('button', { name: /browse the library/i }));
  await screen.findByRole('dialog', { name: 'loop library' });
}

/** Front door → overlay → pick the Dm chord loop; waits for its row. */
async function addDmLayer() {
  await openLibrary();
  fireEvent.click(await screen.findByRole('button', { name: 'Dm C · F Gm' }));
  await waitFor(() => expect(document.querySelectorAll('.piano-channel-strip').length).toBe(1));
}

describe('Producer shell (three bands)', () => {
  it('renders the four front-door entry cards when the workspace is empty', async () => {
    render(<Producer />);
    expect(await screen.findByRole('button', { name: /browse the library/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /start from a loop/i })).toBeEnabled();
    const record = screen.getByRole('button', { name: /record my own/i });
    expect(record).toBeDisabled();
    const songs = screen.getByRole('button', { name: /songs & resume/i });
    expect(songs).toBeDisabled();
  });

  it('play is disabled with no layers; the keyboard band is always live', async () => {
    render(<Producer />);
    expect(await screen.findByRole('button', { name: /play/i })).toBeDisabled();
    expect(screen.getByTestId('keyboard')).toBeInTheDocument();
  });

  it('opening the library hides the transport bar and keyboard bands (full-bleed)', async () => {
    render(<Producer />);
    await screen.findByRole('button', { name: /browse the library/i });
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
    await openLibrary();
    expect(screen.queryByRole('button', { name: /play/i })).toBeNull();
    expect(screen.queryByTestId('keyboard')).toBeNull();
  });

  it('lists browseable loops in the overlay (title + roman, never the slug)', async () => {
    render(<Producer />);
    await openLibrary();
    expect(await screen.findByRole('button', { name: 'Dm C · F Gm' })).toBeInTheDocument();
    expect(screen.getByText('Catchy Hook')).toBeInTheDocument();
    expect(screen.queryByText('dm-c-f-gm')).toBeNull();
    expect(document.querySelector('.roman-progression')).toBeTruthy();
  });

  it('shows a staff thumbnail for a melodic loop with no roman', async () => {
    render(<Producer />);
    await openLibrary();
    await screen.findByText('Catchy Hook');
    expect(document.querySelector('.piano-loop__staff svg, .piano-loop__staff .action-staff')).toBeTruthy();
  });

  it('browse → tap a loop: overlay closes, a layer row appears with glyph + role, play enables', async () => {
    render(<Producer />);
    await addDmLayer();
    // Overlay closed, three bands back.
    expect(screen.queryByRole('dialog', { name: 'loop library' })).toBeNull();
    // Row: glyph + role + roman identity + M/S + remove.
    const row = document.querySelector('.piano-channel-strip');
    expect(row.querySelector('.piano-material-glyph')).toBeTruthy();
    expect(screen.getByText('chords')).toBeInTheDocument();
    expect(row.querySelector('.roman-progression')).toBeTruthy();
    // Play is now enabled.
    expect(screen.getByRole('button', { name: /play/i })).toBeEnabled();
  });

  it('adopts the first layer\'s bpm (bpmHint) into the transport bar', async () => {
    render(<Producer />);
    await addDmLayer();
    expect(screen.getByLabelText('tempo').textContent).toContain('120');
  });

  it('M and S latch through the reducer (aria-pressed reflects workspace state)', async () => {
    render(<Producer />);
    await addDmLayer();
    const mute = screen.getByLabelText('mute');
    expect(mute).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(mute);
    await waitFor(() => expect(screen.getByLabelText('mute')).toHaveAttribute('aria-pressed', 'true'));
    const solo = screen.getByLabelText('solo');
    fireEvent.click(solo);
    await waitFor(() => expect(screen.getByLabelText('solo')).toHaveAttribute('aria-pressed', 'true'));
    expect(document.querySelector('.piano-channel-strip__s.is-on')).toBeTruthy();
  });

  it('feeds loaded notes to the transport as channel-tagged layers (memoized seam)', async () => {
    render(<Producer />);
    await addDmLayer();
    await waitFor(() => expect(transportArgs.last.layers.length).toBe(1));
    const layer = transportArgs.last.layers[0];
    expect(layer.channel).toBe(0);
    expect(layer.notes.length).toBeGreaterThan(0);
    expect(transportArgs.last.router).toBe(routerMock);
    expect(transportArgs.last.bpm).toBe(120);
  });

  it('configures the router voice for an added layer (program + gain)', async () => {
    render(<Producer />);
    await addDmLayer();
    expect(routerMock.configureLayer).toHaveBeenCalledWith(0, { program: 0, gain: 1 });
  });

  it('picking a new voice reaches router.configureLayer via the diff effect (SET_VOICE wiring)', async () => {
    render(<Producer />);
    await addDmLayer();
    routerMock.configureLayer.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'voice' }));
    fireEvent.click(await screen.findByRole('option', { name: 'E-Piano' }));
    await waitFor(() => expect(routerMock.configureLayer).toHaveBeenCalledWith(0, { program: 4, gain: 1 }));
    // The chip reflects the workspace state round-trip.
    expect(screen.getByRole('button', { name: 'voice' })).toHaveTextContent('E-Piano');
  });

  it('play tap unlocks audio (gmSynth created once) and starts the transport', async () => {
    render(<Producer />);
    await addDmLayer();
    fireEvent.click(screen.getByRole('button', { name: /play/i }));
    expect(createGmSynth).toHaveBeenCalledTimes(1);
    expect(synthMock.resume).toHaveBeenCalled();
    expect(transportMock.play).toHaveBeenCalledTimes(1);
    // While "playing", the button becomes Stop and stops the transport.
    transportMock.isPlaying = true;
    fireEvent.click(screen.getByRole('button', { name: /play|stop/i }));
    expect(transportMock.stop).toHaveBeenCalled();
  });

  it('"+ Add layer" reopens the library gated to consonance-stackable candidates', async () => {
    render(<Producer />);
    await addDmLayer();
    fireEvent.click(screen.getByRole('button', { name: /\+ add layer/i }));
    await screen.findByRole('dialog', { name: 'loop library' });
    // The guardrail indicator is up, and the compatible complement is offered…
    expect(screen.getByText(/showing what fits your jam/i)).toBeInTheDocument();
    expect(await screen.findByText('Catchy Hook')).toBeInTheDocument();
    // …the harmonically clashing loop (its slot-unions vs the base spell no
    // nameable chord) is excluded, and the already-stacked base is not
    // re-offered. (Ported from the interim overlay's stackable-filter test —
    // the gate is now union-consonance, not roman-signature matching.)
    expect(screen.queryByText('Different Progression Loop')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dm C · F Gm' })).toBeNull();
  });

  it('a failed/empty note load removes the layer (no zombie row) and toasts why', async () => {
    render(<Producer />);
    await openLibrary();
    fireEvent.click(await screen.findByRole('button', { name: 'Broken Melody' }));
    // The optimistic row must NOT survive the empty load — front doors return.
    await waitFor(() => expect(screen.getByRole('button', { name: /browse the library/i })).toBeInTheDocument());
    expect(document.querySelectorAll('.piano-channel-strip').length).toBe(0);
    const toast = screen.getByRole('alert');
    expect(toast.textContent).toMatch(/couldn't load/i);
    expect(toast.textContent).toContain('Broken Melody');
    expect(screen.getByRole('button', { name: /play/i })).toBeDisabled();
  });

  it('groove cards are name-only — no drum-pitches-on-a-treble-staff thumb', async () => {
    render(<Producer />);
    await openLibrary();
    const card = await screen.findByRole('button', { name: 'Basic Rock' });
    expect(card.textContent).toContain('Basic Rock');
    expect(card.querySelector('.piano-loop__staff')).toBeNull();
    expect(card.querySelector('svg.action-staff, .piano-loop__staff svg')).toBeNull();
  });

  it('removing the last layer returns the front doors', async () => {
    render(<Producer />);
    await addDmLayer();
    // Remove is a 2-tap confirm (arm, then remove).
    fireEvent.click(screen.getByLabelText('remove layer'));
    fireEvent.click(screen.getByLabelText('remove layer'));
    await waitFor(() => expect(document.querySelectorAll('.piano-channel-strip').length).toBe(0));
    expect(screen.getByRole('button', { name: /browse the library/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /play/i })).toBeDisabled();
  });

  it('removing one of two layers keeps the jam going (no stack wipe)', async () => {
    render(<Producer />);
    await addDmLayer();
    fireEvent.click(screen.getByRole('button', { name: /\+ add layer/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Catchy Hook' }));
    await waitFor(() => expect(document.querySelectorAll('.piano-channel-strip').length).toBe(2));
    fireEvent.click(document.querySelector('.piano-channel-strip__remove'));
    fireEvent.click(document.querySelector('.piano-channel-strip__remove'));
    await waitFor(() => expect(document.querySelectorAll('.piano-channel-strip').length).toBe(1));
    expect(screen.getByRole('button', { name: /\+ add layer/i })).toBeInTheDocument();
  });

  it('the Song tab shows the arrangement placeholder (Task 7.2 fills it)', async () => {
    render(<Producer />);
    await screen.findByRole('tab', { name: 'Song' });
    fireEvent.click(screen.getByRole('tab', { name: 'Song' }));
    expect(screen.getByText(/build sections from your jam/i)).toBeInTheDocument();
    // Back to Mix — state preserved.
    fireEvent.click(screen.getByRole('tab', { name: 'Mix' }));
    expect(screen.getByRole('button', { name: /browse the library/i })).toBeInTheDocument();
  });

  it('has a Roman toggle chip and a record-arm stub in the shell', async () => {
    render(<Producer />);
    await screen.findByRole('button', { name: /browse the library/i });
    expect(screen.getByRole('button', { name: 'roman' })).toBeInTheDocument();
    const rec = screen.getByLabelText('record');
    expect(rec).toBeDisabled();
    expect(rec).toHaveAttribute('title', 'Recording arrives soon');
  });

  it('shows the now-playing pill in the overlay while the jam loops (tap closes)', async () => {
    render(<Producer />);
    await addDmLayer();
    transportMock.isPlaying = true;
    fireEvent.click(screen.getByRole('button', { name: /\+ add layer/i }));
    const pill = await screen.findByRole('button', { name: 'now playing' });
    fireEvent.click(pill);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'loop library' })).toBeNull());
  });

  it('unmount tears the sound path down: transport stop, router dispose, synth dispose', async () => {
    const { unmount } = render(<Producer />);
    await addDmLayer(); // pick gesture ran ensureAudio → synth exists
    expect(createGmSynth).toHaveBeenCalledTimes(1);
    unmount();
    expect(transportMock.stop).toHaveBeenCalled();
    expect(routerMock.dispose).toHaveBeenCalled();
    expect(synthMock.dispose).toHaveBeenCalled();
  });
});
