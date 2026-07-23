import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { __resetRecorder, __snapshotForTest, KIND } from '../../../../../lib/logging/inputRecorder.js';

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
  sendNoteAt: vi.fn(),
  sendNoteOffAt: vi.fn(),
  sendPanic: vi.fn(),
  clickSched: { start: vi.fn(), stop: vi.fn(), setBpm: vi.fn() },
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
    subscribe: (fn) => { h.noteCb = fn; return () => { h.noteCb = null; }; },
    subscribeRaw: (fn) => { h.rawCb = fn; return () => { h.rawCb = null; }; },
    pressNote: h.pressNote,
    releaseNote: h.releaseNote,
    sendNoteAt: h.sendNoteAt,
    sendNoteOffAt: h.sendNoteOffAt,
    sendPanic: h.sendPanic,
  }),
  usePianoMidiNotes: () => ({ activeNotes: new Map(), noteHistory: [], sustainPedal: false, isPlaying: false }),
}));
vi.mock('../../PianoPlaybackContext.jsx', () => ({ usePianoPlayback: () => ({ setPlaying: () => {} }) }));
vi.mock('../../PianoConfig.jsx', () => ({ usePianoKioskConfig: () => ({ config: { keyboard: { startNote: 21, endNote: 108 } } }) }));
vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumb: () => {} }));
vi.mock('../../useReloadGuard.js', () => ({ default: () => {} }));
// Spyable click scheduler: useMetronomeClick creates one per enable, so hand it
// the shared holder object and assert on start/stop/setBpm.
vi.mock('./clickScheduler.js', () => ({ createClickScheduler: () => h.clickSched }));

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
  h.pressNote.mockClear(); h.releaseNote.mockClear();
  h.sendNoteAt.mockClear(); h.sendNoteOffAt.mockClear();
  // sendPanic gets a FRESH fn per test, not just mockClear: every ScorePlayer
  // unmount arms a delayed-panic setTimeout (~lookahead+60ms — intended production
  // behavior; see silenceScheduled). In this file's real-timer tests that timer
  // lives on the REAL clock and outlives its test, so under CPU load it can land
  // mid-way through a LATER fake-timer test and break
  // `expect(h.sendPanic).not.toHaveBeenCalled()`. The stale instance captured the
  // previous test's fn at render time, so re-binding scopes each test's
  // assertions to panics sent by ITS OWN component instance.
  h.sendPanic = vi.fn();
  // Same re-binding treatment for the click scheduler: the hook's cleanup calls
  // stop() on unmount, which for a stale shared instance would leak a stop()
  // from a PREVIOUS test's component into this test's assertions.
  h.clickSched = { start: vi.fn(), stop: vi.fn(), setBpm: vi.fn() };
});

// Scores now open in Listen (default). The Learn tests select Learn first.
const enterLearn = () => act(() => { screen.getByText('Learn').click(); });

describe('ScorePlayer — intent-event session-log routing (Task 10)', () => {
  it('emits intent events through the session-logged logger (app + sessionLog context)', () => {
    // Spy on the root logger's child() so we can see which child logger each
    // intent event is emitted through, and with what context. getLogger is the
    // REAL logger here (not mocked), so children are created for real.
    const root = getLogger();
    const origChild = root.child.bind(root);
    const children = []; // [{ ctx, events: [] }]
    const spy = vi.spyOn(root, 'child').mockImplementation((ctx) => {
      const c = origChild(ctx);
      const rec = { ctx, events: [] };
      children.push(rec);
      for (const lvl of ['info', 'warn', 'debug', 'error']) {
        const orig = c[lvl].bind(c);
        c[lvl] = (ev, data, opts) => { rec.events.push(ev); return orig(ev, data, opts); };
      }
      return c;
    });
    try {
      renderPlayer(); // opens in Listen
      // Claim a part → fires score.listen.mypart, an intent event.
      act(() => { fireEvent.click(screen.getByRole('radio', { name: 'RH' })); });
      const emitter = children.find((r) => r.events.includes('score.listen.mypart'));
      expect(emitter).toBeTruthy(); // some child emitted it
      // …and that child must carry session-log routing, so the event persists.
      expect(emitter.ctx).toMatchObject({ sessionLog: true, app: 'piano-sheetmusic' });
    } finally {
      spy.mockRestore();
      cleanup();
    }
  });
});

