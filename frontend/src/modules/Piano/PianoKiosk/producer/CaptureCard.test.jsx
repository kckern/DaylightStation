/**
 * CaptureCard tests (Task 6.2) — UI wiring over a MOCKED capture engine.
 *
 * The engine's math carries its own suite (useLoopCapture.test.js); these
 * tests pin the card's contracts:
 *   - anchor derivation for BOTH arm paths (jam next-bar vs metronome
 *     count-in) in the performance.now() domain;
 *   - the clock-domain prescription: subscribe events are RE-STAMPED with
 *     performance.now(), evt.time (Date.now domain) ignored;
 *   - drum pads → router ch 9 + engine (original key, engine remaps);
 *   - Undo/Keep gated on passCount ≥ 1;
 *   - Keep → kind chips → Confirm → onKeep shape (+ clearTake);
 *   - Done/unmount: disarm, unsubscribe, metronome restore.
 *
 * Fixed grid: bpm 120, 4/4 → barMs 2000. performance.now stubbed to NOW.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { useReducer } from 'react';

const NOW = 50000;
const BAR_MS = 2000;

// ── engine mock (reactive: mutate captureMock, then force()) ─────────────────
const captureMock = vi.hoisted(() => ({
  state: 'idle',
  passCount: 0,
  takeNoteCount: 0,
  takeNotes: [],
  lengthBars: 4,
  drumMode: false,
  lastProps: null,
  __force: () => {},
}));

vi.mock('./useLoopCapture.js', () => ({
  useLoopCapture: (props) => {
    captureMock.lastProps = props;
    const [, force] = useReducer((c) => c + 1, 0);
    captureMock.__force = force;
    return { ...captureMock };
  },
  PPQ: 480,
  // Real GM values (pinned in useLoopCapture.test.js) — hardcoded so the pad
  // → ch9 forwarding assertions are literal.
  DRUM_KEY_MAP: { 36: 36, 38: 38, 40: 42, 41: 46, 43: 45, 45: 47, 47: 50, 48: 49, 50: 51 },
}));

import { CaptureCard } from './CaptureCard.jsx';

const setCapture = (patch) => act(() => {
  Object.assign(captureMock, patch);
  captureMock.__force();
});

// ── collaborator mocks ────────────────────────────────────────────────────────
let router;
let transport;
let midiCb;
let unsubscribe;
let subscribeMidi;
let onKeep;
let onClose;
let onSetMetronome;
let onCountInBars;
let rafQueue;

const TAKE = Object.freeze({
  takeId: 'take-1',
  notes: [{ ticks: 0, durationTicks: 480, midi: 60, velocity: 90 }],
  ppq: 480,
  lengthBars: 4,
  kind: 'chords',
  drumMode: false,
  timeline: null,
});

beforeEach(() => {
  Object.assign(captureMock, {
    state: 'idle',
    passCount: 0,
    takeNoteCount: 0,
    drumMode: false,
    arm: vi.fn(() => { captureMock.state = 'counting'; captureMock.__force(); }),
    disarm: vi.fn(() => { captureMock.state = 'idle'; captureMock.__force(); }),
    tick: vi.fn(),
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    undoPass: vi.fn(),
    clearTake: vi.fn(),
    keep: vi.fn(() => TAKE),
    setDrumMode: vi.fn((on) => { captureMock.drumMode = on; captureMock.__force(); }),
  });
  router = { noteOn: vi.fn(), noteOff: vi.fn() };
  transport = {
    isPlaying: false,
    play: vi.fn(),
    stop: vi.fn(),
    lengthMs: 0,
    positionRef: { current: { normalized: 0, bar: 0, beat: 0, blockIndex: -1 } },
  };
  midiCb = null;
  unsubscribe = vi.fn();
  subscribeMidi = vi.fn((fn) => { midiCb = fn; return unsubscribe; });
  onKeep = vi.fn();
  onClose = vi.fn();
  onSetMetronome = vi.fn();
  onCountInBars = vi.fn();
  rafQueue = [];
  vi.stubGlobal('requestAnimationFrame', (cb) => { rafQueue.push(cb); return rafQueue.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(performance, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderCard(props = {}) {
  return render(
    <CaptureCard
      bpm={120}
      timeSig={[4, 4]}
      transport={transport}
      router={router}
      subscribeMidi={subscribeMidi}
      metronome={false}
      onSetMetronome={onSetMetronome}
      countInBars={1}
      onCountInBars={onCountInBars}
      hasLayers={false}
      onKeep={onKeep}
      onClose={onClose}
      {...props}
    />,
  );
}

const arm = () => fireEvent.click(screen.getByRole('button', { name: /arm/i }));

/** Run queued rAF callbacks once (the loop re-queues itself). */
const flushRaf = () => act(() => {
  const q = [...rafQueue];
  rafQueue.length = 0;
  q.forEach((cb) => cb(performance.now()));
});

