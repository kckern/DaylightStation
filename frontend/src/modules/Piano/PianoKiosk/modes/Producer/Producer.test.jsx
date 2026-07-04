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
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

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

// ── persistence mocks (Task 8.2) — the store/resume carry their own suites ─────
const storeMock = vi.hoisted(() => ({
  songs: [], crate: [], loops: [], loading: false, error: null,
  saveSong: vi.fn(() => Promise.resolve({ id: 'song1', title: 'Saved' })),
  loadSong: vi.fn(() => Promise.resolve({ id: 'song1', draft: { sections: [], arrangement: [], carriedLayers: {}, meta: {} } })),
  saveCrateItem: vi.fn(() => Promise.resolve({ id: 'c1' })),
  saveLoop: vi.fn(() => Promise.resolve({ id: 'l1' })),
  loadCrateStack: vi.fn(() => Promise.resolve({ id: 'c1', layers: [] })),
  getFull: vi.fn(() => Promise.resolve({ id: 'l1', notes: [], kind: 'idea' })),
  remove: vi.fn(() => Promise.resolve()),
  rename: vi.fn(() => Promise.resolve({})),
  refresh: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../producer/useProducerStore.js', () => ({
  useProducerStore: () => storeMock,
  default: () => storeMock,
}));

const resumeMock = vi.hoisted(() => ({
  hasResume: false, resumeData: null,
  applyResume: vi.fn(() => null), dismiss: vi.fn(), clear: vi.fn(), snapshotNow: vi.fn(),
}));
vi.mock('../../producer/useResumeSnapshot.js', () => ({
  useResumeSnapshot: () => resumeMock,
  default: () => resumeMock,
}));

import { Producer } from './Producer.jsx';

// ── fixture library ───────────────────────────────────────────────────────────
// Manifest bricks (new contract: /api/v1/piano/loop-manifest → { bricks }).
// quality: 'best' is REQUIRED on every entry — LibraryBrowser defaults its
// quality chip to 'best' and filters out anything without it (see
// LibraryBrowser.jsx:306,371); the old YAML fixture predates that facet, so
// every entry here carries it just to stay visible, matching old behavior.
// mood → genre/emotion (arrays): the old single `mood` scalar has no reader
// anywhere in the current pipeline; genre/emotion are the real facets read by
// shared/music/layerMatch.mjs (ranking only, never gating) and the
// LibraryBrowser genre chip (unused by these tests, so exact values are just
// representative). barSpan is preserved even though the real backend
// (loopManifest.mjs) never emits it — draftReducer.js's barSpanOf() still
// reads entry.barSpan as a fallback source, and keeping it here preserves the
// old fixture's "4 bars"/"3 bars" section-length behavior unchanged.
const BRICKS = [
  {
    slug: 'dm-c-f-gm',
    path: 'chord-progressions/niko/dm-c-f-gm.musicxml',
    type: 'chord-progression',
    tags: ['niko-chord'],
    genre: ['Pop'],
    emotion: ['Catchy'],
    quality: 'best',
    roman: ['i', 'bVII', 'bIII', 'iv'],
    title: 'Dm C · F Gm',
    barSpan: 4,
    bpm: 120,
    timeline: [[0, 3, 7], [10, 2, 5], [3, 7, 10], [5, 8, 0]],
    timelineRoot: 2,
    specificity: 'triad',
  },
  {
    slug: 'catchy-hook-5-6-1',
    path: 'melodies/starters/catchy/catchy-hook-5-6-1.musicxml',
    type: 'melody',
    tags: ['melody-starters'],
    genre: ['Pop'],
    emotion: ['Catchy'],
    quality: 'best',
    title: 'Catchy Hook',
    timeline: [[0], [3], [7], [5]],
    timelineRoot: 2,
    specificity: 'root',
  },
  {
    slug: 'am-f-g-am',
    path: 'chord-progressions/other/am-f-g-am.musicxml',
    type: 'chord-progression',
    tags: ['other'],
    genre: ['Pop'],
    emotion: ['Sad'],
    quality: 'best',
    roman: ['iii', 'I', 'II', 'iii'],
    title: 'Am F · G Am',
    barSpan: 4,
    bpm: 100,
  },
  {
    slug: 'different-progression-loop',
    path: 'chord-progressions/other/different-progression-loop.musicxml',
    type: 'chord-progression',
    tags: ['other'],
    genre: ['Pop'],
    emotion: ['Catchy'],
    quality: 'best',
    roman: ['ii', 'V', 'I'],
    title: 'Different Progression Loop',
    barSpan: 3,
    bpm: 120,
    timeline: [[2, 5, 9], [7, 11, 2], [0, 4, 7]],
    timelineRoot: 0,
    specificity: 'triad',
  },
  {
    slug: 'broken-melody',
    path: 'melodies/other/broken-melody.musicxml',
    type: 'melody',
    tags: ['other'],
    quality: 'best',
    title: 'Broken Melody',
  },
  {
    slug: 'basic-rock',
    path: 'grooves/basic-rock.musicxml',
    type: 'groove',
    tags: [],
    quality: 'best',
    title: 'Basic Rock',
    feel: 'rock', // real grooves carry feel (loopManifest derives it from canonical-name)
    barSpan: 2,
  },
];