describe('ScorePlayer — raw MIDI recorder capture (Task 11)', () => {
  it('records raw MIDI from the wrapped subscribeRaw event ({data, time})', () => {
    renderPlayer(); // default (Listen) mode → only the recorder subscribes (Perform effect is inactive)
    __resetRecorder();
    // The REAL emitRaw wraps bytes: fn({ data: <byteArray>, time }). Feed the
    // recorder callback that exact shape.
    act(() => { h.rawCb?.({ data: [0x90, 72, 88], time: 0 }); });
    const hit = __snapshotForTest().records.some((r) => r.kind === KIND.MIDI_ON && r.a === 72 && r.b === 88);
    expect(hit).toBe(true);
    cleanup();
  });
});

describe('ScorePlayer — default mode', () => {
  it('opens in Listen (defaultMode), not Learn (J2)', () => {
    renderPlayer();
    expect(screen.getByRole('tab', { name: /listen/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /learn/i })).toHaveAttribute('aria-selected', 'false');
  });
});

describe('ScorePlayer — keyboard visibility policy (M2)', () => {
  it('Listen hides the keyboard until the user plays a part; Learn shows it', async () => {
    renderPlayer(); // opens in Listen, My part = None
    await act(async () => {});
    expect(document.querySelector('.piano-score-player__keys')).toBeNull(); // hidden (no part)
    act(() => { fireEvent.click(screen.getByRole('radio', { name: 'RH' })); }); // My part = RH
    expect(document.querySelector('.piano-score-player__keys')).not.toBeNull(); // now shown
    act(() => { screen.getByText('Learn').click(); }); // Learn auto-shows the keyboard
    expect(document.querySelector('.piano-score-player__keys')).not.toBeNull();
  });
});

describe('ScorePlayer — per-score persistence (Task 2.5)', () => {
  beforeEach(() => { try { window.localStorage.clear(); } catch { /* no storage */ } });
  const score = { id: 'files:persist.musicxml', title: 'P', musicXml: '<score/>' };
  const renderScore = () => render(<MemoryRouter><ScorePlayer score={score} /></MemoryRouter>);

  it('restores the last-used mode for a given score id', () => {
    const { unmount } = renderScore();
    act(() => { screen.getByText('Learn').click(); }); // change away from the default (Listen)
    unmount();
    renderScore();
    expect(screen.getByRole('tab', { name: /learn/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('restores the metronome arm state for a given score id (M3)', () => {
    const { unmount } = renderScore();
    act(() => { screen.getByText('Polish').click(); });
    const click = screen.getByRole('button', { name: /metronome/i });
    expect(click).toHaveAttribute('aria-pressed', 'true'); // default ON
    act(() => { fireEvent.click(click); }); // turn it off
    unmount();
    renderScore();
    act(() => { screen.getByText('Polish').click(); });
    expect(screen.getByRole('button', { name: /metronome/i })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('ScorePlayer — Learn mode (full-hand, simulated MIDI input)', () => {

  it('advances only when every active-staff note of the step is struck', () => {
    renderPlayer();
    enterLearn();

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
    enterLearn();
    for (const n of [64, 52, 40, 62, 60, 62, 64, 64, 64]) play(n);
    expect(screen.getByText('4 / 4')).toBeTruthy();
  });

  it('shows the Learn completion card once the final step is satisfied (M5)', () => {
    renderPlayer();
    enterLearn();
    expect(document.querySelector('.piano-score-learn-complete')).toBeNull();
    for (const n of [64, 52, 40, 62, 60, 62]) play(n); // satisfy all four onsets incl. the last
    expect(document.querySelector('.piano-score-learn-complete')).not.toBeNull();
  });
});

describe('ScorePlayer — practice range persistence (J3/L6)', () => {
  it('carries the focus range across Learn↔Polish↔Listen; only Perform releases it', () => {
    h.layoutExtras = {
      steps: [
        { onsetQuarter: 0, measure: 0, notes: [{ midi: 64, staff: 0, x: 100, top: 10, bottom: 200, width: 8 }] },
        { onsetQuarter: 1, measure: 1, notes: [{ midi: 62, staff: 0, x: 160, top: 10, bottom: 200, width: 8 }] },
      ],
      measures: [
        { index: 0, number: 1, firstStep: 0, lastStep: 0 },
        { index: 1, number: 2, firstStep: 1, lastStep: 1 },
      ],
    };
    renderPlayer();
    enterLearn();
    // Guided selection: Loop → Select measures… → two taps set a custom range.
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^loop/i })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /select measures/i })); });
    // Selection taps must land near a note (L3 threshold) — tap ON the first note.
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 100, clientY: 100 }); }); // first tap → measure 0
    act(() => { fireEvent.click(scroll, { clientX: 100, clientY: 100 }); }); // second tap → range set
    // The Loop trigger now shows a measure-span scope.
    expect(screen.getByRole('button', { name: /loop m1/i })).toBeInTheDocument();
    // Switch to Polish — range must persist.
    act(() => { screen.getByText('Polish').click(); });
    expect(screen.getByRole('button', { name: /loop m1/i })).toBeInTheDocument();
    // Switch to Listen — the loop now FOLLOWS (audit L6).
    act(() => { screen.getByText('Listen').click(); });
    expect(screen.getByRole('button', { name: /loop m1/i })).toBeInTheDocument();
    // Perform releases it.
    act(() => { screen.getByText('Perform').click(); });
    act(() => { screen.getByText('Listen').click(); });
    expect(screen.getByRole('button', { name: /^loop$/i })).toBeInTheDocument(); // back to inactive trigger
  });
});