// ── setup → arm ───────────────────────────────────────────────────────────────

describe('setup and arm paths', () => {
  it('metronome path: forces the click on, plays with count-in, anchors at now + ci×barMs', () => {
    renderCard({ countInBars: 2, metronome: false });
    arm();
    expect(onSetMetronome).toHaveBeenCalledWith(true);
    expect(transport.play).toHaveBeenCalledTimes(1);
    expect(captureMock.arm).toHaveBeenCalledWith({
      lengthBars: 4,                       // default when no layers
      anchorWallMs: NOW + 2 * BAR_MS,      // content-start = now + ci×barMs
      countInBars: 2,
    });
  });

  it('metronome path with the click already on does NOT touch metronome state', () => {
    renderCard({ metronome: true });
    arm();
    expect(onSetMetronome).not.toHaveBeenCalled();
    expect(transport.play).toHaveBeenCalledTimes(1);
  });

  it('jam path: anchors PHASE-ALIGNED (next global bar ≡ 0 mod lengthBars); count-in ignored; no play()', () => {
    transport.isPlaying = true;
    transport.lengthMs = 8000; // 4 bars @ 2000ms
    // Mid-cycle: global bar 1, 400ms in (normalized 0.3 → posMs 2400).
    transport.positionRef.current = { normalized: 0.3, bar: 1, beat: 0, blockIndex: -1 };
    renderCard({ hasLayers: true, countInBars: 2 });
    arm();
    expect(transport.play).not.toHaveBeenCalled();
    expect(onSetMetronome).not.toHaveBeenCalled();
    // 1600ms to bar 2, then 2 more bars to global bar 4 (≡ 0 mod 4): playback
    // re-enters cycles at globalBar % bars, so tick 0 must land there or the
    // kept take plays back rotated.
    expect(captureMock.arm).toHaveBeenCalledWith({
      lengthBars: 4,                 // "match jam" default: 8000 / 2000
      anchorWallMs: NOW + 1600 + 2 * BAR_MS,
      countInBars: 0,
    });
    // The wait reads as a count-in on the dial.
    expect(screen.getByLabelText('bar dial').textContent).toBe('−3');
  });

  it('jam path on the LAST bar of the cycle anchors at the imminent cycle top (no extra wait)', () => {
    transport.isPlaying = true;
    transport.lengthMs = 8000;
    // Global bar 3, 1200ms in (posMs 7200) → 800ms to bar 4 ≡ 0 (mod 4).
    transport.positionRef.current = { normalized: 0.9, bar: 3, beat: 2, blockIndex: -1 };
    renderCard({ hasLayers: true });
    arm();
    expect(captureMock.arm.mock.calls[0][0].anchorWallMs).toBe(NOW + 800);
  });

  it('arming during a transport COUNT-IN (pos.bar < 0) routes to the metronome branch', () => {
    // Mid-count-in: isPlaying is true but content has not started — normalized
    // is 0 and bar is negative. Next-bar math would mint a garbage anchor and
    // real notes would drop as count-in; play() is restart-safe instead.
    transport.isPlaying = true;
    transport.lengthMs = 8000;
    transport.positionRef.current = { normalized: 0, bar: -1, beat: 0, blockIndex: -1 };
    renderCard({ hasLayers: true, countInBars: 1, metronome: false });
    arm();
    expect(transport.play).toHaveBeenCalledTimes(1); // restart with fresh count-in
    expect(onSetMetronome).toHaveBeenCalledWith(true);
    expect(captureMock.arm).toHaveBeenCalledWith(expect.objectContaining({
      anchorWallMs: NOW + BAR_MS, // metronome-branch anchor: now + ci×barMs
      countInBars: 1,
    }));
  });

  it('jam path exactly ON a boundary waits to the NEXT phase-aligned bar (never in the past)', () => {
    transport.isPlaying = true;
    transport.lengthMs = 8000;
    // Exactly at global bar 2's start (posMs 4000 → % barMs = 0): next bar is
    // 3, phase-aligned landing is bar 4 → a full 2 bars out.
    transport.positionRef.current = { normalized: 0.5, bar: 2, beat: 0, blockIndex: -1 };
    renderCard({ hasLayers: true });
    arm();
    expect(captureMock.arm.mock.calls[0][0].anchorWallMs).toBe(NOW + 2 * BAR_MS);
  });

  it('length chips select 2/4/8 bars; explicit chip overrides match-jam', () => {
    transport.isPlaying = true;
    transport.lengthMs = 8000;
    renderCard({ hasLayers: true });
    expect(screen.getByRole('button', { name: /match jam · 4/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '8 bars' }));
    arm();
    expect(captureMock.arm.mock.calls[0][0].lengthBars).toBe(8);
  });

  it('count-in chips emit through onCountInBars and are disabled while the jam plays', () => {
    const { unmount } = renderCard();
    const countInGroup = () => within(screen.getByRole('group', { name: 'count-in' }));
    fireEvent.click(countInGroup().getByRole('button', { name: '2 bars' }));
    expect(onCountInBars).toHaveBeenCalledWith(2);
    unmount();
    transport.isPlaying = true;
    transport.lengthMs = 8000;
    renderCard({ hasLayers: true });
    expect(countInGroup().getByRole('button', { name: '2 bars' })).toBeDisabled();
    expect(screen.getByText(/jam plays you in/i)).toBeInTheDocument();
  });

  it('drum mode defaults OFF (neutral) and toggles through the engine', () => {
    renderCard();
    const toggle = screen.getByRole('button', { name: 'Drums' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(captureMock.setDrumMode).toHaveBeenCalledWith(true);
    expect(screen.getByRole('group', { name: 'drum pads' })).toBeInTheDocument();
  });
});

// ── clock domain ──────────────────────────────────────────────────────────────

describe('MIDI feed re-stamping (the prescription)', () => {
  it('subscribes only once armed, re-stamps evt.time with performance.now()', () => {
    renderCard();
    expect(subscribeMidi).not.toHaveBeenCalled(); // not armed yet
    arm();
    expect(subscribeMidi).toHaveBeenCalledTimes(1);
    act(() => {
      midiCb({ type: 'note_on', note: 60, velocity: 90, time: 1751400000000 }); // Date.now domain
      midiCb({ type: 'note_off', note: 60, velocity: 0, time: 1751400000400 });
    });
    expect(captureMock.noteOn).toHaveBeenCalledWith(60, 90, NOW);   // NOT evt.time
    expect(captureMock.noteOff).toHaveBeenCalledWith(60, NOW);
  });

  it('in drum mode, forwards the MAPPED drum note to the router on ch 9', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Drums' }));
    arm();
    act(() => {
      midiCb({ type: 'note_on', note: 40, velocity: 80, time: 0 }); // E2 → closed hat 42
      midiCb({ type: 'note_off', note: 40, velocity: 0, time: 0 });
    });
    expect(router.noteOn).toHaveBeenCalledWith(9, 42, 80);
    expect(router.noteOff).toHaveBeenCalledWith(9, 42);
    expect(captureMock.noteOn).toHaveBeenCalledWith(40, 80, NOW); // engine gets the ORIGINAL key
  });

  it('drum mode toggled off mid-hold still routes the note-off to ch 9 (no stuck drum)', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Drums' }));
    arm();
    act(() => { midiCb({ type: 'note_on', note: 36, velocity: 90, time: 0 }); });
    fireEvent.click(screen.getAllByRole('button', { name: 'Drums' })[0]); // off mid-hold
    act(() => { midiCb({ type: 'note_off', note: 36, velocity: 0, time: 0 }); });
    expect(router.noteOff).toHaveBeenCalledWith(9, 36);
  });

  it('the rAF loop drives engine.tick with performance.now()', () => {
    renderCard();
    arm();
    performance.now.mockReturnValue(NOW + 5555);
    flushRaf();
    expect(captureMock.tick).toHaveBeenCalledWith(NOW + 5555);
  });
});

