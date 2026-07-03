import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Shared holders (hoisted so the vi.mock factories can see them).
const h = vi.hoisted(() => ({
  noteCb: null, // the Follow-mode note-event subscriber
  rawCb: null,  // the Manual-mode raw-MIDI subscriber
  events: [
    { midi: 64, midis: [64, 52, 40], onsetQuarter: 0, x: 100, top: 10, bottom: 200, system: 0 }, // E4 + LH E3/E2
    { midi: 62, midis: [62], onsetQuarter: 1, x: 160, top: 10, bottom: 200, system: 0 }, // D4
    { midi: 60, midis: [60], onsetQuarter: 2, x: 220, top: 10, bottom: 200, system: 0 }, // C4
    { midi: 62, midis: [62], onsetQuarter: 3, x: 280, top: 10, bottom: 200, system: 0 }, // D4
  ],
  layoutExtras: {},
  pressNote: vi.fn(),
  releaseNote: vi.fn(),
  sendPanic: vi.fn(),
}));

// Derive per-onset full-staff steps from the melody events: the first pitch of
// each onset is the top staff (0), the rest are accompaniment (staff 1). Mirrors
// osmdRender.buildSteps so the full-hand Follow tracker + light-up have geometry.
const deriveSteps = (events) => events.map((e) => ({
  onsetQuarter: e.onsetQuarter,
  notes: (e.midis || [e.midi]).map((midi, i) => ({ midi, staff: i === 0 ? 0 : 1, x: e.x, top: e.top, bottom: e.bottom, width: 8 })),
}));
// Flatten the per-onset steps into playback note records (all staves) — mirrors
// osmdRender emitting `notes` alongside `steps` from one walk, so parts/activeParts
// exist for the Follow tracker + part chips.
const deriveNotes = (steps) => steps.flatMap((s) => s.notes.map((n) => ({ midi: n.midi, staff: n.staff, onsetQuarter: s.onsetQuarter, durationQuarters: 1 })));

vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({
    activeNotes: new Map(),
    subscribe: (fn) => { h.noteCb = fn; return () => { h.noteCb = null; }; },
    subscribeRaw: (fn) => { h.rawCb = fn; return () => { h.rawCb = null; }; },
    pressNote: h.pressNote,
    releaseNote: h.releaseNote,
    sendPanic: h.sendPanic,
  }),
}));
vi.mock('../../PianoPlaybackContext.jsx', () => ({ usePianoPlayback: () => ({ setPlaying: () => {} }) }));
vi.mock('../../PianoConfig.jsx', () => ({ usePianoKioskConfig: () => ({ config: { keyboard: { startNote: 21, endNote: 108 } } }) }));
vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumb: () => {} }));
vi.mock('../../useReloadGuard.js', () => ({ default: () => {} }));

// Stub the engraver: report a known layout (melody events + derived per-onset
// steps), render the cursor / light-up children.
vi.mock('../../../../MusicNotation/renderers/MusicXmlRenderer.jsx', async () => {
  const { useEffect } = await import('react');
  return {
    MusicXmlRenderer: ({ onLayout, onReady, children, scale }) => {
      // Re-fire onLayout when scale changes (mirrors a real re-engrave), always
      // with FRESH array references so tests exercise the new-identity path.
      useEffect(() => {
        const extra = h.layoutExtras || {};
        const events = extra.events || h.events;
        const steps = extra.steps || deriveSteps(events);
        const notes = (extra.notes || deriveNotes(steps)).map((n) => ({ ...n }));
        onLayout?.({
          width: 800, height: 400, tempoEntries: [], flow: 'wrapped',
          ...extra,
          events,
          steps,
          notes,
        });
        onReady?.();
      }, [onLayout, onReady, scale]);
      return <div data-testid="renderer" className="musicxml-renderer">{children}</div>;
    },
  };
});

import ScorePlayer from './ScorePlayer.jsx';

const play = (note) => act(() => { h.noteCb?.({ type: 'note_on', note, velocity: 80 }); });
const renderPlayer = () =>
  render(<MemoryRouter><ScorePlayer score={{ title: 'Mary', musicXml: '<score/>' }} /></MemoryRouter>);

beforeEach(() => {
  h.noteCb = null; h.rawCb = null; h.layoutExtras = {};
  h.pressNote.mockClear(); h.releaseNote.mockClear(); h.sendPanic.mockClear();
});

describe('ScorePlayer — Learn mode (full-hand, simulated MIDI input)', () => {

  it('advances only when every active-staff note of the step is struck', () => {
    renderPlayer();

    // Layout reported 4 onsets; cursor starts at the first.
    expect(screen.getByText('1 / 4')).toBeTruthy();
    expect(h.noteCb).toBeTypeOf('function'); // Follow mode subscribed

    play(64);                                  // melody of the opening chord — not enough alone
    expect(screen.getByText('1 / 4')).toBeTruthy();
    play(52); play(40);                        // the LH E3/E2 → all-notes rule satisfied
    expect(screen.getByText('2 / 4')).toBeTruthy();

    play(60);                                  // WRONG (expects D4) → no advance
    expect(screen.getByText('2 / 4')).toBeTruthy();

    play(62);                                  // correct (D4, single-note step)
    expect(screen.getByText('3 / 4')).toBeTruthy();

    play(60);                                  // correct (C4)
    expect(screen.getByText('4 / 4')).toBeTruthy();

    play(62);                                  // correct (D4) — already at last, clamps
    expect(screen.getByText('4 / 4')).toBeTruthy();
  });

  it('does not advance past the end on extra notes', () => {
    renderPlayer();
    for (const n of [64, 52, 40, 62, 60, 62, 64, 64, 64]) play(n);
    expect(screen.getByText('4 / 4')).toBeTruthy();
  });
});

