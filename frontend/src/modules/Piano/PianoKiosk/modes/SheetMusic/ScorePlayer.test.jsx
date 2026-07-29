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
  // A real engrave is ASYNC: after a transpose the sheet republishes its geometry
  // a beat later. Set holdLayout to keep the stub's publish pending (the state the
  // resume gate must respect) and call releaseLayout() to land it.
  holdLayout: false,
  releaseLayout: null,
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
    MusicXmlRenderer: ({ onLayout, onReady, children, scale, transpose = 0 }) => {
      // Re-fire onLayout when scale or transpose changes (mirrors a real
      // re-engrave — both force one), always with FRESH array references so tests
      // exercise the new-identity path. `transpose` is echoed in the payload
      // because the real renderer publishes it (it is what tells the consumer the
      // engraved KEY is current, audit H2).
      useEffect(() => {
        const publish = () => {
          const extra = h.layoutExtras || {};
          const events = extra.events || h.events;
          const steps = extra.steps || deriveSteps(events);
          const notes = (extra.notes || deriveNotes(steps)).map((n) => ({ ...n }));
          onLayout?.({
            width: 800, height: 400, tempoEntries: [], flow: 'wrapped', transpose,
            ...extra,
            events,
            steps,
            notes,
          });
          onReady?.();
        };
        if (h.holdLayout) { h.releaseLayout = () => { h.holdLayout = false; publish(); }; return; }
        publish();
      }, [onLayout, onReady, scale, transpose]);
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
  h.holdLayout = false; h.releaseLayout = null;
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

describe('ScorePlayer — UI-intent capture (Task 12)', () => {
  it('records a UI_INTENT in the ring when a control is used (mode change)', () => {
    renderPlayer(); // opens in Listen
    __resetRecorder();
    act(() => { screen.getByText('Learn').click(); }); // mode change → tapIntent('mode')
    const hit = __snapshotForTest().records.some((r) => r.kind === KIND.UI_INTENT);
    expect(hit).toBe(true);
    cleanup();
  });
});

describe('ScorePlayer — touch gesture flush (pointercancel + active guard)', () => {
  // jsdom lacks PointerEvent, but listeners route by type string, so a MouseEvent
  // named 'pointer*' fires them and carries clientX/clientY.
  const pe = (type, x, y) => new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });

  it('flushes the gesture on pointercancel (native scroll ends with cancel, not up)', () => {
    renderPlayer();
    const scroll = document.querySelector('.piano-score-player__scroll');
    __resetRecorder();
    scroll.dispatchEvent(pe('pointerdown', 10, 20));
    scroll.dispatchEvent(pe('pointermove', 12, 50));
    scroll.dispatchEvent(pe('pointermove', 14, 90));
    scroll.dispatchEvent(pe('pointercancel', 14, 100)); // scroll cancels — must still flush
    const recs = __snapshotForTest().records;
    expect(recs.some((r) => r.kind === KIND.TOUCH_START)).toBe(true);
    expect(recs.some((r) => r.kind === KIND.TOUCH_MOVE)).toBe(true);
    expect(recs.some((r) => r.kind === KIND.TOUCH_END)).toBe(true); // FAILS today (no cancel listener)
    cleanup();
  });

  it('guards stray moves so a prior gesture cannot leak into a later flush', () => {
    renderPlayer();
    const scroll = document.querySelector('.piano-score-player__scroll');
    scroll.dispatchEvent(pe('pointerdown', 10, 20));
    scroll.dispatchEvent(pe('pointermove', 10, 60)); // this sample belongs to the cancelled gesture
    scroll.dispatchEvent(pe('pointercancel', 10, 100));
    __resetRecorder(); // clear the ring: nothing recorded AFTER this may reference the old gesture
    scroll.dispatchEvent(pe('pointermove', 500, 500)); // stray hover, no active gesture
    scroll.dispatchEvent(pe('pointermove', 600, 600));
    scroll.dispatchEvent(pe('pointerup', 700, 700)); // a flush with no preceding down
    const moves = __snapshotForTest().records.filter((r) => r.kind === KIND.TOUCH_MOVE);
    // New code: cancel already flushed + cleared, and inactive moves are ignored,
    // so this flush emits nothing. Old code: the y=60 sample (and strays) leak here.
    expect(moves.length).toBe(0); // FAILS today (leaked samples)
    expect(moves.some((r) => r.b === 60)).toBe(false);
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
    // The 4th onset is the LAST timeline event, so firing it also completes the
    // run — and a completed run returns the cursor home (audit H2). Landing on
    // '1 / 4' at 2550ms elapsed is itself the proof the mid-piece 120bpm change
    // applied: at the written 60bpm the 4th onset wouldn't be due until 3000ms.
    expect(screen.getByText('1 / 4')).toBeTruthy();
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
    // The panel appearing was never the claim worth making — the FINAL measure
    // getting a grade is. The transport fires the last step's onEvent and completes
    // in the SAME tick, so its setStep never commits (and onDone then sends the
    // cursor home): the evaluator still reads the second-to-last measure. The
    // probe's 5-measure run graded 0–3 and never 4.
    h.layoutExtras = FIVE_MEASURES;
    const emitted = captureLog();

    renderPlayer();
    screen.getByText('Polish').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // through the 4-beat @60 count-in
    // Play each measure's note 100ms into its beat (comfortably inside tolerance).
    play(60);
    for (const n of [61, 62, 63]) { act(() => vi.advanceTimersByTime(1000)); play(n); }
    play(64); // the closing note, rolled in on its beat — i.e. before the tick that
              // fires the last onset and ends the run in the same breath
    act(() => vi.advanceTimersByTime(1000)); // …that tick → onDone

    expect(document.querySelector('.piano-score-run-summary')).not.toBeNull();
    const graded = emitted.filter(([ev]) => ev === 'score.polish.measure').map(([, d]) => [d.measure, d.grade]);
    expect(graded).toEqual([[0, 'green'], [1, 'green'], [2, 'green'], [3, 'green'], [4, 'green']]);
  });

  // Two measures, one step each @60bpm. Single-step FINAL measure: a loop pinned to
  // measure index 1 has its in-point ON the last timeline event (zero-span) — the
  // nastiest wrap case; it must dwell + wrap, never finish.
  const TAIL_MEASURE = {
    tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
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

  it('a Polish loop on the final measure wraps at onDone instead of finishing (L6)', async () => {
    h.layoutExtras = TAIL_MEASURE;
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

  // Three measures, one step each @60bpm. Measure INDEX 1 is a MIDDLE measure, so
  // a one-measure loop on it wraps through the transport's onEvent branch (the
  // tail-measure onDone wrap is the L6 test above).
  const THREE_MEASURES = {
    tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
    events: [
      { midi: 64, midis: [64], onsetQuarter: 0, x: 100, top: 10, bottom: 200, system: 0 },
      { midi: 62, midis: [62], onsetQuarter: 1, x: 160, top: 10, bottom: 200, system: 0 },
      { midi: 60, midis: [60], onsetQuarter: 2, x: 220, top: 10, bottom: 200, system: 0 },
    ],
    steps: [
      { onsetQuarter: 0, measure: 0, notes: [{ midi: 64, staff: 0, x: 100, top: 10, bottom: 200, width: 8 }] },
      { onsetQuarter: 1, measure: 1, notes: [{ midi: 62, staff: 0, x: 160, top: 10, bottom: 200, width: 8 }] },
      { onsetQuarter: 2, measure: 2, notes: [{ midi: 60, staff: 0, x: 220, top: 10, bottom: 200, width: 8 }] },
    ],
    measures: [
      { index: 0, number: 1, firstStep: 0, lastStep: 0 },
      { index: 1, number: 2, firstStep: 1, lastStep: 1 },
      { index: 2, number: 3, firstStep: 2, lastStep: 2 },
    ],
  };

  // Capture what the session-logged child logger emits (same spy shape as the
  // intent-routing test above), so assertions are on the SHIPPED event. The
  // describe's afterEach vi.restoreAllMocks() puts child() back.
  const captureLog = () => {
    const root = getLogger();
    const origChild = root.child.bind(root);
    const emitted = []; // [event, data]
    vi.spyOn(root, 'child').mockImplementation((ctx) => {
      const c = origChild(ctx);
      const orig = c.info.bind(c);
      c.info = (ev, data, opts) => { emitted.push([ev, data]); return orig(ev, data, opts); };
      return c;
    });
    return emitted;
  };

  // Guided two-tap selection of the one measure whose note sits at `clientX` —
  // both taps land ON that note, so the loop is exactly one measure long.
  const loopMeasureAtX = (clientX) => {
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^loop/i })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /select measures/i })); });
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX, clientY: 100 }); });
    act(() => { fireEvent.click(scroll, { clientX, clientY: 100 }); });
  };
  const loopSecondMeasure = () => loopMeasureAtX(160); // THREE_MEASURES: a MIDDLE measure

  it('grades the measure of a ONE-measure Polish loop on every wrap (Task 9)', async () => {
    // The field scenario: focus {inMeasure: 2, outMeasure: 2}, count-in, notes
    // played, and not one score.polish.measure in the whole run — the cursor
    // wraps onto the SAME measure, so the advance-driven grader never fired.
    h.layoutExtras = THREE_MEASURES;
    const emitted = captureLog();

    renderPlayer();
    screen.getByText('Polish').click();
    await act(async () => {});
    loopSecondMeasure();
    expect(screen.getByText('m 2 / 3')).toBeTruthy(); // parked on the looped measure
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // through the 4-beat @60 count-in
    act(() => { h.noteCb?.({ type: 'note_on', note: 62, velocity: 80 }); }); // play the measure
    act(() => vi.advanceTimersByTime(1100)); // one quarter @60 → cursor passes the out-point → wrap

    const grades = emitted.filter(([ev]) => ev === 'score.polish.measure');
    expect(grades.length).toBeGreaterThanOrEqual(1);
    expect(grades[0][1]).toMatchObject({ measure: 1, grade: 'green' });
    expect(screen.getByText('m 2 / 3')).toBeTruthy(); // still looping the same measure
  });

  it('grades a Polish loop pinned to the FINAL measure, pass after pass (Task 19)', async () => {
    // The zero-span case: the loop's in-point IS the last timeline event, so the
    // run completes inside play()'s immediate tick and restarts through onDone's
    // one-beat dwell. `transport.playing` never commits true across that dwell, so
    // an evaluator gated on it never even subscribes — the probe played six correct
    // passes over a tail-measure loop and got { btn: 'Play', grades: [], stops: 0 }.
    h.layoutExtras = TAIL_MEASURE;
    const emitted = captureLog();

    renderPlayer();
    screen.getByText('Polish').click();
    await act(async () => {});
    loopMeasureAtX(160); // TAIL_MEASURE: the LAST measure (index 1)
    expect(screen.getByText('m 2 / 2')).toBeTruthy();
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // through the 4-beat @60 count-in
    act(() => { h.noteCb?.({ type: 'note_on', note: 62, velocity: 80 }); }); // pass 1
    act(() => vi.advanceTimersByTime(1100)); // one-beat dwell expires → wrap
    act(() => { h.noteCb?.({ type: 'note_on', note: 62, velocity: 80 }); }); // pass 2
    act(() => vi.advanceTimersByTime(1100)); // …and wrap again

    const grades = emitted.filter(([ev]) => ev === 'score.polish.measure');
    expect(grades.length).toBeGreaterThanOrEqual(2);        // one per pass
    expect(grades.map(([, d]) => d.measure)).toEqual(grades.map(() => 1)); // the looped measure
    // Every pass is scored from the note actually played — not a silent red wash.
    // (Only the GRADE band varies with the at-tempo drift proxy: a note struck
    // 200ms into the beat is a legitimate yellow.)
    expect(grades.every(([, d]) => d.noteScore === 1)).toBe(true);
    expect(grades[0][1].grade).toBe('green'); // played on the beat → green
  });

  it('the evaluator is off once a run is over — a later cursor move grades nothing (Task 19)', async () => {
    // Guards the phantom-grade class of bug: the run-active signal that survives
    // the loop dwell must NOT survive a genuine end-of-run, or the evaluator would
    // grade measures the cursor merely passes over while nothing is playing.
    h.layoutExtras = THREE_MEASURES;
    const emitted = captureLog();

    renderPlayer();
    screen.getByText('Polish').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // count-in
    for (let i = 0; i < 4; i++) act(() => vi.advanceTimersByTime(1100)); // play it out → onDone
    expect(document.querySelector('.piano-score-run-summary')).not.toBeNull(); // the run ended
    emitted.length = 0; // only what happens AFTER the run is over

    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 220, clientY: 100 }); }); // tap-seek to measure 3
    act(() => { h.noteCb?.({ type: 'note_on', note: 60, velocity: 80 }); });
    act(() => { fireEvent.click(scroll, { clientX: 100, clientY: 100 }); }); // …and back to measure 1
    expect(emitted.filter(([ev]) => ev === 'score.polish.measure')).toEqual([]);
  });

  it('Listen loop wraps do not make Polish grade a measure the user has not played (Task 9)', async () => {
    // The loop follows Listen↔Polish (L6), and Listen wraps bump the same
    // loop-wrap counter with the evaluator disabled. If those wraps go untracked,
    // the first commit back in Polish reads a stale counter as an end-of-measure
    // and paints a red wash + banks a silent measure before a single note.
    h.layoutExtras = THREE_MEASURES;
    const emitted = captureLog();

    renderPlayer(); // opens in Listen
    await act(async () => {});
    loopSecondMeasure();
    screen.getByRole('button', { name: 'Play' }).click(); // My part = None → plays at once
    await act(async () => {});
    act(() => vi.advanceTimersByTime(3000)); // several Listen loop wraps
    screen.getByRole('button', { name: 'Pause' }).click();
    await act(async () => {});
    // Now drill the same loop in Polish.
    act(() => { screen.getByText('Polish').click(); });
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    emitted.length = 0; // only what the Polish run itself emits
    act(() => vi.advanceTimersByTime(4100)); // through the count-in → the transport starts

    expect(emitted.filter(([ev]) => ev === 'score.polish.measure')).toEqual([]);
  });

  it('pausing a Polish run grades the worked measure and summarizes it (Task 10)', async () => {
    // A paused run is still a run. The field logs show users working a passage
    // and stopping — and getting no grade, no summary, nothing. The tally must
    // INCLUDE the measure finalize() just graded (gradesRef is a render-time
    // snapshot, so a naive same-tick summary would report zero greens).
    h.layoutExtras = THREE_MEASURES;
    const emitted = captureLog();

    renderPlayer();
    screen.getByText('Polish').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // through the 4-beat @60 count-in
    play(64); // measure 1's expected note
    screen.getByRole('button', { name: 'Pause' }).click();
    await act(async () => {});

    expect(document.querySelector('.piano-score-run-summary')).not.toBeNull();
    const summaries = emitted.filter(([ev]) => ev === 'score.polish.summary');
    expect(summaries.length).toBe(1);
    expect(summaries[0][1]).toMatchObject({ greens: 1, yellows: 0, reds: 0, overall: 'green' });
  });

  it('a second pause grades again — the finalize guard clears on resume (Task 10)', async () => {
    h.layoutExtras = THREE_MEASURES;
    const emitted = captureLog();

    renderPlayer();
    screen.getByText('Polish').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // count-in
    play(64);
    screen.getByRole('button', { name: 'Pause' }).click();
    await act(async () => {});
    // …pick it back up and work the same measure again.
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // second count-in
    play(64);
    screen.getByRole('button', { name: 'Pause' }).click();
    await act(async () => {});

    expect(emitted.filter(([ev]) => ev === 'score.polish.measure').length).toBe(2);
    const summaries = emitted.filter(([ev]) => ev === 'score.polish.summary');
    expect(summaries.length).toBe(2);
    expect(summaries[1][1]).toMatchObject({ greens: 1, overall: 'green' });
  });

  it('Play → immediate Pause banks no phantom red for a measure never played (Task 10)', async () => {
    // Tap Play, change your mind, tap Pause. Polish must not tell the user they
    // failed a measure they never got to play: no grade logged, no red wash on
    // the score, nothing banked toward the silent stop.
    h.layoutExtras = THREE_MEASURES;
    const emitted = captureLog();

    renderPlayer();
    screen.getByText('Polish').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // through the count-in — playing, but not a note struck
    screen.getByRole('button', { name: 'Pause' }).click();
    await act(async () => {});

    expect(emitted.filter(([ev]) => ev === 'score.polish.measure')).toEqual([]);
    expect(document.querySelector('.piano-score-measure-grade')).toBeNull(); // no wash
  });

  it('Play → immediate Pause does not congratulate a run that never happened (Task 10)', async () => {
    // The panel still opens — a kiosk that swallows a button press is its own
    // failure — but it must report that there is nothing to grade rather than
    // praising a passage the user never played.
    h.layoutExtras = THREE_MEASURES;
    const emitted = captureLog();

    renderPlayer();
    screen.getByText('Polish').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100));
    screen.getByRole('button', { name: 'Pause' }).click();
    await act(async () => {});

    expect(document.querySelector('.piano-score-run-summary')).not.toBeNull(); // the tap was honored
    expect(screen.queryByText(/nicely done/i)).toBeNull();
    expect(screen.getByText(/nothing to grade/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /drill worst section/i })).toBeNull();
    const summaries = emitted.filter(([ev]) => ev === 'score.polish.summary');
    expect(summaries[0][1]).toMatchObject({ greens: 0, yellows: 0, reds: 0, overall: null });
  });

  // N single-step measures @60bpm — one measure per beat, so a run walks a measure
  // boundary every 1000ms and every measure is either played or silent outright.
  const singleStepMeasures = (n) => ({
    tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
    events: Array.from({ length: n }, (_, i) => ({ midi: 60 + i, midis: [60 + i], onsetQuarter: i, x: 100 + i * 60, top: 10, bottom: 200, system: 0 })),
    steps: Array.from({ length: n }, (_, i) => ({ onsetQuarter: i, measure: i, notes: [{ midi: 60 + i, staff: 0, x: 100 + i * 60, top: 10, bottom: 200, width: 8 }] })),
    measures: Array.from({ length: n }, (_, i) => ({ index: i, number: i + 1, firstStep: i, lastStep: i })),
  });
  // The advance rule grades measures 0–3 as the cursor leaves them; the run then
  // completes on measure 4, which onDone must finalize.
  const FIVE_MEASURES = singleStepMeasures(5);
  // Long enough that the 4th consecutive silent measure (the default
  // silentMeasuresToStop) is a plain mid-piece advance, not the completing tick.
  const SEVEN_MEASURES = singleStepMeasures(7);

  it('the completion summary counts the measures onDone just finalized (Task 10)', async () => {
    // A run played through silently: FIVE measures red — three from the advance
    // rule, then the last two from finalize() at onDone (the completing tick
    // swallows the boundary between them, so neither had been graded). The
    // summary must report all five. Reporting fewer is Bug B: gradesRef is a
    // render-time snapshot, so what finalize just graded is not in it yet.
    h.layoutExtras = FIVE_MEASURES;
    const emitted = captureLog();

    renderPlayer();
    screen.getByText('Polish').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // through the count-in
    for (let i = 0; i < 8; i++) act(() => vi.advanceTimersByTime(1100)); // play the piece out

    const grades = emitted.filter(([ev]) => ev === 'score.polish.measure');
    expect(grades.map(([, d]) => d.measure)).toEqual([0, 1, 2, 3, 4]); // advance rule ×3 + finalize ×2
    expect(grades.every(([, d]) => d.grade === 'red')).toBe(true);
    const summaries = emitted.filter(([ev]) => ev === 'score.polish.summary');
    expect(summaries.length).toBe(1);
    // Every graded measure is in the tally — including the ones finalize produced
    // in this same tick. Without the fold this reads reds: 3.
    expect(summaries[0][1]).toMatchObject({ greens: 0, yellows: 0, reds: 5, overall: 'red' });
    expect(summaries[0][1].reds).toBe(grades.length);
  });

  it('the silent-stop summary counts the measure that silenced the run (Task 20)', async () => {
    // Four silent measures trip the auto-stop. onSilentStop fires from INSIDE the
    // evaluator's grading effect, in the same tick as the 4th measure's grade, so
    // gradesRef (assigned during render) is one behind — the probe graded four reds
    // and logged reds: 3. The measure that silenced the run must be in its own
    // summary; the grade has to travel with the callback.
    h.layoutExtras = SEVEN_MEASURES;
    const emitted = captureLog();

    renderPlayer();
    screen.getByText('Polish').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // through the count-in
    for (let i = 0; i < 5; i++) act(() => vi.advanceTimersByTime(1100)); // 4 silent measures → stop

    const grades = emitted.filter(([ev]) => ev === 'score.polish.measure');
    expect(grades.map(([, d]) => d.measure)).toEqual([0, 1, 2, 3]);
    expect(emitted.filter(([ev]) => ev === 'score.polish.silent-stop').length).toBe(1);
    const summaries = emitted.filter(([ev]) => ev === 'score.polish.summary');
    expect(summaries.length).toBe(1);
    expect(summaries[0][1]).toMatchObject({ greens: 0, yellows: 0, reds: 4, overall: 'red' });
    expect(summaries[0][1].reds).toBe(grades.length); // the tally is the run's grades
  });

  it('score.countin.start logs the PLAN, not the meter', async () => {
    // The log used to carry `beats: parsed?.timeSig?.beats` — the meter. Now that a
    // fast tempo changes the pulse, the meter no longer tells a log reader how many
    // clicks were heard or how long the count-in ran, so the plan itself is shipped.
    h.layoutExtras = { tempoEntries: [{ onsetQuarter: 0, bpm: 216 }] }; // above the countable rate
    const emitted = captureLog();

    renderPlayer();
    screen.getByText('Polish').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});

    const starts = emitted.filter(([ev]) => ev === 'score.countin.start');
    expect(starts.length).toBe(1);
    const d = starts[0][1];
    expect(d.subdivision).toBe(2);        // the pulse actually used
    expect(d.beats).toBe(4);              // CLICKS heard, not the 4/4 meter's beats
    expect(d.periodMs).toBeCloseTo(555.6, 1);
    expect(d.totalMs).toBeCloseTo(2222.2, 1);
    expect(d.bpm).toBe(216);              // written tempo survives the spread
    expect(d.tempoMult).toBe(1);          // and so does the multiplier
    expect(d.mode).toBe('polish');
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
    // Stop first: a part change mid-run resumes itself WITHOUT a count-in (H5), so
    // the count-in rule is about an explicit Play, which is what this test is for.
    screen.getByRole('button', { name: 'Pause' }).click();
    await act(async () => {});
    act(() => { fireEvent.click(screen.getByRole('radio', { name: 'RH' })); });
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
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

  it('a mid-run view change (transpose) flushes the schedule, then picks the run back up (H2/M3)', async () => {
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
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Key' })); }); // open the Key sheet
    act(() => { fireEvent.click(screen.getByRole('button', { name: '+1' })); }); // tap +1 semitone
    await act(async () => {});
    expect(h.sendPanic).toHaveBeenCalled(); // silenced on the view change
    // …and the user is not stranded mid-piece: the rebuild-pause resumes itself
    // once the layout is trustworthy (M3).
    // The stub republishes its geometry for the new key immediately, so the
    // transpose gate (Task 18) opens on the next commit and the run continues.
    // The held-engrave case — where the gate has to WAIT — is covered below.
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
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

  it('returns the cursor home when a run completes, so Play replays the piece (audit H2)', async () => {
    // The transport rewinds itself at onDone, but `step` used to stay parked on
    // the final step — so the next Play seeked to the end and produced ~1.6s of
    // the last measure. One field session hit that fourteen times.
    h.layoutExtras = { tempoEntries: [{ onsetQuarter: 0, bpm: 60 }] }; // 1000ms/quarter, onsets at q0..q3
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    expect(screen.getByTestId('score-position')).toHaveTextContent('1 / 4');
    screen.getByRole('button', { name: 'Play' }).click(); // My part = None → plays immediately
    await act(async () => {});
    act(() => vi.advanceTimersByTime(5000)); // past the final onset AND its release → onDone
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument(); // the run finished
    expect(screen.getByTestId('score-position')).toHaveTextContent('1 / 4'); // home, not parked at 4 / 4
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

describe('ScorePlayer — rebuild-pause resume (H5/M3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
    vi.setSystemTime(0);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('the rebuild-pause flush cannot cut the run it just resumed', async () => {
    // pauseForRebuild arms the delayed panic (lookahead+60ms). toggleRun has always
    // cancelled it on resume — now that the resume effect is a SECOND entry point,
    // it must do the same, or the panic lands ~460ms INTO the resumed music.
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
      notes: [
        { midi: 64, staff: 0, onsetQuarter: 0, durationQuarters: 1 },
        { midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 8 }, // long sounding note
      ],
    };
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(100));
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'RH' })); });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument(); // resumed
    h.sendPanic.mockClear();
    act(() => vi.advanceTimersByTime(600)); // past lookahead(400)+60
    expect(h.sendPanic).not.toHaveBeenCalled();
  });

  it('resumes playback after a Listen part change, with no surprise count-in (H5)', async () => {
    // Choosing "my part" rebuilds the note timeline, so playback has to be paused —
    // but a part pick is not a stop request. All four field part-changes were
    // reverted within 90s because the music died on the spot.
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
      notes: [
        { midi: 64, staff: 0, onsetQuarter: 0, durationQuarters: 1 }, // RH
        { midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 8 }, // LH
      ],
    };
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click(); // My part = None → plays immediately
    await act(async () => {});
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument(); // playing

    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'RH' })); });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument(); // resumed itself
    expect(document.querySelector('.piano-score-countin')).toBeNull(); // and did NOT count the user in
  });

  it('resumes where it left off once a view-change re-engrave lands (M3)', async () => {
    // Zoom/flow/transpose must pause (the sheet repaints while the audio would
    // keep playing the stale engraving) — but all five field pauses were followed
    // by a hand-flown Play 9–29s later, always landing somewhere else.
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
      notes: [{ midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 8 }],
    };
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(1100)); // one step in
    expect(screen.getByTestId('score-position')).toHaveTextContent('2 / 4');

    // Flow change → pause. The stub keeps reporting flow 'wrapped', so the layout
    // is stale (mid re-engrave) and the resume must WAIT.
    fireEvent.click(screen.getByRole('button', { name: /view options/i }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^across$/i })); });
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull(); // paused for the re-engrave

    // Layout catches up → the run picks up where it was, unaided.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /down the page/i })); });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByTestId('score-position')).toHaveTextContent('2 / 4'); // not back at the top
  });

  // ── Task 18: the resume must wait for the TRANSPOSED engrave ────────────────
  // The gate read flow + scale only, but a transpose forces a full re-engrave too
  // (it is part of the renderer's cache key). So a transpose resumed on the very
  // next commit, and the transport performed the OLD key until the new geometry
  // landed ~1–2s later — the sheet-new/audio-old divergence of audit H2.
  it('holds the resume until the re-engraved KEY lands (audit H2)', async () => {
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
      notes: [{ midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 8 }],
    };
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click(); // My part = None → plays immediately
    await act(async () => {});
    act(() => vi.advanceTimersByTime(1100)); // one step in
    expect(screen.getByTestId('score-position')).toHaveTextContent('2 / 4');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();

    // The re-engrave is in flight: the stub holds its publish, so the reported
    // layout still belongs to the WRITTEN key.
    h.holdLayout = true;
    fireEvent.click(screen.getByRole('button', { name: 'Key' })); // open the Key sheet
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '+1' })); }); // tap +1 semitone
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull(); // still paused — the old key must not play on

    // New key engraved → the run picks itself back up, in the key on the page.
    await act(async () => { h.releaseLayout(); });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByTestId('score-position')).toHaveTextContent('2 / 4'); // where it left off
  });

  it('an explicit Restart supersedes a pending rebuild-resume (no uncommanded audio)', async () => {
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
      notes: [{ midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 8 }],
    };
    renderPlayer();
    screen.getByText('Listen').click();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(1100)); // one step in, so Restart is enabled
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();

    // Flow change → pause + a pending resume. The stub keeps reporting flow
    // 'wrapped', so the layout stays stale and the resume is held pending.
    fireEvent.click(screen.getByRole('button', { name: /view options/i }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^across$/i })); });
    // The user takes explicit control while the re-engrave is still in flight.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /restart/i })); });
    h.sendNoteAt.mockClear();
    // Layout catches up (flow back to what the stub reports) → layoutFresh again.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /down the page/i })); });
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument(); // still stopped
    expect(h.sendNoteAt).not.toHaveBeenCalled();                              // and silent
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
    // A tap 800px right of the last note (margin) must NOT arm an in-point — and
    // must SAY so rather than look like a dead screen (audit H4a).
    act(() => { fireEvent.click(scroll, { clientX: 960, clientY: 100 }); });
    expect(screen.getByText(/closer to a note/i)).toBeInTheDocument(); // still stage 'first'
    // A tap on a real note proceeds normally.
    act(() => { fireEvent.click(scroll, { clientX: 100, clientY: 100 }); });
    expect(screen.getByText(/now tap the last/i)).toBeInTheDocument();
  });
});