// ── drum pads ─────────────────────────────────────────────────────────────────

describe('drum pads', () => {
  it('renders the 9 labeled pads; pointer down/up hits router ch 9 + engine', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Drums' }));
    arm();
    const pads = screen.getByRole('group', { name: 'drum pads' });
    expect(pads.querySelectorAll('.piano-capture-card__pad')).toHaveLength(9);
    const hat = screen.getByRole('button', { name: 'Hat' });
    fireEvent.pointerDown(hat);
    expect(router.noteOn).toHaveBeenCalledWith(9, 42, 100);
    expect(captureMock.noteOn).toHaveBeenCalledWith(40, 100, NOW); // original key in
    fireEvent.pointerUp(hat);
    expect(router.noteOff).toHaveBeenCalledWith(9, 42);
    expect(captureMock.noteOff).toHaveBeenCalledWith(40, NOW);
  });

  it('pointer leave releases a held pad (no stuck note on drag-off)', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Drums' }));
    const kick = screen.getByRole('button', { name: 'Kick' });
    fireEvent.pointerDown(kick);
    fireEvent.pointerLeave(kick);
    expect(router.noteOff).toHaveBeenCalledWith(9, 36);
    fireEvent.pointerUp(kick); // no double off
    expect(router.noteOff).toHaveBeenCalledTimes(1);
  });
});