describe('ScorePlayer — Learn mode chord tolerance (audit B2)', () => {
  it('does not flash wrong for accompaniment notes that belong to the current onset', () => {
    renderPlayer();
    enterLearn();
    play(52); // LH note of the current onset — a correct hit, no advance, NO flash
    expect(document.querySelector('.piano-score-cursor.is-wrong')).toBeNull();
    expect(screen.getByText('1 / 4')).toBeTruthy();
    play(63); // a real wrong note near the melody → flash
    expect(document.querySelector('.piano-score-cursor.is-wrong')).not.toBeNull();
  });
});

describe('ScorePlayer — stale-layout overlay guard (Task 9)', () => {
  it('hides the cursor while the reported layout scale is stale, shows it once it matches', async () => {
    // The renderer reports a layout whose scale (1.25) does NOT match the player's
    // current scale (1) — a pre-zoom (deferred-extraction) layout. Overlays must
    // stay hidden until onLayout catches up.
    h.layoutExtras = { scale: 1.25 };
    renderPlayer();
    await act(async () => {});
    expect(document.querySelector('.piano-score-cursor')).toBeNull(); // stale → hidden

    // Tap the Size stepper's 125% step → the mock re-fires onLayout with scale
    // 1.25, which now MATCHES the player's scale → layout is fresh → cursor appears.
    fireEvent.click(screen.getByRole('button', { name: /view options/i }));
    fireEvent.click(screen.getByRole('button', { name: '125%' }));
    await act(async () => {});
    expect(document.querySelector('.piano-score-cursor')).not.toBeNull(); // fresh → shown
  });

  it('shows the cursor on the initial layout (null scale/flow treated as fresh)', async () => {
    renderPlayer();
    await act(async () => {});
    // Default mock reports flow 'wrapped' (matches) and no scale (null → fresh).
    const cursor = document.querySelector('.piano-score-cursor');
    expect(cursor).not.toBeNull();
    // Positioned via a compositor-path transform (not left/top): first event
    // x=100, top=10, scale=1 → translateX = 100 - 9 = 91.
    expect(cursor.style.transform).toBe('translate3d(91px, 10px, 0)');
    expect(cursor.style.left).toBe('');
    expect(cursor.style.top).toBe('');
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
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // through the 4-beat @60 count-in (4000ms) → transport starts

    act(() => vi.advanceTimersByTime(1050)); // 1st quarter @60 = 1000ms
    expect(screen.getByText('2 / 4')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1050)); // 2nd quarter @60
    expect(screen.getByText('3 / 4')).toBeTruthy();
    act(() => vi.advanceTimersByTime(550)); // 3rd quarter @120 = 500ms
    expect(screen.getByText('4 / 4')).toBeTruthy();
  });

  it('Play starts a count-in before the transport moves, then advances (J1)', async () => {
    h.layoutExtras = { tempoEntries: [{ onsetQuarter: 0, bpm: 60 }] }; // count-in 4 beats @60 = 4000ms
    renderPlayer();
    screen.getByText('Polish').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    expect(document.querySelector('.piano-score-countin')).not.toBeNull(); // counting in
    expect(screen.getByText('1 / 4')).toBeTruthy();
    act(() => vi.advanceTimersByTime(3000)); // still within the 4000ms count-in
    expect(screen.getByText('1 / 4')).toBeTruthy(); // transport not started yet
    act(() => vi.advanceTimersByTime(1100)); // past 4000ms → count-in done → play
    expect(document.querySelector('.piano-score-countin')).toBeNull();
    act(() => vi.advanceTimersByTime(1050)); // first quarter @60 = 1000ms
    expect(screen.getByText('2 / 4')).toBeTruthy();
  });

  it('tapping during the count-in cancels it (transport never starts) (J1)', async () => {
    h.layoutExtras = { tempoEntries: [{ onsetQuarter: 0, bpm: 60 }] };
    renderPlayer();
    screen.getByText('Polish').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    expect(document.querySelector('.piano-score-countin')).not.toBeNull();
    act(() => { document.querySelector('.piano-score-player__scroll').click(); }); // tap = abort
    await act(async () => {});
    expect(document.querySelector('.piano-score-countin')).toBeNull();
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByText('1 / 4')).toBeTruthy(); // never advanced
  });

  it('opens the RunSummary when a Polish run completes, grading the final measure (H1)', async () => {
    h.layoutExtras = { tempoEntries: [{ onsetQuarter: 0, bpm: 120 }] }; // fast so the run ends quickly
    renderPlayer();
    screen.getByText('Polish').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(2100)); // through the 4-beat @120 count-in (2000ms)
    // Play the 4 onsets' expected notes so the final measure isn't silent, and run to the end.
    act(() => { [64, 52, 40, 62, 60, 62].forEach((n) => h.noteCb?.({ type: 'note_on', note: n, velocity: 80 })); });
    act(() => vi.advanceTimersByTime(4000)); // past all onsets → onDone
    // Summary panel appears on completion (not only on silent-stop).
    expect(document.querySelector('.piano-score-run-summary')).not.toBeNull();
  });

  it('a Polish loop on the final measure wraps at onDone instead of finishing (L6)', async () => {
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
      // Single-step final measure: the loop's in-point IS the last timeline event
      // (zero-span) — the nastiest wrap case; it must dwell + wrap, never finish.
      events: [
        { midi: 64, midis: [64], onsetQuarter: 0, x: 100, top: 10, bottom: 200, system: 0 },
        { midi: 62, midis: [62], onsetQuarter: 1, x: 160, top: 10, bottom: 200, system: 0 },
      ],
      steps: [
        { onsetQuarter: 0, measure: 0, notes: [{ midi: 64, staff: 0, x: 100, top: 10, bottom: 200, width: 8 }] },
        { onsetQuarter: 1, measure: 1, notes: [{ midi: 62, staff: 0, x: 160, top: 10, bottom: 200, width: 8 }] },
      ],
      measures: [
        { index: 0, number: 1, firstStep: 0, lastStep: 0 },
        { index: 1, number: 2, firstStep: 1, lastStep: 1 },
      ],
    };
    renderPlayer();
    screen.getByText('Polish').click();
    await act(async () => {});
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^loop/i })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /select measures/i })); });
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // through the 4-beat @60 count-in → run starts at the in-point
    act(() => vi.advanceTimersByTime(3500)); // several loop periods past the piece end
    expect(document.querySelector('.piano-score-run-summary')).toBeNull(); // wrapped, never finalized
    expect(screen.getByText('m 2 / 2')).toBeTruthy(); // still parked on the looped measure
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

  it('performs ALL parts (jukebox) and stops silence via panic', async () => {
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
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(100));
    // Audio plane: performed via timestamped sends (NOT pressNote — machine
    // playback never lights the keyboard as human input).
    expect(h.sendNoteAt).toHaveBeenCalledWith(40, expect.any(Number), expect.any(Number)); // LH performed
    expect(h.sendNoteAt).toHaveBeenCalledWith(64, expect.any(Number), expect.any(Number)); // RH performed too — full jukebox
    expect(h.pressNote).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Pause' }).click(); // pause mid-note
    await act(async () => {});
    expect(h.sendPanic).toHaveBeenCalled(); // no droning chord
  });

  it('does NOT perform staves the user marked as their own — roles route audio (H5)', async () => {
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
      notes: [
        { midi: 64, staff: 0, onsetQuarter: 0, durationQuarters: 1 }, // RH
        { midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 4 }, // LH
      ],
    };
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    fireEvent.click(screen.getByRole('radio', { name: 'RH' })); // My part = RH: the user plays staff 0, kiosk must NOT
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // My part is set → count-in (4 beats @60) runs first
    act(() => vi.advanceTimersByTime(100));  // then the kiosk performs
    expect(h.sendNoteAt).toHaveBeenCalledWith(40, expect.any(Number), expect.any(Number)); // LH still performed
    expect(h.sendNoteAt).not.toHaveBeenCalledWith(64, expect.any(Number), expect.any(Number)); // RH (yours) NOT performed
  });

  it('Listen counts the user in only when they play a part (J7)', async () => {
    h.layoutExtras = { tempoEntries: [{ onsetQuarter: 0, bpm: 60 }] };
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    // My part = None → Play starts immediately (no count-in overlay).
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    expect(document.querySelector('.piano-score-countin')).toBeNull();
    // Reset, claim a part, play again → count-in now runs.
    act(() => { fireEvent.click(screen.getByRole('radio', { name: 'RH' })); });
    // (a fresh Play after the timeline change)
    if (screen.queryByRole('button', { name: 'Play' })) { screen.getByRole('button', { name: 'Play' }).click(); await act(async () => {}); }
    expect(document.querySelector('.piano-score-countin')).not.toBeNull();
  });

  it('sends scheduled notes with timestamps (audio plane), not pressNote', async () => {
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
      notes: [{ midi: 64, staff: 0, onsetQuarter: 0, durationQuarters: 1 }],
    };
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(50)); // scheduled ahead — no timer advance strictly needed
    expect(h.sendNoteAt).toHaveBeenCalled();
    const [note, vel, atWall] = h.sendNoteAt.mock.calls[0];
    expect(note).toBe(64);
    expect(typeof vel).toBe('number');
    expect(typeof atWall).toBe('number'); // Web-MIDI wall timestamp, not undefined
    expect(h.pressNote).not.toHaveBeenCalled(); // machine playback never lights the keyboard
  });

  it('pause sends an immediate flush AND a delayed panic after the lookahead window', async () => {
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
      notes: [{ midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 8 }], // long note, still sounding
    };
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(100)); // note 40 scheduled + sounding
    h.sendPanic.mockClear();
    screen.getByRole('button', { name: 'Pause' }).click(); // pause
    await act(async () => {});
    const panicsAtPause = h.sendPanic.mock.calls.length;
    expect(panicsAtPause).toBeGreaterThanOrEqual(1); // immediate flush killed the sounding note
    act(() => vi.advanceTimersByTime(500)); // > lookaheadMs (400) + 60
    expect(h.sendPanic.mock.calls.length).toBeGreaterThan(panicsAtPause); // delayed panic for late-dispatched note-ons
  });

  it('resume within the flush window cancels the stale delayed panic (does not cut resumed playback)', async () => {
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
      notes: [{ midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 8 }], // long note
    };
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(100)); // playing, note sounding
    screen.getByRole('button', { name: 'Pause' }).click();        // pause → immediate flush + delayed panic armed
    await act(async () => {});
    act(() => vi.advanceTimersByTime(100)); // still inside the ~460ms window
    h.sendPanic.mockClear();
    screen.getByRole('button', { name: 'Play' }).click();          // resume within the window → must cancel the stale panic
    await act(async () => {});
    act(() => vi.advanceTimersByTime(500)); // advance past where the stale panic would have fired
    expect(h.sendPanic).not.toHaveBeenCalled(); // resumed playback was NOT cut
  });

  it('tempo control scales the Listen performance timeline', async () => {
    h.layoutExtras = { tempoEntries: [{ onsetQuarter: 0, bpm: 60 }] }; // written = 1000ms/quarter
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    // Half speed (0.5×) → each step takes 2000ms.
    fireEvent.click(screen.getByRole('button', { name: /^tempo/i }));
    fireEvent.click(screen.getByRole('button', { name: /^50%/ }));
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(1050)); // < 2000ms → not yet advanced
    expect(screen.getByText('1 / 4')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1050)); // > 2000ms total → advanced one step
    expect(screen.getByText('2 / 4')).toBeTruthy();
  });

  it('Listen light-up is always on: a correct strike lights without advancing (non-gating)', async () => {
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    // No toggle — light-up is unconditional in Listen (J5). Struck the top note of
    // the current (first) onset → lights, never advances.
    play(64);
    expect(screen.getByText('1 / 4')).toBeTruthy(); // cursor unchanged (non-gating)
    // A note NOT expected here does nothing (no advance, no throw).
    play(99);
    expect(screen.getByText('1 / 4')).toBeTruthy();
  });

  it('keeps My-part selection across a re-engrave (zoom must not wipe it)', async () => {
    h.layoutExtras = { notes: [
      { midi: 64, staff: 0, onsetQuarter: 0, durationQuarters: 1 },
      { midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 4 },
    ] };
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    fireEvent.click(screen.getByRole('radio', { name: 'RH' })); // My part = RH
    await act(async () => {});
    expect(screen.getByRole('radio', { name: 'RH' })).toHaveAttribute('aria-checked', 'true');
    // Zoom via the Size stepper → re-engrave (fresh layout.notes identity).
    fireEvent.click(screen.getByRole('button', { name: /view options/i }));
    fireEvent.click(screen.getByRole('button', { name: '125%' }));
    await act(async () => {});
    expect(screen.getByRole('radio', { name: 'RH' })).toHaveAttribute('aria-checked', 'true'); // preserved
  });

  it('a mid-run view change (transpose) pauses playback so sheet & sound cannot diverge (H2)', async () => {
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
      notes: [{ midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 8 }],
    };
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click(); // My part = None → plays immediately
    await act(async () => {});
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument(); // playing
    h.sendPanic.mockClear();
    act(() => { fireEvent.click(screen.getByRole('button', { name: /transpose up/i })); });
    await act(async () => {});
    expect(h.sendPanic).toHaveBeenCalled(); // silenced on the view change
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument(); // paused
  });

  it('silences sounding notes on tap-seek in Play mode (no stuck note)', async () => {
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
      notes: [{ midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 8 }], // long note, still sounding
    };
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(100)); // note 40 now sounding
    h.sendPanic.mockClear();
    act(() => { document.querySelector('.piano-score-player__scroll').click(); }); // tap to seek
    expect(h.sendPanic).toHaveBeenCalled(); // flushed, won't drone
  });

  it('Listen plays only the loop and wraps at the out-point with a silence flush (L6)', async () => {
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
      // Two onsets only, matching the steps below — the loop (m2) contains the
      // FINAL step, so the wrap must come from the onDone path, not onEvent.
      events: [
        { midi: 64, midis: [64], onsetQuarter: 0, x: 100, top: 10, bottom: 200, system: 0 },
        { midi: 62, midis: [62], onsetQuarter: 1, x: 160, top: 10, bottom: 200, system: 0 },
      ],
      steps: [
        { onsetQuarter: 0, measure: 0, notes: [{ midi: 64, staff: 0, x: 100, top: 10, bottom: 200, width: 8 }] },
        { onsetQuarter: 1, measure: 1, notes: [{ midi: 62, staff: 0, x: 160, top: 10, bottom: 200, width: 8 }] },
      ],
      measures: [
        { index: 0, number: 1, firstStep: 0, lastStep: 0 },
        { index: 1, number: 2, firstStep: 1, lastStep: 1 },
      ],
    };
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    // Loop measure 2 only (tail measure — exercises the onDone wrap path).
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^loop/i })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /select measures/i })); });
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
    expect(screen.getByText('m 2 / 2')).toBeTruthy();
    screen.getByRole('button', { name: 'Play' }).click(); // My part = None → plays immediately
    await act(async () => {});
    act(() => vi.advanceTimersByTime(1100)); // past the final step @60bpm → would normally finish
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument(); // still playing — wrapped, not done
    expect(screen.getByText('m 2 / 2')).toBeTruthy(); // back at the loop in-point
    // The wrap arms the silence flush; its delayed panic (lookahead+60ms) kills
    // any in-flight tail sends so nothing drones across the loop boundary.
    act(() => vi.advanceTimersByTime(500));
    expect(h.sendPanic).toHaveBeenCalled();
  });

  it('a role change during the wrap dwell cancels the pending restart — no uncommanded audio (L6)', async () => {
    // All staves claimed as "mine" → step-only timeline → a tail loop on the
    // final step is ZERO-SPAN, so each pass ends in the one-beat dwell before
    // wrapping. Un-claiming the parts DURING the dwell goes through
    // disruptListenPlayback while nothing is playing — it must still cancel the
    // dwell, or the stale timer restarts playback seconds later with the
    // now-note-bearing timeline (uncommanded audio).
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
      events: [
        { midi: 64, midis: [64, 40], onsetQuarter: 0, x: 100, top: 10, bottom: 200, system: 0 },
        { midi: 62, midis: [62, 41], onsetQuarter: 1, x: 160, top: 10, bottom: 200, system: 0 },
      ],
      steps: [
        { onsetQuarter: 0, measure: 0, notes: [{ midi: 64, staff: 0, x: 100, top: 10, bottom: 200, width: 8 }, { midi: 40, staff: 1, x: 100, top: 10, bottom: 200, width: 8 }] },
        { onsetQuarter: 1, measure: 1, notes: [{ midi: 62, staff: 0, x: 160, top: 10, bottom: 200, width: 8 }, { midi: 41, staff: 1, x: 160, top: 10, bottom: 200, width: 8 }] },
      ],
      measures: [
        { index: 0, number: 1, firstStep: 0, lastStep: 0 },
        { index: 1, number: 2, firstStep: 1, lastStep: 1 },
      ],
    };
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    act(() => { fireEvent.click(screen.getByRole('radio', { name: 'Both' })); }); // My part = everything → kiosk sends nothing
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^loop/i })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /select measures/i })); });
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // count-in (my part set) → zero-span run ends instantly → dwell armed
    h.sendNoteAt.mockClear();
    // Give the parts back to the kiosk DURING the dwell (transport idle).
    act(() => { fireEvent.click(screen.getByRole('radio', { name: 'None' })); });
    act(() => vi.advanceTimersByTime(1500)); // well past the one-beat dwell
    expect(h.sendNoteAt).not.toHaveBeenCalled(); // stale dwell canceled — no uncommanded restart
  });
});