const STEP_NAMES = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
const SHARP_PCS = new Set([1, 3, 6, 8, 10]);

/**
 * Minimal MusicXML for a sequence of [midi, start, duration] notes (start is
 * documentary only — musicXmlToNotes derives ticks sequentially from
 * durations, so notes must be listed back-to-back with no gaps). divisions=4
 * ⇒ ppq 4; duration units are in those ticks.
 */
function musicXml(notes) {
  const noteXml = notes.map(([midi, , dur]) => {
    const pc = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    const alter = SHARP_PCS.has(pc) ? '<alter>1</alter>' : '';
    return `<note><pitch><step>${STEP_NAMES[pc]}</step>${alter}<octave>${octave}</octave></pitch><duration>${dur}</duration></note>`;
  }).join('');
  return `<?xml version="1.0"?><score-partwise><part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${noteXml}</measure></part></score-partwise>`;
}

/** A structurally valid MusicXML doc with ZERO notes — the "load lands empty" case. */
const EMPTY_MUSICXML = musicXml([]);

beforeEach(() => {
  vi.clearAllMocks();
  transportMock.isPlaying = false;
  transportMock.pendingJumpRef.current = null;
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
    if (url.includes('/loop-manifest')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ bricks: BRICKS }) });
    if (url.includes('broken-melody')) return Promise.resolve({ text: () => Promise.resolve(EMPTY_MUSICXML) });
    return Promise.resolve({ text: () => Promise.resolve(musicXml([[62, 0, 2], [65, 2, 2]])) });
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
    expect(screen.getByRole('button', { name: /record my own/i })).toBeEnabled();
    // 'Songs & Resume' is now wired (Task 8.2) — enabled, opens the picker.
    expect(screen.getByRole('button', { name: /songs & resume/i })).toBeEnabled();
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

  it('lists browseable loops by abstract identity — keyed title is aria-label only, never visible text or slug', async () => {
    render(<Producer />);
    await openLibrary();
    // Cards are addressable by accessible NAME (aria-label = title), but the
    // keyed chord spelling is never visible card text (the library is abstract,
    // transposed at playtime) and the slug is never shown.
    expect(await screen.findByRole('button', { name: 'Dm C · F Gm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Catchy Hook' })).toBeInTheDocument();
    expect(screen.queryByText('Dm C · F Gm')).toBeNull(); // keyed spelling not rendered
    expect(screen.queryByText('dm-c-f-gm')).toBeNull();    // slug not rendered
    expect(document.querySelector('.roman-progression')).toBeTruthy();
  });

  it('shows a staff thumbnail for a melodic loop with no roman', async () => {
    render(<Producer />);
    await openLibrary();
    await screen.findByRole('button', { name: 'Catchy Hook' });
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
    expect(row.querySelector('.piano-chord-lane')).toBeTruthy();
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
    expect(await screen.findByRole('button', { name: 'Catchy Hook' })).toBeInTheDocument();
    // …the harmonically clashing loop (its slot-unions vs the base spell no
    // nameable chord) is excluded, and the already-stacked base is not
    // re-offered. (Ported from the interim overlay's stackable-filter test —
    // the gate is now union-consonance, not roman-signature matching.)
    // Assert exclusion by accessible NAME: keyed titles never render as text,
    // so a queryByText here would pass vacuously.
    expect(screen.queryByRole('button', { name: 'Different Progression Loop' })).toBeNull();
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

  it('groove cards show a feel chip — no keyed name text, no drum-pitches-on-a-treble-staff thumb', async () => {
    render(<Producer />);
    await openLibrary();
    const card = await screen.findByRole('button', { name: 'Basic Rock' });
    // Identity is the feel chip, not the vendor title (aria-label only).
    expect(card.querySelector('.piano-loop__chip')?.textContent).toBe('rock');
    expect(card.textContent).not.toContain('Basic Rock');
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

  it('the Song tab shows the template picker + jam door while no draft exists', async () => {
    render(<Producer />);
    await screen.findByRole('tab', { name: 'Song' });
    fireEvent.click(screen.getByRole('tab', { name: 'Song' }));
    expect(screen.getByRole('button', { name: /pop/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /12-bar/i })).toBeInTheDocument();
    // No jam layers yet → the promote door is disabled.
    expect(screen.getByRole('button', { name: /start from your jam/i })).toBeDisabled();
    // Back to Mix — state preserved.
    fireEvent.click(screen.getByRole('tab', { name: 'Mix' }));
    expect(screen.getByRole('button', { name: /browse the library/i })).toBeInTheDocument();
  });

  it('has a Roman toggle chip and a live record-arm button in the shell', async () => {
    render(<Producer />);
    await screen.findByRole('button', { name: /browse the library/i });
    expect(screen.getByRole('button', { name: 'roman' })).toBeInTheDocument();
    expect(screen.getByLabelText('record')).toBeEnabled();
  });

  it('the record-arm button opens the capture card (and pulses); tapping again closes it', async () => {
    render(<Producer />);
    await screen.findByRole('button', { name: /browse the library/i });
    fireEvent.click(screen.getByLabelText('record'));
    expect(screen.getByRole('dialog', { name: 'capture' })).toBeInTheDocument();
    expect(screen.getByLabelText('record')).toHaveClass('is-armed');
    // Transport + keyboard bands stay live under the card (performance surface).
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
    expect(screen.getByTestId('keyboard')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('record'));
    expect(screen.queryByRole('dialog', { name: 'capture' })).toBeNull();
  });

  it('locks tempo/tap/key while the capture card is open, unlocks on close', async () => {
    render(<Producer />);
    await screen.findByRole('button', { name: /browse the library/i });
    expect(screen.getByLabelText('tempo up')).toBeEnabled();
    fireEvent.click(screen.getByLabelText('record'));
    for (const label of ['tempo down', 'tempo up', 'tap tempo', 'key down', 'key up']) {
      const btn = screen.getByLabelText(label);
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute('title', 'Locked while recording');
    }
    fireEvent.click(screen.getByLabelText('record')); // toggle-close
    expect(screen.getByLabelText('tempo up')).toBeEnabled();
  });

  it('a kept take is stored at CANONICAL pitch (midi − keyShift) so playback transposes once', async () => {
    // Real capture engine + real card; MIDI callback captured from the mock
    // context; rAF stubbed out (note events drive the engine's lazy advance).
    let midiCb = null;
    midiMock.subscribe = (fn) => { midiCb = fn; return () => {}; };
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(100000);
    try {
      render(<Producer />);
      await screen.findByRole('button', { name: /browse the library/i });
      // keyShift +3 BEFORE opening (steppers lock during capture).
      fireEvent.click(screen.getByLabelText('key up'));
      fireEvent.click(screen.getByLabelText('key up'));
      fireEvent.click(screen.getByLabelText('key up'));
      fireEvent.click(screen.getByLabelText('record'));
      fireEvent.click(screen.getByRole('button', { name: /arm/i }));
      // bpm 100 → barMs 2400; count-in 1 → anchor 102400; 4 bars → cycle 9600ms.
      act(() => {
        nowSpy.mockReturnValue(102400);
        midiCb({ type: 'note_on', note: 60, velocity: 90, time: 1 });
        nowSpy.mockReturnValue(102900);
        midiCb({ type: 'note_off', note: 60, velocity: 0, time: 2 });
        // Next event past the cycle boundary rolls pass 1 (lazy advance).
        nowSpy.mockReturnValue(112500);
        midiCb({ type: 'note_on', note: 62, velocity: 70, time: 3 });
        midiCb({ type: 'note_off', note: 62, velocity: 0, time: 4 });
      });
      fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      // The layer landed, and the transport sees CANONICAL pitch (57 = 60 − 3)
      // with the single transpose (keyShift 3) applied at schedule time —
      // played 60 while hearing +3 must NOT come back at 63.
      await waitFor(() => expect(transportArgs.last.layers.length).toBe(1));
      const layer = transportArgs.last.layers[0];
      expect(layer.notes).toHaveLength(1);
      expect(layer.notes[0].midi).toBe(57);
      expect(layer.transpose).toBe(3);
      expect(document.querySelectorAll('.piano-channel-strip').length).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      nowSpy.mockRestore();
    }
  });

  it('the "Record my own" front door opens the capture card', async () => {
    render(<Producer />);
    fireEvent.click(await screen.findByRole('button', { name: /record my own/i }));
    expect(screen.getByRole('dialog', { name: 'capture' })).toBeInTheDocument();
    // Zero layers → no "match jam" chip; metronome path setup offered.
    expect(screen.queryByRole('button', { name: /match jam/i })).toBeNull();
    expect(screen.getByRole('button', { name: /arm/i })).toBeInTheDocument();
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

// ── Song builder wiring (Task 7.2) ───────────────────────────────────────────

/** Jam one layer (notes fully loaded) and promote it — lands on the Song tab. */
async function jamAndPromote() {
  await addDmLayer();
  await waitFor(() => expect(transportArgs.last.layers.length).toBe(1)); // notes loaded
  fireEvent.click(screen.getByRole('button', { name: 'Add to song' }));
  await screen.findByRole('button', { name: 'A slot 1' });
}

/** Flip the mocked transport to "playing" and force a re-render (via the
 * benign Roman toggle — twice, so its own state is unchanged) so the shell's
 * isPlaying edge effects observe the change WITHOUT touching the active tab:
 * the sticky-mode lock latches armedMode on the rising-edge render, and a tab
 * change in that same render would corrupt what real playback would capture
 * (the real transport flips isPlaying synchronously inside play()). */
function setPlaying(playing) {
  transportMock.isPlaying = playing;
  fireEvent.click(screen.getByRole('button', { name: 'roman' }));
  fireEvent.click(screen.getByRole('button', { name: 'roman' }));
}

describe('Song builder wiring (Task 7.2)', () => {
  it('FULL LOOP: jam → Add to song → Song tab slot card; the transport receives the compiled-arrangement input shape', async () => {
    render(<Producer />);
    await jamAndPromote();
    // Auto-switched to the Song tab with one slot (`A ×1 · 4 bars`).
    const slot = screen.getByRole('button', { name: 'A slot 1' });
    expect(slot.textContent).toContain('×1 · 4 bars');
    // Armed for song playback: the arrangement prop has toSchedulerInputs shape.
    const arr = transportArgs.last.arrangement;
    expect(arr).not.toBeNull();
    expect(arr.arrangement).toEqual([{ sectionId: 'sec-1', repeats: 1 }]);
    expect(arr.sections).toHaveLength(1);
    expect(arr.sections[0]).toMatchObject({ id: 'sec-1', lengthBars: 4 });
    const layer = arr.sections[0].stack[0];
    expect(layer.channel).toBe(0);
    expect(layer.notes.length).toBeGreaterThan(0);
    expect(layer).not.toHaveProperty('gmProgram'); // program map is the shell's job
    // Song bpm rides draft.meta (seeded from the jam's adopted 120).
    expect(transportArgs.last.bpm).toBe(120);
    // Play starts the transport in this armed mode.
    fireEvent.click(screen.getByRole('button', { name: /play/i }));
    expect(transportMock.play).toHaveBeenCalledTimes(1);
  });

  it('playback MODE IS STICKY: switching to Mix mid-song-play keeps the arrangement input; stop releases it', async () => {
    render(<Producer />);
    await jamAndPromote();
    fireEvent.click(screen.getByRole('button', { name: /play/i }));
    setPlaying(true); // rising edge on the Song tab → locks 'song'
    fireEvent.click(screen.getByRole('tab', { name: 'Mix' }));
    // Mix tab while the song plays: the transport still holds the arrangement.
    expect(transportArgs.last.arrangement).not.toBeNull();
    // Stop → the lock releases; on the Mix tab the transport is stack-armed.
    setPlaying(false);
    await waitFor(() => expect(transportArgs.last.arrangement).toBeNull());
  });

  it('a refused play() strands no mode lock — arming stays tab-driven while idle', async () => {
    render(<Producer />);
    await jamAndPromote();
    // The mocked play() never starts playback (== the real transport refusing,
    // e.g. totalMs 0). No rising edge → no lock → tabs keep re-arming.
    fireEvent.click(screen.getByRole('button', { name: /play/i }));
    fireEvent.click(screen.getByRole('tab', { name: 'Mix' }));
    expect(transportArgs.last.arrangement).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Song' }));
    expect(transportArgs.last.arrangement).not.toBeNull();
  });

  it('Edit in Mix loads the section WITH the song key/tempo (the loadStack seam) and shows the editing badge', async () => {
    render(<Producer />);
    await addDmLayer();
    fireEvent.click(screen.getByLabelText('key up')); // jam keyShift 1
    await waitFor(() => expect(transportArgs.last.layers[0]?.transpose).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Add to song' })); // meta: bpm 120, keyShift 1
    await screen.findByRole('button', { name: 'A slot 1' });
    // Drift the workspace key AFTER promotion…
    fireEvent.click(screen.getByRole('tab', { name: 'Mix' }));
    fireEvent.click(screen.getByLabelText('key down'));
    fireEvent.click(screen.getByLabelText('key down'));
    await waitFor(() => expect(transportArgs.last.layers[0]?.transpose).toBe(-1));
    // …then open the section: the workspace snaps back to the SONG's key.
    fireEvent.click(screen.getByRole('tab', { name: 'Song' }));
    fireEvent.click(screen.getByRole('button', { name: 'A slot 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit in Mix' }));
    // Landed in Mix: strip present, badge up, promote door relabeled.
    expect(screen.getByRole('button', { name: /browse|add layer/i })).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toContain('Editing section A');
    expect(screen.getByRole('button', { name: 'Update section' })).toBeInTheDocument();
    await waitFor(() => expect(transportArgs.last.layers[0]?.transpose).toBe(1));
    expect(transportArgs.last.bpm).toBe(120);
  });

  it('Update re-promotes and clears the badge; Discard clears ONLY the badge (workspace keeps the stack)', async () => {
    render(<Producer />);
    await jamAndPromote();
    fireEvent.click(screen.getByRole('button', { name: 'A slot 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit in Mix' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    // Re-open and discard: badge clears, the strip (workspace stack) survives.
    fireEvent.click(screen.getByRole('tab', { name: 'Song' }));
    fireEvent.click(screen.getByRole('button', { name: 'A slot 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit in Mix' }));
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.querySelectorAll('.piano-channel-strip').length).toBe(1);
  });

  it('program-map effect: an onBlock section change pushes the section voices via configureLayer (diffed)', async () => {
    render(<Producer />);
    await jamAndPromote(); // section sec-1 holds program 0 on channel 0
    // Drift the WORKSPACE voice so the section's program actually differs.
    fireEvent.click(screen.getByRole('tab', { name: 'Mix' }));
    fireEvent.click(screen.getByRole('button', { name: 'voice' }));
    fireEvent.click(await screen.findByRole('option', { name: 'E-Piano' }));
    await waitFor(() => expect(routerMock.configureLayer).toHaveBeenCalledWith(0, { program: 4, gain: 1 }));
    // Start the song and land on block 0 / sec-1.
    fireEvent.click(screen.getByRole('tab', { name: 'Song' }));
    fireEvent.click(screen.getByRole('button', { name: /play/i }));
    setPlaying(true);
    routerMock.configureLayer.mockClear();
    act(() => { transportArgs.last.onBlock(0, { sectionId: 'sec-1' }); });
    // The incoming section's program map wins back the channel (0 ≠ 4).
    await waitFor(() => expect(routerMock.configureLayer).toHaveBeenCalledWith(0, { program: 0, gain: 1 }));
    // Same section again → no re-push (shared applied map already matches).
    routerMock.configureLayer.mockClear();
    act(() => { transportArgs.last.onBlock(0, { sectionId: 'sec-1' }); });
    expect(routerMock.configureLayer).not.toHaveBeenCalled();
  });

  it('scene launch: tapping another slot mid-play queues a jump to its first block and chips the target', async () => {
    render(<Producer />);
    await jamAndPromote();
    // Second section → arrangement [sec-1 ×1, sec-2 ×1]; entry 1 starts at
    // block 1. (Only the FIRST promote auto-switches tabs — go back manually.)
    fireEvent.click(screen.getByRole('tab', { name: 'Mix' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to song' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Song' }));
    await screen.findByRole('button', { name: 'B slot 2' });
    fireEvent.click(screen.getByRole('button', { name: /play/i }));
    setPlaying(true);
    act(() => { transportArgs.last.onBlock(0, { sectionId: 'sec-1' }); }); // active: slot 1
    transportMock.queueJump.mockImplementation(() => {
      transportMock.pendingJumpRef.current = { targetIdx: 1 };
    });
    const slotB = screen.getByRole('button', { name: 'B slot 2' });
    fireEvent.pointerDown(slotB);
    fireEvent.pointerUp(slotB);
    expect(transportMock.queueJump).toHaveBeenCalledWith(1, 'repeat');
    expect(screen.getByText('next →')).toBeInTheDocument();
    // The jump lands (pendingJumpRef drained + onBlock) → the chip clears.
    transportMock.pendingJumpRef.current = null;
    act(() => { transportArgs.last.onBlock(1, { sectionId: 'sec-2' }); });
    expect(screen.queryByText('next →')).toBeNull();
    expect(screen.getByRole('button', { name: 'B slot 2' }).className).toContain('is-active');
  });

  it('an open capture session forces STACK arming (the card records against the jam, never the arrangement)', async () => {
    render(<Producer />);
    await jamAndPromote();
    expect(transportArgs.last.arrangement).not.toBeNull(); // Song tab, armed for song
    fireEvent.click(screen.getByLabelText('record'));
    expect(transportArgs.last.arrangement).toBeNull(); // capture → jam stack
    fireEvent.click(screen.getByLabelText('record')); // close restores
    expect(transportArgs.last.arrangement).not.toBeNull();
  });

  it('capture over a PLAYING song hands channel config back to the workspace writer (and back on close)', async () => {
    render(<Producer />);
    await jamAndPromote(); // section sec-1: program 0 on channel 0
    // Drift the WORKSPACE voice so workspace vs section programs differ.
    fireEvent.click(screen.getByRole('tab', { name: 'Mix' }));
    fireEvent.click(screen.getByRole('button', { name: 'voice' }));
    fireEvent.click(await screen.findByRole('option', { name: 'E-Piano' }));
    await waitFor(() => expect(routerMock.configureLayer).toHaveBeenCalledWith(0, { program: 4, gain: 1 }));
    // Play the song; block 0 puts the SECTION's program (0) in charge.
    fireEvent.click(screen.getByRole('tab', { name: 'Song' }));
    fireEvent.click(screen.getByRole('button', { name: /play/i }));
    setPlaying(true);
    act(() => { transportArgs.last.onBlock(0, { sectionId: 'sec-1' }); });
    await waitFor(() => expect(routerMock.configureLayer).toHaveBeenCalledWith(0, { program: 0, gain: 1 }));
    // Open the capture card mid-play: the transport flips to stack content,
    // and the WORKSPACE writer must re-push the jam's programs in lockstep.
    routerMock.configureLayer.mockClear();
    fireEvent.click(screen.getByLabelText('record'));
    await waitFor(() => expect(routerMock.configureLayer).toHaveBeenCalledWith(0, { program: 4, gain: 1 }));
    // Close: the song writer takes the channel back (section program 0).
    routerMock.configureLayer.mockClear();
    fireEvent.click(screen.getByLabelText('record'));
    await waitFor(() => expect(routerMock.configureLayer).toHaveBeenCalledWith(0, { program: 0, gain: 1 }));
  });

  it('a section layer removed from the workspace MID-FETCH still lands its notes (draft-aware landing guard)', async () => {
    // Gate the Dm loop's MIDI fetch so the test controls when notes land.
    let releaseDm;
    const dmGate = new Promise((res) => { releaseDm = res; });
    const baseFetch = global.fetch;
    global.fetch = vi.fn((url) => {
      if (String(url).includes('dm-c-f-gm')) {
        return dmGate.then(() => ({ text: () => Promise.resolve(musicXml([[62, 0, 2], [65, 2, 2]])) }));
      }
      return baseFetch(url);
    });
    render(<Producer />);
    await addDmLayer(); // optimistic strip; notes still gated
    expect(transportArgs.last.layers).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Add to song' }));
    await screen.findByRole('button', { name: 'A slot 1' });
    // Open the section — ensureLayerNotes starts a (gated) fetch…
    fireEvent.click(screen.getByRole('button', { name: 'A slot 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit in Mix' }));
    // …then remove the layer from the WORKSPACE before the fetch resolves.
    fireEvent.click(screen.getByLabelText('remove layer'));
    fireEvent.click(screen.getByLabelText('remove layer'));
    await waitFor(() => expect(document.querySelectorAll('.piano-channel-strip').length).toBe(0));
    // The landing must still be accepted: the DRAFT references the layer.
    await act(async () => { releaseDm(); });
    fireEvent.click(screen.getByRole('tab', { name: 'Song' }));
    await waitFor(() => {
      const arr = transportArgs.last.arrangement;
      expect(arr).not.toBeNull();
      expect(arr.sections[0].stack).toHaveLength(1);
      expect(arr.sections[0].stack[0].notes.length).toBeGreaterThan(0);
    });
  });

  it('removing a PROMOTED layer from the workspace keeps its notes for the song (no silent sections)', async () => {
    render(<Producer />);
    await jamAndPromote();
    // Clean the jam out from under the song…
    fireEvent.click(screen.getByRole('tab', { name: 'Mix' }));
    fireEvent.click(screen.getByLabelText('remove layer'));
    fireEvent.click(screen.getByLabelText('remove layer'));
    await waitFor(() => expect(document.querySelectorAll('.piano-channel-strip').length).toBe(0));
    // …the arrangement input still carries the section's notes.
    fireEvent.click(screen.getByRole('tab', { name: 'Song' }));
    const arr = transportArgs.last.arrangement;
    expect(arr).not.toBeNull();
    expect(arr.sections[0].stack).toHaveLength(1);
    expect(arr.sections[0].stack[0].notes.length).toBeGreaterThan(0);
  });

  it('template apply from the shell: Pop renders six fillable slots and "Use current jam" fills one', async () => {
    render(<Producer />);
    await addDmLayer();
    await waitFor(() => expect(transportArgs.last.layers.length).toBe(1));
    fireEvent.click(screen.getByRole('tab', { name: 'Song' }));
    fireEvent.click(screen.getByRole('button', { name: /pop/i }));
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    expect(document.querySelectorAll('.piano-song-view__slot--empty')).toHaveLength(6);
    // Fill the Verse from the jam → the slot stops being empty.
    fireEvent.click(screen.getByRole('button', { name: 'Verse slot 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use current jam' }));
    await waitFor(() => (
      expect(document.querySelectorAll('.piano-song-view__slot--empty')).toHaveLength(4) // both Verse slots filled
    ));
    expect(screen.getByRole('button', { name: 'Verse slot 2' }).textContent).toContain('×2 · 8 bars');
  });
});

describe('Producer persistence wiring (Task 8.2)', () => {
  it("'Songs & Resume' front door opens the saved-song picker", async () => {
    render(<Producer />);
    fireEvent.click(await screen.findByRole('button', { name: /songs & resume/i }));
    expect(await screen.findByRole('dialog', { name: 'saved songs' })).toBeInTheDocument();
  });

  it("'Keep stack to Crate' saves the workspace stack", async () => {
    render(<Producer />);
    await addDmLayer();
    fireEvent.click(screen.getByRole('button', { name: /keep stack to crate/i }));
    await waitFor(() => expect(storeMock.saveCrateItem).toHaveBeenCalledWith('stack', expect.objectContaining({
      layers: expect.arrayContaining([expect.objectContaining({ role: 'chords' })]),
    })));
  });

  it('Save song (Song tab) crystallizes the draft via the store', async () => {
    render(<Producer />);
    await addDmLayer();
    // Promote the jam so a draft exists, landing on the Song tab.
    fireEvent.click(screen.getByRole('button', { name: 'Add to song' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save song' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save song' }));
    await waitFor(() => expect(storeMock.saveSong).toHaveBeenCalled());
  });

  it('the resume chip applies the snapshot when one is available', async () => {
    resumeMock.hasResume = true;
    resumeMock.applyResume = vi.fn(() => ({ workspace: { layers: [], bpm: 100, keyShift: 0 }, draft: null }));
    render(<Producer />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    expect(resumeMock.applyResume).toHaveBeenCalled();
    resumeMock.hasResume = false; // restore for other tests
  });

  it("'Ours' kept stack loads immediately when the workspace is empty", async () => {
    storeMock.crate = [{ id: 'c1', kind: 'stack', title: 'Kept', layerCount: 1 }];
    render(<Producer />);
    await openLibrary();
    fireEvent.click(screen.getByRole('button', { name: 'Ours' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Kept' }));
    // No confirm — empty jam, nothing to lose.
    expect(screen.queryByRole('alertdialog', { name: 'replace jam' })).toBeNull();
    await waitFor(() => expect(storeMock.loadCrateStack).toHaveBeenCalledWith('c1'));
    storeMock.crate = [];
  });

  it("'Ours' kept stack arms a replace confirm over a non-empty jam, then loads on confirm", async () => {
    storeMock.crate = [{ id: 'c1', kind: 'stack', title: 'Kept', layerCount: 1 }];
    render(<Producer />);
    await addDmLayer(); // a jam worth protecting
    fireEvent.click(screen.getByRole('button', { name: '+ Add layer' }));
    await screen.findByRole('dialog', { name: 'loop library' });
    fireEvent.click(screen.getByRole('button', { name: 'Ours' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Kept' }));
    // Armed: the confirm shows and nothing has loaded yet.
    expect(await screen.findByRole('alertdialog', { name: 'replace jam' })).toBeInTheDocument();
    expect(storeMock.loadCrateStack).not.toHaveBeenCalled();
    // Confirm → the load runs.
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(storeMock.loadCrateStack).toHaveBeenCalledWith('c1'));
    storeMock.crate = [];
  });
});