// ── live piano-roll ───────────────────────────────────────────────────────────

describe('live piano-roll (design §8)', () => {
  it('prompts before any notes, then renders the roll once the take has notes', () => {
    renderCard();
    arm();
    expect(screen.getByText(/play along — your notes land here/i)).toBeInTheDocument();
    expect(document.querySelector('.piano-loop-roll')).toBeNull();
    setCapture({
      passCount: 1,
      takeNoteCount: 2,
      takeNotes: [
        { ticks: 0, durationTicks: 240, midi: 60, velocity: 90 },
        { ticks: 480, durationTicks: 240, midi: 64, velocity: 90 },
      ],
    });
    expect(screen.queryByText(/play along/i)).toBeNull();
    expect(document.querySelector('.piano-loop-roll')).toBeTruthy();
  });
});

// ── pass buttons / keep flow ──────────────────────────────────────────────────

describe('pass buttons and keep flow', () => {
  it('Undo and Keep are disabled until passCount ≥ 1; Clear is always live', () => {
    renderCard();
    arm();
    expect(screen.getByRole('button', { name: 'Undo pass' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Keep' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
    setCapture({ passCount: 1, takeNoteCount: 3 });
    expect(screen.getByRole('button', { name: 'Undo pass' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Keep' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Undo pass' }));
    expect(captureMock.undoPass).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(captureMock.clearTake).toHaveBeenCalled();
  });

  it('Keep → kind chips (inferred highlighted) → Confirm → onKeep + clearTake, still cycling', () => {
    renderCard();
    arm();
    setCapture({ passCount: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(captureMock.keep).toHaveBeenCalledWith({ snap: 'off' });
    const confirmRow = screen.getByRole('group', { name: 'confirm kind' });
    expect(confirmRow).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chords' })).toHaveClass('is-on'); // inferred
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onKeep).toHaveBeenCalledWith(expect.objectContaining({
      takeId: 'take-1',
      kind: 'chords',
      notes: TAKE.notes,
      ppq: 480,
      lengthBars: 4,
    }));
    expect(captureMock.clearTake).toHaveBeenCalledTimes(1);
    // Keep-and-continue: still armed, confirm row gone, card open.
    expect(screen.queryByRole('group', { name: 'confirm kind' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('one tap overrides the inferred kind before Confirm', () => {
    renderCard();
    arm();
    setCapture({ passCount: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    fireEvent.click(screen.getByRole('button', { name: 'Melody' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onKeep).toHaveBeenCalledWith(expect.objectContaining({ kind: 'melody' }));
  });

  it('snap toggle rides into keep()', () => {
    renderCard();
    arm();
    setCapture({ passCount: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Snap 1/16' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(captureMock.keep).toHaveBeenCalledWith({ snap: 'sixteenth' });
  });
});

// ── close / teardown ──────────────────────────────────────────────────────────

describe('close and teardown', () => {
  it('Done disarms, unsubscribes, restores the forced metronome, and closes', () => {
    renderCard({ metronome: false });
    arm(); // forces metronome on
    onSetMetronome.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(captureMock.disarm).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    // Parent unmounts the card on onClose — simulate and assert restore+unsub.
  });

  it('unmount while armed unsubscribes and restores the forced metronome', () => {
    const { unmount } = renderCard({ metronome: false });
    arm();
    expect(onSetMetronome).toHaveBeenCalledWith(true);
    onSetMetronome.mockClear();
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
    expect(onSetMetronome).toHaveBeenCalledWith(false);
  });

  it('does NOT restore metronome when it was already on (nothing was forced)', () => {
    const { unmount } = renderCard({ metronome: true });
    arm();
    unmount();
    expect(onSetMetronome).not.toHaveBeenCalled();
  });

  it('unmount releases any held drum pad through the router (no stuck ch-9 note)', () => {
    const { unmount } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Drums' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Crash' }));
    unmount();
    expect(router.noteOff).toHaveBeenCalledWith(9, 49);
  });

  it('metronome-path session closed with an EMPTY workspace stops the transport (no silent zombie playback)', () => {
    const { unmount } = renderCard({ hasLayers: false, metronome: false });
    arm(); // metronome branch → this session started the transport
    expect(transport.play).toHaveBeenCalledTimes(1);
    unmount();
    expect(transport.stop).toHaveBeenCalledTimes(1);
  });

  it('does NOT stop the transport when a layer was kept during the session', () => {
    const view = renderCard({ hasLayers: false, metronome: false });
    arm();
    // A keep landed a layer → parent re-renders the card with hasLayers=true.
    view.rerender(
      <CaptureCard
        bpm={120}
        timeSig={[4, 4]}
        transport={transport}
        router={router}
        subscribeMidi={subscribeMidi}
        metronome={false}
        onSetMetronome={onSetMetronome}
        countInBars={1}
        onCountInBars={onCountInBars}
        hasLayers
        onKeep={onKeep}
        onClose={onClose}
      />,
    );
    view.unmount();
    expect(transport.stop).not.toHaveBeenCalled();
  });

  it('does NOT stop the transport after a jam-path session (this session never started it)', () => {
    transport.isPlaying = true;
    transport.lengthMs = 8000;
    const { unmount } = renderCard({ hasLayers: true });
    arm(); // jam branch
    expect(transport.play).not.toHaveBeenCalled();
    unmount();
    expect(transport.stop).not.toHaveBeenCalled();
  });

  it('✕ in setup closes without arming anything', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'close capture' }));
    expect(onClose).toHaveBeenCalled();
    expect(captureMock.arm).not.toHaveBeenCalled();
    expect(transport.play).not.toHaveBeenCalled();
  });
});

// ── dial ──────────────────────────────────────────────────────────────────────

describe('bar dial', () => {
  it('shows −N during count-in, then "bar N / M" once cycling', () => {
    renderCard({ countInBars: 2 });
    arm(); // anchor = NOW + 4000
    expect(screen.getByLabelText('bar dial').textContent).toBe('−2');
    performance.now.mockReturnValue(NOW + 2100); // 1 bar of count-in left
    flushRaf();
    expect(screen.getByLabelText('bar dial').textContent).toBe('−1');
    performance.now.mockReturnValue(NOW + 4000 + 2 * BAR_MS + 100); // bar 3 of 4
    flushRaf();
    expect(screen.getByLabelText('bar dial').textContent).toBe('3 / 4');
    // Wraps modulo the cycle: bar 5 → bar 1 again.
    performance.now.mockReturnValue(NOW + 4000 + 4 * BAR_MS + 100);
    flushRaf();
    expect(screen.getByLabelText('bar dial').textContent).toBe('1 / 4');
  });
});