describe('ScorePlayer — Restart honors the loop in-point (L5)', () => {
  it('Restart returns to the loop in-point, not measure 1', () => {
    h.layoutExtras = {
      steps: [
        { onsetQuarter: 0, measure: 0, notes: [{ midi: 64, staff: 0, x: 100, top: 10, bottom: 200, width: 8 }] },
        { onsetQuarter: 1, measure: 1, notes: [{ midi: 62, staff: 0, x: 160, top: 10, bottom: 200, width: 8 }] },
      ],
      measures: [
        { index: 0, number: 1, firstStep: 0, lastStep: 0 },
        { index: 1, number: 2, firstStep: 1, lastStep: 1 },
      ],
    };
    renderPlayer();
    act(() => { screen.getByText('Polish').click(); });
    // Set a loop on measure 2 only (two selection taps at x=160 → step 1 → measure index 1).
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^loop/i })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /select measures/i })); });
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
    expect(screen.getByText('m 2 / 2')).toBeTruthy(); // focus jump put the cursor at the in-point
    act(() => { fireEvent.click(screen.getByRole('button', { name: /restart/i })); });
    expect(screen.getByText('m 2 / 2')).toBeTruthy(); // NOT m 1 / 2
  });
});

describe('ScorePlayer — loop endpoint nudging (L2)', () => {
  it('nudging "Loop end later" from the menu grows the loop by one measure', () => {
    h.layoutExtras = {
      steps: [
        { onsetQuarter: 0, measure: 0, notes: [{ midi: 64, staff: 0, x: 100, top: 10, bottom: 200, width: 8 }] },
        { onsetQuarter: 1, measure: 1, notes: [{ midi: 62, staff: 0, x: 160, top: 10, bottom: 200, width: 8 }] },
      ],
      measures: [
        { index: 0, number: 1, firstStep: 0, lastStep: 0 },
        { index: 1, number: 2, firstStep: 1, lastStep: 1 },
      ],
    };
    renderPlayer();
    act(() => { screen.getByText('Learn').click(); });
    // Set a loop of m1–m1 (two selection taps on the first note).
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^loop/i })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /select measures/i })); });
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 100, clientY: 100 }); });
    act(() => { fireEvent.click(scroll, { clientX: 100, clientY: 100 }); });
    expect(screen.getByRole('button', { name: /loop m1–m1/i })).toBeInTheDocument();
    // Open the Loop menu and nudge the end later.
    act(() => { fireEvent.click(screen.getByRole('button', { name: /loop m1–m1/i })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /loop end later/i })); });
    expect(screen.getByRole('button', { name: /loop m1–m2/i })).toBeInTheDocument();
  });
});