describe('ScorePlayer — loop arming expires (H4b)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
    vi.setSystemTime(0);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('drops a forgotten arm after the idle window, so a later tap seeks instead of looping', () => {
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
    expect(screen.getByText(/tap the first measure/i)).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(15001); }); // the user wandered off
    expect(screen.queryByText(/tap the first measure/i)).toBeNull(); // banner gone — arming expired

    // A tap now SEEKS (the whole point: arming was gating tap-to-seek).
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
    expect(screen.getByText('m 2 / 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^loop$/i })).toBeInTheDocument(); // and set no loop
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

// ── Task 11: honest Learn pacing telemetry ────────────────────────────────────
// Learn is self-paced, so what the follow telemetry can honestly report is how
// long the player took to answer the cursor — measured from a reference point
// that exists. Previously `lastAdvanceRef` started at 0, so the first hit after
// entering Learn computed an interval of 0 → maximum negative drift → a
// fabricated `feel: "rush"` (audit M5a).
describe('ScorePlayer — Learn pacing telemetry (Task 11)', () => {
  // Capture both levels the follow events use: timing is `sampled`, stats `info`.
  const captureFollow = () => {
    const root = getLogger();
    const origChild = root.child.bind(root);
    const emitted = []; // [event, data]
    vi.spyOn(root, 'child').mockImplementation((ctx) => {
      const c = origChild(ctx);
      for (const lvl of ['info', 'sampled']) {
        const orig = c[lvl].bind(c);
        c[lvl] = (ev, data, opts) => { emitted.push([ev, data]); return orig(ev, data, opts); };
      }
      return c;
    });
    return emitted;
  };
  const pick = (emitted, name) => emitted.filter(([ev]) => ev === name).map(([, d]) => d);
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('measures the first Learn hit from mode entry, not from zero', () => {
    let t = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const emitted = captureFollow();
    renderPlayer();
    enterLearn(); // stamps the reference point at t=1000
    t = 1750;
    play(64); // first note of step 0 (needs 64 + 52 + 40, so the cursor stays put)

    const timing = pick(emitted, 'score.follow.timing');
    expect(timing.length).toBe(1);
    expect(timing[0]).toMatchObject({ step: 0, note: 64, sinceAdvanceMs: 750 });
    // No verdict is passed on a self-paced hit.
    expect(timing[0]).not.toHaveProperty('feel');
    expect(timing[0]).not.toHaveProperty('driftMs');
  });

  it('reports the run\'s own step intervals on leaving Learn — no rush/drag verdict', () => {
    let t = 1000; // a real performance.now() is never 0 — see the falsy guard in onFollowHit
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const emitted = captureFollow();
    renderPlayer();
    enterLearn();
    // Complete step 0 (E4 + LH E3/E2) at +300ms, then answer step 1 at +900ms.
    t = 1300; play(64); play(52); play(40);
    t = 2200; play(62);
    act(() => { screen.getByText('Listen').click(); }); // leaving Learn flushes

    const stats = pick(emitted, 'score.follow.stats');
    expect(stats.length).toBe(1);
    expect(stats[0]).toMatchObject({ hits: 4, count: 4, medianStepMs: 300, p95StepMs: 900 });
    expect(stats[0]).not.toHaveProperty('rushPct');
    expect(stats[0]).not.toHaveProperty('meanAbsDriftMs');
  });
});

// ── Task 14: entering Learn lands somewhere the user can explain ──────────────
// onMode did not reset the cursor, so Listen→Learn dropped the user wherever the
// Listen playhead happened to stop — one field session entered Learn at step 32,
// mid-piece, with no way to know why the cursor was there (audit H3.3).
describe('ScorePlayer — entering Learn (audit H3.3)', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('returns the cursor to the top when Learn is entered mid-piece', () => {
    renderPlayer(); // opens in Listen
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 280, clientY: 100 }); }); // seek to the last note
    expect(screen.getByTestId('score-position')).toHaveTextContent('4 / 4');
    enterLearn();
    expect(screen.getByTestId('score-position')).toHaveTextContent('1 / 4'); // from the top, not step 4
  });

  it('enters at the loop in-point when a practice loop is active', () => {
    // One measure per step, so the measure readout can tell the loop's in-point
    // apart from a cursor parked deeper inside the loop.
    h.layoutExtras = {
      steps: h.events.map((e, i) => ({
        onsetQuarter: e.onsetQuarter,
        measure: i,
        notes: [{ midi: e.midi, staff: 0, x: e.x, top: e.top, bottom: e.bottom, width: 8 }],
      })),
      measures: h.events.map((e, i) => ({ index: i, number: i + 1, firstStep: i, lastStep: i })),
    };
    renderPlayer(); // Listen
    // Loop measures 2–3 (steps 1–2) via the guided two-tap selection.
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^loop/i })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /select measures/i })); });
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); }); // m2
    act(() => { fireEvent.click(scroll, { clientX: 220, clientY: 100 }); }); // m3
    expect(screen.getByTestId('score-position')).toHaveTextContent('m 2 / 4'); // at the in-point
    act(() => { fireEvent.click(scroll, { clientX: 280, clientY: 100 }); }); // seek deeper (clamped to m3)
    expect(screen.getByTestId('score-position')).toHaveTextContent('m 3 / 4');
    enterLearn();
    expect(screen.getByTestId('score-position')).toHaveTextContent('m 2 / 4'); // back to the in-point
  });
});