describe('ScorePlayer — Learn mode chord tolerance (audit B2)', () => {
  it('does not flash wrong for accompaniment notes that belong to the current onset', () => {
    renderPlayer();
    play(52); // LH note of the current onset — a correct hit, no advance, NO flash
    expect(document.querySelector('.piano-score-cursor.is-wrong')).toBeNull();
    expect(screen.getByText('1 / 4')).toBeTruthy();
    play(63); // a real wrong note near the melody → flash
    expect(document.querySelector('.piano-score-cursor.is-wrong')).not.toBeNull();
  });
});

describe('ScorePlayer — Perform mode pedal page-turn', () => {
  it('turns one page per pedal press (rising edge), not per CC message', async () => {
    const scrollBy = vi.fn();
    Element.prototype.scrollBy = scrollBy;
    renderPlayer();
    screen.getByText('Perform').click();
    await act(async () => {});
    const cc66 = (v) => act(() => { h.rawCb?.({ data: [0xb0, 66, v] }); });

    cc66(127); // press
    cc66(127); // continuous pedal streams repeats while held
    cc66(96);  // still held
    cc66(0);   // release
    cc66(127); // second press
    expect(scrollBy).toHaveBeenCalledTimes(2);
  });
});

describe('ScorePlayer — Polish mode (transport-driven)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
    vi.setSystemTime(0);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  // h.events onsets are 0,1,2,3 quarters; report a tempo map with a mid-piece
  // change so the timeline is: q0@60=1000ms/q, then q2@120=500ms/q.
  it('advances the cursor on the tempo map, including a mid-piece change', async () => {
    h.layoutExtras = { tempoEntries: [{ onsetQuarter: 0, bpm: 60 }, { onsetQuarter: 2, bpm: 120 }] };
    renderPlayer();
    screen.getByText('Polish').click();
    await act(async () => {});
    screen.getByText('▶').click();
    await act(async () => {});

    act(() => vi.advanceTimersByTime(1050)); // 1st quarter @60 = 1000ms
    expect(screen.getByText('2 / 4')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1050)); // 2nd quarter @60
    expect(screen.getByText('3 / 4')).toBeTruthy();
    act(() => vi.advanceTimersByTime(550)); // 3rd quarter @120 = 500ms
    expect(screen.getByText('4 / 4')).toBeTruthy();
  });
});

describe('ScorePlayer — Listen mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
    vi.setSystemTime(0);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('sounds only parts set to play, and stops silence via panic', async () => {
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
      notes: [
        { midi: 64, staff: 0, onsetQuarter: 0, durationQuarters: 1 },
        { midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 4 },
      ],
    };
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    screen.getByText('RH: Play').click(); // cycle RH play → you
    await act(async () => {});
    screen.getByText('▶').click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(100));
    expect(h.pressNote).toHaveBeenCalledWith(40, expect.any(Number)); // LH sounds
    expect(h.pressNote).not.toHaveBeenCalledWith(64, expect.any(Number)); // RH is yours
    screen.getByText('❚❚').click(); // pause mid-note
    await act(async () => {});
    expect(h.sendPanic).toHaveBeenCalled(); // no droning chord
  });

  it('keeps part roles across a re-engrave (zoom must not wipe You/Mute)', async () => {
    h.layoutExtras = { notes: [
      { midi: 64, staff: 0, onsetQuarter: 0, durationQuarters: 1 },
      { midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 4 },
    ] };
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    screen.getByText('RH: Play').click(); // RH → You
    await act(async () => {});
    expect(screen.getByText('RH: You')).toBeTruthy();
    // Zoom via the Size slider → re-engrave (fresh layout.notes identity).
    fireEvent.click(screen.getByRole('button', { name: /size/i }));
    const slider = screen.getByRole('slider', { name: /size/i });
    fireEvent.change(slider, { target: { value: '1.3' } });
    fireEvent.mouseUp(slider);
    await act(async () => {});
    expect(screen.getByText('RH: You')).toBeTruthy(); // role preserved, not reset to Play
  });

  it('silences sounding notes on tap-seek in Play mode (no stuck note)', async () => {
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
      notes: [{ midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 8 }], // long note, still sounding
    };
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    screen.getByText('▶').click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(100)); // note 40 now sounding
    h.sendPanic.mockClear();
    act(() => { document.querySelector('.piano-score-player__scroll').click(); }); // tap to seek
    expect(h.sendPanic).toHaveBeenCalled(); // flushed, won't drone
  });
});