describe('ScorePlayer — selection tap threshold (L3)', () => {
  it('ignores a margin tap during loop selection instead of committing a far measure', () => {
    h.layoutExtras = {
      steps: [
        { onsetQuarter: 0, measure: 0, notes: [{ midi: 64, staff: 0, x: 100, top: 10, bottom: 200, width: 8 }] },
        { onsetQuarter: 1, measure: 1, notes: [{ midi: 62, staff: 0, x: 160, top: 10, bottom: 200, width: 8 }] },
      ],
      measures: [
        { index: 0, number: 1, firstStep: 0, lastStep: 0 },
        { index: 1, number: 2, firstStep: 1, lastStep: 1 },
      ],
    };
    renderPlayer();
    act(() => { screen.getByText('Learn').click(); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^loop/i })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /select measures/i })); });
    const scroll = document.querySelector('.piano-score-player__scroll');
    // A tap 800px right of the last note (margin) must NOT arm an in-point.
    act(() => { fireEvent.click(scroll, { clientX: 960, clientY: 100 }); });
    expect(screen.getByText(/tap the first measure/i)).toBeInTheDocument(); // still stage 'first'
    // A tap on a real note proceeds normally.
    act(() => { fireEvent.click(scroll, { clientX: 100, clientY: 100 }); });
    expect(screen.getByText(/now tap the last/i)).toBeInTheDocument();
  });
});