// ── Task 13: offer the hands split when Learn stalls on a step ────────────────
// Learn advances only once EVERY active-staff note of the step is struck, so a
// two-note step reads as "I played it and nothing happened". The escape hatch —
// narrowing to one hand — lives in the transport bar and fired ZERO times in
// three days of field logs (audit H3). Bring the offer to the score instead.
describe('ScorePlayer — Learn stuck prompt (audit H3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
    vi.setSystemTime(0);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  const stuck = () => document.querySelector('.piano-score-stuck');

  it('offers one hand after dwelling on a both-hands step, and narrows to it on pick', async () => {
    renderPlayer(); // opens in Listen
    await act(async () => {});
    enterLearn();
    // Step 0 is E4 (staff 0) + E3/E2 (staff 1) — a step the all-notes rule holds
    // hostage until both hands arrive.
    expect(stuck()).toBeNull();          // not offered immediately — dwelling is the signal
    act(() => vi.advanceTimersByTime(5100));
    expect(stuck()).not.toBeNull();

    act(() => { fireEvent.click(screen.getByRole('button', { name: /right hand/i })); });
    expect(stuck()).toBeNull();          // taken up → the offer goes away

    // …and Learn now advances on the RH note alone: staff 1 is no longer active.
    expect(screen.getByTestId('score-position')).toHaveTextContent('1 / 4');
    play(64);
    expect(screen.getByTestId('score-position')).toHaveTextContent('2 / 4');
  });

  it('does not offer on a single-staff step — a split would not help', async () => {
    renderPlayer();
    await act(async () => {});
    enterLearn();
    play(64); play(52); play(40); // satisfy step 0 → step 1 is D4 alone (staff 0)
    expect(screen.getByTestId('score-position')).toHaveTextContent('2 / 4');
    act(() => vi.advanceTimersByTime(5100));
    expect(stuck()).toBeNull();
  });

  it('stays gone for the rest of the session once dismissed', async () => {
    renderPlayer();
    await act(async () => {});
    enterLearn();
    act(() => vi.advanceTimersByTime(5100));
    act(() => { fireEvent.click(screen.getByRole('button', { name: /keep both/i })); });
    expect(stuck()).toBeNull();
    act(() => vi.advanceTimersByTime(20000));
    expect(stuck()).toBeNull(); // asked and answered — no nagging
  });
});