describe('ScorePlayer — metronome in Learn (M1/M2/M4)', () => {
  it('shows a labeled BPM toggle in Learn; toggling starts/stops the click immediately', () => {
    renderPlayer();
    enterLearn();
    const btn = screen.getByRole('button', { name: /metronome/i });
    expect(btn).toHaveTextContent('100'); // parseMusicXml default tempo 100 × 100% (note icon is SVG)
    expect(btn.querySelector('svg')).not.toBeNull(); // QuarterNoteIcon
    expect(btn).toHaveAttribute('aria-pressed', 'false'); // Learn defaults OFF
    expect(h.clickSched.start).not.toHaveBeenCalled();
    act(() => { fireEvent.click(btn); });
    expect(h.clickSched.start).toHaveBeenCalledWith(100); // free-running click starts NOW
    act(() => { fireEvent.click(btn); });
    expect(h.clickSched.stop).toHaveBeenCalled();
  });

  it('Learn metronome follows the tempo control', () => {
    renderPlayer();
    enterLearn();
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^tempo/i })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^50%/ })); }); // anchored — /50%/ also hits "150%"
    act(() => { fireEvent.click(screen.getByRole('button', { name: /metronome/i })); });
    expect(h.clickSched.start).toHaveBeenCalledWith(50); // 100 × 0.5
  });

  it('retunes a running Learn click live with the EXACT bpm (no display rounding)', () => {
    h.layoutExtras = { tempoEntries: [{ onsetQuarter: 0, bpm: 63 }] }; // 63 × 0.5 = 31.5 — rounding would corrupt it
    renderPlayer();
    enterLearn();
    act(() => { fireEvent.click(screen.getByRole('button', { name: /metronome/i })); }); // ON first
    expect(h.clickSched.start).toHaveBeenCalledWith(63);
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^tempo/i })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^50%/ })); }); // change tempo while ticking
    // The hook must receive the exact product — rounding belongs to the bar's
    // readout only, or the click drifts against the tempo-scaled timelines
    // (playTimeline scales by exact 1/tempoMult): 32 vs 31.5 = a beat per ~64.
    expect(h.clickSched.setBpm).toHaveBeenCalledWith(31.5);
    expect(screen.getByRole('button', { name: /metronome/i })).toHaveTextContent('32'); // readout IS rounded
  });

  it('tempo steps show the resulting BPM (M4)', () => {
    renderPlayer(); // Listen
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^tempo/i })); });
    // Each percent step also shows the BPM it produces (base 100 from the fixture).
    expect(screen.getByRole('button', { name: /^50%.*50/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^100%.*100/ })).toBeInTheDocument();
  });
});
