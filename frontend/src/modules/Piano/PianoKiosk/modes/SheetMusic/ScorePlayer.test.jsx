import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within } from '@testing-library/react';
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
  // Latest crumbs ScorePlayer published via usePianoBreadcrumb (wave-2 B: mode
  // switching moved to the header crumb → ModeSheet). This harness doesn't mount
  // PianoChrome, so there's no DOM crumb to click — pickMode() below invokes the
  // captured crumb's onClick directly instead.
  crumbs: [],
  // usePracticeRecord (Task 12) reaches usePianoUser, and this harness never
  // wraps ScorePlayer in a PianoUserProvider — mocking the module (Task 13) is
  // what keeps every OTHER test in this file from throwing on render, not just
  // the ones that care about the practice record.
  recordCycle: vi.fn(),
  recordTierBest: vi.fn(),
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
vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumb: (crumbs) => { h.crumbs = crumbs || []; } }));
vi.mock('../../useReloadGuard.js', () => ({ default: () => {} }));
// Spyable click scheduler: useMetronomeClick creates one per enable, so hand it
// the shared holder object and assert on start/stop/setBpm.
vi.mock('./clickScheduler.js', () => ({ createClickScheduler: () => h.clickSched }));
// Observe recordCycle calls without touching usePianoUser/DaylightAPI — see the
// rationale on h.recordCycle above.
vi.mock('./usePracticeRecord.js', () => ({
  default: () => ({ record: {}, loaded: true, recordCycle: h.recordCycle, recordTierBest: h.recordTierBest }),
}));

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
            staffBoxes: [
              { system: 0, staff: 0, top: 10, left: 40, right: 300, lineSpacing: 10 },
              { system: 0, staff: 1, top: 120, left: 40, right: 300, lineSpacing: 10 },
            ],
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
  h.recordCycle.mockClear();
  h.recordTierBest.mockClear();
});

// Mode switching now lives in the header crumb → ModeSheet (wave-2 B), not a
// bar tab strip. This harness stubs usePianoBreadcrumb (no PianoChrome mounted
// to click the crumb through in the DOM), so the crumb is captured in h.crumbs
// instead; pickMode invokes its onClick directly — the exact handler a real
// crumb tap would fire, opening the ModeSheet ScorePlayer mounts itself — then
// clicks the target mode's row in the now-open dialog, same as the old tab click.
const pickMode = (label) => {
  act(() => { h.crumbs[h.crumbs.length - 1]?.onClick?.(); });
  act(() => { screen.getByText(label).click(); });
};

// Task 14's Learn landing auto-picks a range (and arms the loop) the instant
// Learn opens on a fixture whose layout reports `measures` — the frontier/
// section/density/fallback heuristic always resolves to SOME range, never
// null. The many pre-14 tests below assume a BLANK Learn entry (no range) so
// they can arm their own via the guided two-tap flow or exercise the
// no-range machine-playback row directly; clear the auto-pick immediately
// after entering so their original, fixture-independent assumptions hold.
// A no-op when no range was picked (e.g. layout.measures is empty/absent).
const clearAutoRange = () => {
  const btn = screen.queryByRole('button', { name: 'Clear loop' });
  if (btn) act(() => { fireEvent.click(btn); });
};

// Scores now open in Listen (default). The Learn tests select Learn first.
const enterLearn = () => { pickMode('Learn'); clearAutoRange(); };

// Learn's GATE (wave-3 §B): the follow tracker only drives the cursor when a
// practice range is armed AND looping is on — Learn WITHOUT a range is machine
// playback on the transport instead. Every test about the all-notes rule, the
// wrong-note flash or follow telemetry therefore has to arm a range first: enter
// Learn, start the guided selection, and tap the note at `clientX` twice (a
// one-measure range; a freshly-picked range always arms the loop). Fixtures with
// no `measures` in their layout resolve to a null step span, so the tracker
// advances linearly through the whole piece — exactly as it did before wave-3.
const enterLearnGate = (clientX = 100) => {
  enterLearn();
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); });
  const scroll = document.querySelector('.piano-score-player__scroll');
  act(() => { fireEvent.click(scroll, { clientX, clientY: 100 }); });
  act(() => { fireEvent.click(scroll, { clientX, clientY: 100 }); });
};

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
      // Toggle a hand → fires score.hands, an intent event (wave-3 A: one hands
      // model, every mode — the old Listen-only score.listen.mypart is retired).
      act(() => { fireEvent.click(screen.getByRole('button', { name: 'Right hand' })); });
      const emitter = children.find((r) => r.events.includes('score.hands'));
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
    pickMode('Learn'); // mode change → tapIntent('mode')
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
    // Mode now surfaces via the header crumb (wave-2 B), not a bar tab strip.
    // The crumb shows exactly the current mode, so asserting its label is
    // Listen carries the same information as the old "Listen selected AND
    // Learn not selected" pair (only one mode can be current at a time).
    expect(h.crumbs[h.crumbs.length - 1]).toMatchObject({ label: 'Listen', icon: 'mode-listen' });
  });
});

describe('ScorePlayer — note-highlight ink (wave-2 A)', () => {
  it('lit noteheads use the fixed near-black ink, not the mode accent', async () => {
    const rhEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    h.layoutExtras = {
      notes: [{ midi: 64, staff: 0, onsetQuarter: 0, durationQuarters: 1 }],
      steps: [{ onsetQuarter: 0, notes: [{ midi: 64, staff: 0, el: rhEl }] }],
    };
    renderPlayer(); // opens in Listen
    await act(async () => {});
    // The engraved fake note carries an `el` (see the harness); the highlight
    // layer stamps classes + --nh-color directly onto that element (not into
    // the rendered DOM tree — the real OSMD notehead lives inside the SVG the
    // stub renderer doesn't reproduce), so assert against `rhEl` itself.
    expect(rhEl.classList.contains('piano-note-lit')).toBe(true);
    expect(rhEl.style.getPropertyValue('--nh-color')).toBe('#23262b');
  });

  it('a struck note keeps the lit class split (+ near-black --nh-color) that lets CSS give HIT its own green — a merely-lit sibling is untouched', async () => {
    const hitEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const litOnlyEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    h.layoutExtras = {
      notes: [
        { midi: 64, staff: 0, onsetQuarter: 0, durationQuarters: 1 },
        { midi: 60, staff: 0, onsetQuarter: 0, durationQuarters: 1 },
      ],
      steps: [{ onsetQuarter: 0, notes: [{ midi: 64, staff: 0, el: hitEl }, { midi: 60, staff: 0, el: litOnlyEl }] }],
    };
    renderPlayer();
    // Listen no longer registers MIDI input at all (wave-3 A), and Learn only
    // tracks input inside its GATE (wave-3 §B) — arm a range so the follow
    // tracker is what populates `struck`.
    enterLearnGate();
    await act(async () => {});
    play(64); // matches the step's expected midi → Learn's follow tracker lights it green (struck)
    await act(async () => {});
    // jsdom can't compute the stylesheet's cascade (HIT's fixed #2ec46f overriding
    // LIT's --nh-color), so this locks in the JS-level contract the CSS fix relies
    // on: NoteHighlightLayer still stamps the SAME near-black --nh-color on every
    // lit note (struck or not) — the class split (lit vs. lit+hit) is what the
    // stylesheet keys off to give HIT its own colour. See the PianoApp.scss source
    // assertion below for the actual colour override.
    expect(hitEl.classList.contains('piano-note-lit')).toBe(true);
    expect(hitEl.classList.contains('piano-note-hit')).toBe(true);
    expect(hitEl.style.getPropertyValue('--nh-color')).toBe('#23262b');
    expect(litOnlyEl.classList.contains('piano-note-lit')).toBe(true);
    expect(litOnlyEl.classList.contains('piano-note-hit')).toBe(false);
    expect(litOnlyEl.style.getPropertyValue('--nh-color')).toBe('#23262b');
  });

  it('PianoApp.scss gives .piano-note-hit its own fixed green, never the shared --nh-color ink (wave-2 A)', () => {
    // jsdom doesn't compute styles from the stylesheet, so assert the source
    // directly (same pattern as TransportButton.test.jsx's SCSS floor check).
    const scss = readFileSync(fileURLToPath(new URL('../../../../../Apps/PianoApp.scss', import.meta.url)), 'utf8');
    // .piano-note-hit nests one level (its `path, rect, ...` sub-rule), so match
    // through that inner brace pair too, not just up to the first `}`.
    const hitBlock = scss.match(/\.piano-note-hit\s*\{(?:[^{}]|\{[^{}]*\})*\}/s)?.[0];
    expect(hitBlock).toBeTruthy();
    expect(hitBlock).toContain('#2ec46f'); // struck-correctly stays affirming green
    expect(hitBlock).not.toMatch(/var\(--nh-color/); // never inherits the near-black lit ink
  });
});

describe('ScorePlayer — keyboard visibility policy (M2)', () => {
  it('Listen keeps the keyboard hidden regardless of hand selection; the View toggle still overrides', async () => {
    renderPlayer(); // opens in Listen
    await act(async () => {});
    expect(document.querySelector('.piano-score-player__keys')).toBeNull(); // hidden by default
    // Deselecting a hand no longer auto-shows the keyboard (wave-3 A: the kiosk
    // performs — nothing is "yours" to play along with).
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Right hand' })); });
    expect(document.querySelector('.piano-score-player__keys')).toBeNull(); // still hidden
    // The View-sheet toggle is the escape hatch.
    fireEvent.click(screen.getByRole('button', { name: /view options/i }));
    act(() => { fireEvent.click(screen.getByRole('switch', { name: 'Keyboard' })); });
    expect(document.querySelector('.piano-score-player__keys')).not.toBeNull(); // shown via explicit override
    pickMode('Learn'); // Learn auto-shows the keyboard
    expect(document.querySelector('.piano-score-player__keys')).not.toBeNull();
  });
});

describe('ScorePlayer — per-score persistence (Task 2.5)', () => {
  beforeEach(() => { try { window.localStorage.clear(); } catch { /* no storage */ } });
  const score = { id: 'files:persist.musicxml', title: 'P', musicXml: '<score/>' };
  const renderScore = () => render(<MemoryRouter><ScorePlayer score={score} /></MemoryRouter>);

  it('restores the last-used mode for a given score id', () => {
    const { unmount } = renderScore();
    pickMode('Learn'); // change away from the default (Listen)
    unmount();
    renderScore();
    // Mode now surfaces via the header crumb (wave-2 B), not a bar tab strip.
    expect(h.crumbs[h.crumbs.length - 1]).toMatchObject({ label: 'Learn', icon: 'mode-learn' });
  });

  it('restores the metronome arm state for a given score id (M3)', () => {
    const { unmount } = renderScore();
    pickMode('Polish');
    const click = screen.getByRole('button', { name: /metronome/i });
    expect(click).toHaveAttribute('aria-pressed', 'true'); // default ON
    act(() => { fireEvent.click(click); }); // turn it off
    unmount();
    renderScore();
    pickMode('Polish');
    expect(screen.getByRole('button', { name: /metronome/i })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('ScorePlayer — Learn mode (full-hand, simulated MIDI input)', () => {

  it('advances only when every active-staff note of the step is struck', () => {
    renderPlayer();
    enterLearnGate(); // the all-notes rule lives in Learn's gate (wave-3 §B)

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
    enterLearnGate();
    for (const n of [64, 52, 40, 62, 60, 62, 64, 64, 64]) play(n);
    expect(screen.getByText('4 / 4')).toBeTruthy();
  });

  it('shows the Learn completion card once the final step is satisfied (M5)', () => {
    renderPlayer();
    enterLearnGate();
    expect(document.querySelector('.piano-score-learn-complete')).toBeNull();
    for (const n of [64, 52, 40, 62, 60, 62]) play(n); // satisfy all four onsets incl. the last
    expect(document.querySelector('.piano-score-learn-complete')).not.toBeNull();
  });
});

// Wave-3 §0 REVERSES wave-2's J3/L6 semantics: the range no longer follows the
// ladder. Loop/focus is Learn-only state — Listen is a jukebox and Polish grades
// whole-piece runs, so entering either releases the range (and the loop toggle).
describe('ScorePlayer — the practice range is Learn-only state (wave-3 §0)', () => {
  it('drops the focus range on the way out of Learn, in every direction', () => {
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
    // Guided selection: Loop → Select measures… → two taps set a custom range.
    // (Selection taps must land near a note — the L3 threshold — so tap ON one.)
    enterLearnGate();
    // The Loop trigger's aria-label stays the stable 'Loop' (Key/Tempo convention);
    // the measure-span scope shows in the visible label instead.
    const trigger = () => screen.getByRole('button', { name: 'Loop' });
    expect(trigger()).toHaveTextContent(/m1/i);
    // Polish grades whole-piece runs — it releases the range…
    pickMode('Polish');
    expect(trigger().textContent).toBe('');
    // …and re-entering Learn does not resurrect it.
    enterLearnGate();
    expect(trigger()).toHaveTextContent(/m1/i);
    // Listen is a jukebox — it releases it too.
    pickMode('Listen');
    expect(trigger().textContent).toBe('');
    // Perform still releases it (unchanged).
    enterLearnGate();
    pickMode('Perform');
    pickMode('Listen');
    // Inactive trigger is icon-only (wave-2: no range → no visible label) — aria-label stays 'Loop'.
    expect(trigger().textContent).toBe('');
  });
});

// Learn cycle instrumentation (wave-3 C, Task 13): a completed, non-voided gate
// loop (in→out→wrap) feeds usePracticeRecord.recordCycle — attempts for every
// measure the range spans, a pass wherever no wrong note landed in that measure
// during the pass. Two measures, one step (single note) each, so ONE full pass
// is exactly two note-plays: the first satisfies+advances step 0→1 (no wrap —
// the tracker only wraps FROM the range's out-point), the second satisfies step
// 1 and wraps 1→0, which is where recordCycle fires.
//
// Fix round 1: arming a FRESH range must NOT void — there is no prior cycle for
// a fresh arm to have disrupted, so the pass immediately after selectFullRange()
// is now an honest first cycle and counts. Only a range CHANGE against an
// ALREADY-active range (nudge, reselect, tap-seek, hand/part toggle, transpose,
// clear) voids.
describe('ScorePlayer — Learn cycle instrumentation feeds the practice record (Task 13)', () => {
  const TWO_MEASURE_LEARN = {
    steps: [
      { onsetQuarter: 0, measure: 0, notes: [{ midi: 64, staff: 0, x: 100, top: 10, bottom: 200, width: 8 }] },
      { onsetQuarter: 1, measure: 1, notes: [{ midi: 62, staff: 0, x: 160, top: 10, bottom: 200, width: 8 }] },
    ],
    measures: [
      { index: 0, number: 1, firstStep: 0, lastStep: 0 },
      { index: 1, number: 2, firstStep: 1, lastStep: 1 },
    ],
  };
  // Same shape as TWO_MEASURE_LEARN but with a SECOND staff on every step, so
  // parts.length === 2 (grandStaff) and the Hands (Right/Left hand) control
  // renders — needed for the hand-toggle voider test below.
  const GRAND_TWO_MEASURE_LEARN = {
    steps: [
      { onsetQuarter: 0, measure: 0, notes: [{ midi: 64, staff: 0, x: 100, top: 10, bottom: 200, width: 8 }, { midi: 40, staff: 1, x: 100, top: 10, bottom: 200, width: 8 }] },
      { onsetQuarter: 1, measure: 1, notes: [{ midi: 62, staff: 0, x: 160, top: 10, bottom: 200, width: 8 }, { midi: 38, staff: 1, x: 160, top: 10, bottom: 200, width: 8 }] },
    ],
    measures: [
      { index: 0, number: 1, firstStep: 0, lastStep: 0 },
      { index: 1, number: 2, firstStep: 1, lastStep: 1 },
    ],
  };
  // Two-tap select spanning BOTH measures: tap the note at x=100 (measure 1)
  // then x=160 (measure 2) — matches h.events' default x positions, so
  // nearestEvent/measureIndexOfStep resolve to indices 0 and 1.
  const selectFullRange = () => {
    enterLearn();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); });
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 100, clientY: 100 }); });
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
  };
  const playFullPass = () => { play(64); play(62); }; // 0→1, then 1→wraps to 0

  it('a fresh range arm starts an honest first cycle — the very first pass counts, no throwaway needed', () => {
    h.layoutExtras = TWO_MEASURE_LEARN;
    renderPlayer();
    selectFullRange();
    expect(h.recordCycle).not.toHaveBeenCalled(); // arming alone doesn't bank anything
    play(63); // a plausible wrong note against step 0's expected 64 (within 2 octaves)
    play(64); // the correct note — advances 0→1 (not the out-point yet, no wrap)
    expect(h.recordCycle).not.toHaveBeenCalled();
    play(62); // completes step 1 (the out-point) — wraps 1→0, the FIRST pass is banked
    expect(h.recordCycle).toHaveBeenCalledTimes(1);
    expect(h.recordCycle).toHaveBeenCalledWith({
      measureIndices: [0, 1],
      wrongMeasures: new Set([0]), // the wrong note landed while the cursor sat on measure 0
      bucket: 'both', // single staff in this fixture → not a grand staff
    });
  });

  it('a tap-seek mid-cycle voids it (no recordCycle on the next wrap) — the following clean pass still counts', () => {
    h.layoutExtras = TWO_MEASURE_LEARN;
    renderPlayer();
    selectFullRange();
    // Tap-seek (not the guided selection — `selecting` is null after the two-tap
    // commit above) breaks the in-progress cycle, even though it's the FIRST one.
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 100, clientY: 100 }); });
    playFullPass(); // wraps — but voided by the tap-seek above
    expect(h.recordCycle).not.toHaveBeenCalled();
    playFullPass(); // a second, UNINTERRUPTED pass — this one counts
    expect(h.recordCycle).toHaveBeenCalledTimes(1);
    expect(h.recordCycle).toHaveBeenCalledWith({
      measureIndices: [0, 1],
      wrongMeasures: new Set(),
      bucket: 'both',
    });
  });

  it('nudging a loop endpoint mid-cycle still voids the next wrap — the following clean pass still counts', () => {
    h.layoutExtras = TWO_MEASURE_LEARN;
    renderPlayer();
    enterLearn();
    // Arm a ONE-measure loop at m1 (fresh arm — no void; nothing played yet).
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); });
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 100, clientY: 100 }); });
    act(() => { fireEvent.click(scroll, { clientX: 100, clientY: 100 }); });
    expect(screen.getByRole('button', { name: 'Loop' })).toHaveTextContent(/m1–m1/i);
    // Nudge the end later — grows to m1–m2. A range was ALREADY active (the
    // fresh arm above), so this is a genuine mid-cycle disruption and must void,
    // even though no note has been played since arming.
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop options' })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /loop end later/i })); });
    expect(screen.getByRole('button', { name: 'Loop' })).toHaveTextContent(/m1–m2/i);
    playFullPass(); // wraps m1→m2→m1 — but voided by the nudge above
    expect(h.recordCycle).not.toHaveBeenCalled();
    playFullPass(); // a second, uninterrupted pass — this one counts
    expect(h.recordCycle).toHaveBeenCalledTimes(1);
    expect(h.recordCycle).toHaveBeenCalledWith({
      measureIndices: [0, 1],
      wrongMeasures: new Set(),
      bucket: 'both',
    });
  });

  it('a transpose (key) change mid-cycle voids the next wrap', () => {
    h.layoutExtras = TWO_MEASURE_LEARN;
    renderPlayer();
    selectFullRange();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Key' })); }); // open the Key sheet
    act(() => { fireEvent.click(screen.getByRole('button', { name: /\+1/ })); }); // tap +1 semitone → voids
    playFullPass(); // wraps — but voided by the transpose above
    expect(h.recordCycle).not.toHaveBeenCalled();
    playFullPass(); // a second, uninterrupted pass — this one counts
    expect(h.recordCycle).toHaveBeenCalledTimes(1);
  });

  it('a hand-toggle change mid-cycle voids the next wrap', () => {
    h.layoutExtras = GRAND_TWO_MEASURE_LEARN;
    renderPlayer();
    selectFullRange();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Left hand' })); }); // drop LH → voids
    // The LH note (40/38) is now inactive — only the RH note is expected per step.
    playFullPass(); // wraps — but voided by the hand toggle above
    expect(h.recordCycle).not.toHaveBeenCalled();
    playFullPass(); // a second, uninterrupted pass — this one counts
    expect(h.recordCycle).toHaveBeenCalledTimes(1);
  });

  it('renders and completes a cycle without a PianoUserProvider — the practice hook is fully mocked out, so nothing crashes for a guest-shaped render', () => {
    h.layoutExtras = TWO_MEASURE_LEARN;
    expect(() => {
      renderPlayer();
      selectFullRange();
      playFullPass();
    }).not.toThrow();
    expect(h.recordCycle).toHaveBeenCalledTimes(1);
  });
});

describe('ScorePlayer — Learn mode chord tolerance (audit B2)', () => {
  it('does not flash wrong for accompaniment notes that belong to the current onset', () => {
    renderPlayer();
    enterLearnGate();
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
    pickMode('Perform');
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
    pickMode('Polish');
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
    pickMode('Polish');
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
    pickMode('Polish');
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
    pickMode('Polish');
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

  // Wave-3 §0 retires Polish looping: Polish grades WHOLE-PIECE runs, which is what
  // makes tier bests comparable. A range picked here is inert — the run is never
  // pinned to it and finishes normally (the wrap machinery is Learn's, and Learn's
  // gate has no transport at all).
  it('a range on the final measure does NOT pin a Polish run — it finishes and finalizes', async () => {
    h.layoutExtras = TAIL_MEASURE;
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); }); // no range yet -> direct tap starts selection
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // through the 4-beat @60 count-in
    act(() => vi.advanceTimersByTime(3500)); // well past where a loop would have wrapped
    expect(document.querySelector('.piano-score-run-summary')).not.toBeNull(); // finalized, not looping
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();  // the run is over
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
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); }); // no range yet -> direct tap starts selection
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX, clientY: 100 }); });
    act(() => { fireEvent.click(scroll, { clientX, clientY: 100 }); });
  };
  const loopSecondMeasure = () => loopMeasureAtX(160); // THREE_MEASURES: a MIDDLE measure

  it('a range in Polish gates nothing: the cursor runs past the out-point and the measure still grades', async () => {
    // The wave-2 shape of this test asserted a WRAP onto the same measure. Polish
    // no longer loops (wave-3 §0), so what has to hold is the other half: the
    // advance-driven grader still banks the measure the user played, and the run
    // carries on past the (inert) out-point instead of being pinned to it.
    h.layoutExtras = THREE_MEASURES;
    const emitted = captureLog();

    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    loopMeasureAtX(100); // a one-measure range on m1 (index 0)
    expect(screen.getByText('m 1 / 3')).toBeTruthy(); // the range still parks the cursor at its in-point
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // through the 4-beat @60 count-in
    act(() => { h.noteCb?.({ type: 'note_on', note: 64, velocity: 80 }); }); // play the measure
    act(() => vi.advanceTimersByTime(1100)); // one quarter @60 → cursor passes the old out-point

    const grades = emitted.filter(([ev]) => ev === 'score.polish.measure');
    expect(grades.length).toBeGreaterThanOrEqual(1);
    expect(grades[0][1]).toMatchObject({ measure: 0, grade: 'green' });
    expect(screen.getByText('m 2 / 3')).toBeTruthy(); // ran on into m2 — no wrap back to m1
  });

  it('a Polish run that starts inside a range still grades the measure it played, exactly once', async () => {
    // The wave-2 version of this drove SIX passes over a tail-measure loop and
    // demanded a grade per pass. Polish has no passes now (wave-3 §0) — so what
    // must survive is that the single pass is scored from the note actually
    // played (not a silent red wash) and banked once, not once per phantom wrap.
    h.layoutExtras = THREE_MEASURES;
    const emitted = captureLog();

    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    loopSecondMeasure(); // a one-measure range on m2 (index 1)
    expect(screen.getByText('m 2 / 3')).toBeTruthy();
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // through the 4-beat @60 count-in
    act(() => { h.noteCb?.({ type: 'note_on', note: 62, velocity: 80 }); }); // the pass
    act(() => vi.advanceTimersByTime(2200)); // play it out → onDone finalizes

    const grades = emitted.filter(([ev]) => ev === 'score.polish.measure');
    const played = grades.filter(([, d]) => d.measure === 1);
    expect(played.length).toBe(1);          // banked ONCE — no phantom re-passes
    expect(played[0][1].noteScore).toBe(1); // scored from the real note
    expect(played[0][1].grade).toBe('green'); // played on the beat → green
    expect(document.querySelector('.piano-score-run-summary')).not.toBeNull(); // …and the run ended
  });

  it('the evaluator is off once a run is over — a later cursor move grades nothing (Task 19)', async () => {
    // Guards the phantom-grade class of bug: the run-active signal that survives
    // the loop dwell must NOT survive a genuine end-of-run, or the evaluator would
    // grade measures the cursor merely passes over while nothing is playing.
    h.layoutExtras = THREE_MEASURES;
    const emitted = captureLog();

    renderPlayer();
    pickMode('Polish');
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

  it('a range armed in Listen neither loops nor survives the hop to Polish — no phantom grade', async () => {
    // Wave-2: the loop followed Listen↔Polish (L6) and Listen's wraps bumped the
    // same counter the evaluator uses as an end-of-measure boundary — a stale
    // counter painted a red wash before a single note. Wave-3 §0 removes the whole
    // premise: Listen never wraps, and the range is released on the way into
    // Polish. Both halves are asserted here — the range is gone, and the Polish
    // run that follows banks nothing it did not hear.
    h.layoutExtras = THREE_MEASURES;
    const emitted = captureLog();

    renderPlayer(); // opens in Listen
    await act(async () => {});
    loopSecondMeasure();
    screen.getByRole('button', { name: 'Play' }).click(); // Listen always plays immediately (no count-in — wave-3 A)
    await act(async () => {});
    act(() => vi.advanceTimersByTime(3000)); // where wave-2 would have wrapped several times
    expect(emitted.filter(([ev]) => ev === 'score.transport.loop-wrap')).toEqual([]); // Listen does not loop
    // Now drill in Polish — which arrives with no range at all.
    pickMode('Polish');
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Loop' }).textContent).toBe('');
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    emitted.length = 0; // only what the Polish run itself emits
    act(() => vi.advanceTimersByTime(4100)); // through the count-in → the transport starts

    expect(emitted.filter(([ev]) => ev === 'score.polish.measure')).toEqual([]);
  });

  // ── wave-2 T7: loop is a direct toggle — flip it off without losing the range ──
  // Re-homed to Learn (wave-3 §0): Learn is the only mode that holds a range, so
  // it is the only place the direct toggle means anything. The toggle also moves
  // between rows of the Learn matrix — gate → machine playback — so the run
  // button goes from locked to live across it.
  it('toggling Loop off in Learn keeps the range visible and the cursor advances past it instead of wrapping', async () => {
    h.layoutExtras = THREE_MEASURES;
    renderPlayer(); // opens in Listen
    pickMode('Learn');
    await act(async () => {});
    clearAutoRange(); // this spec arms its own one-measure loop from a blank entry
    loopSecondMeasure(); // one-measure loop on m2 (index 1) — same setup as the Polish tests above
    expect(screen.getByText('m 2 / 3')).toBeTruthy(); // parked at the loop in-point
    const trigger = screen.getByRole('button', { name: 'Loop' });
    expect(trigger).toHaveTextContent(/m2–m2/i);
    expect(trigger).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Learn advances as you play' })).toBeDisabled(); // the gate
    // With a range active, the SAME trigger tap now flips looping off instead of
    // opening the sheet (audit L2 follow-up) — no re-selection needed.
    act(() => { fireEvent.click(trigger); });
    expect(trigger).toHaveAttribute('aria-pressed', 'false'); // unlit…
    expect(trigger).toHaveTextContent(/m2–m2/i); // …but the range label is still shown, not cleared
    screen.getByRole('button', { name: 'Play' }).click(); // …and the transport is live again
    await act(async () => {});
    // With looping ON the cursor would be held on m2; with looping OFF it must
    // advance PAST the (still-visible) range boundary onto measure 3.
    act(() => vi.advanceTimersByTime(1100)); // one quarter @60 → cursor passes the old out-point
    expect(screen.getByText('m 3 / 3')).toBeTruthy();
  });

  it('pausing a Polish run grades the worked measure and summarizes it (Task 10)', async () => {
    // A paused run is still a run. The field logs show users working a passage
    // and stopping — and getting no grade, no summary, nothing. The tally must
    // INCLUDE the measure finalize() just graded (gradesRef is a render-time
    // snapshot, so a naive same-tick summary would report zero greens).
    h.layoutExtras = THREE_MEASURES;
    const emitted = captureLog();

    renderPlayer();
    pickMode('Polish');
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
    pickMode('Polish');
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
    pickMode('Polish');
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
    pickMode('Polish');
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
    pickMode('Polish');
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

  // ── wave-2 T7 fix: "Drill worst section" sets a brand-new range too — it must
  // re-arm looping even if the user had toggled a PRIOR loop off, or the drilled
  // passage would silently not loop (the whole point of drilling a section).
  it('drilling the worst section re-arms the loop even after a prior loop was toggled off', async () => {
    h.layoutExtras = FIVE_MEASURES;
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    // Arm an (unrelated) loop, then toggle it off — the state the fix must survive.
    loopMeasureAtX(160); // one-measure loop on m2 (index 1)
    const trigger = screen.getByRole('button', { name: 'Loop' });
    expect(trigger).toHaveAttribute('aria-pressed', 'true');
    act(() => { fireEvent.click(trigger); }); // toggle OFF — range stays, looping doesn't
    expect(trigger).toHaveAttribute('aria-pressed', 'false');
    // Play the piece out silently (loop is off, so nothing clamps the run to m2) —
    // five reds, same as the completion-summary test above.
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // count-in
    for (let i = 0; i < 8; i++) act(() => vi.advanceTimersByTime(1100)); // play the piece out
    expect(document.querySelector('.piano-score-run-summary')).not.toBeNull();
    const drillBtn = screen.getByRole('button', { name: /drill worst section/i });
    act(() => { fireEvent.click(drillBtn); });
    // A fresh range from the drill flow must loop, regardless of the earlier toggle.
    expect(screen.getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'true');
  });

  // Task 14: onDrillWorst batches onMode('learn') with setFocus(span) in one
  // handler, so by the time the Learn-landing arm effect commits, `focus` is
  // already the drilled span — not null. This is the real, user-set-range-
  // beforehand case the auto-pick's `|| focus` guard exists for: it must see
  // the drilled range and never fire (no score.learn.auto-range, no clobber).
  it('a range set the same moment Learn is entered (Drill worst) is never overwritten by the auto-pick', async () => {
    h.layoutExtras = FIVE_MEASURES;
    const emitted = captureLog();
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // count-in
    for (let i = 0; i < 8; i++) act(() => vi.advanceTimersByTime(1100)); // play the piece out silently — all five red
    expect(document.querySelector('.piano-score-run-summary')).not.toBeNull();
    act(() => { fireEvent.click(screen.getByRole('button', { name: /drill worst section/i })); });
    // worstSpan over five contiguous reds is the whole piece — the drilled range.
    expect(screen.getByRole('button', { name: 'Loop' })).toHaveTextContent(/m1–m5/i);
    expect(screen.getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'true');
    expect(emitted.filter(([ev]) => ev === 'score.learn.auto-range')).toEqual([]); // the landing never fired
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
    pickMode('Polish');
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
    pickMode('Polish');
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
    pickMode('Listen');
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

  it('does NOT send a DESELECTED staff — roles route audio (H5)', async () => {
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
      notes: [
        { midi: 64, staff: 0, onsetQuarter: 0, durationQuarters: 1 }, // RH
        { midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 4 }, // LH
      ],
    };
    renderPlayer();
    pickMode('Listen');
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Left hand' })); // deselect LH — kiosk must NOT send it
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click(); // Listen always plays immediately (no count-in)
    await act(async () => {});
    act(() => vi.advanceTimersByTime(100));
    expect(h.sendNoteAt).toHaveBeenCalledWith(64, expect.any(Number), expect.any(Number)); // RH still performed
    expect(h.sendNoteAt).not.toHaveBeenCalledWith(40, expect.any(Number), expect.any(Number)); // LH (deselected) NOT performed
  });

  it('Listen never counts the user in, regardless of hand selection (item 2)', async () => {
    h.layoutExtras = { tempoEntries: [{ onsetQuarter: 0, bpm: 60 }] };
    renderPlayer();
    pickMode('Listen');
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    expect(document.querySelector('.piano-score-countin')).toBeNull();
    screen.getByRole('button', { name: 'Pause' }).click();
    await act(async () => {});
    // Deselecting a hand — once the play-along claim, now just a mute — still
    // never triggers a count-in on the next Play (wave-3 A: count-in is
    // Polish-only).
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Right hand' })); });
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    expect(document.querySelector('.piano-score-countin')).toBeNull();
  });

  it('sends scheduled notes with timestamps (audio plane), not pressNote', async () => {
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
      notes: [{ midi: 64, staff: 0, onsetQuarter: 0, durationQuarters: 1 }],
    };
    renderPlayer();
    pickMode('Listen');
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
    pickMode('Listen');
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
    pickMode('Listen');
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
    pickMode('Listen');
    await act(async () => {});
    // 80% speed (0.8×) → each step takes 1250ms.
    fireEvent.click(screen.getByRole('button', { name: /^tempo/i }));
    fireEvent.click(screen.getByRole('button', { name: /^80%/ }));
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(1100)); // < 1250ms → not yet advanced
    expect(screen.getByText('1 / 4')).toBeTruthy();
    act(() => vi.advanceTimersByTime(200)); // > 1250ms total → advanced one step
    expect(screen.getByText('2 / 4')).toBeTruthy();
  });

  it('Listen ignores MIDI input entirely: a struck note does not light, and does not advance (wave-3 A retires J5)', async () => {
    // The retired play-along subscription used to add a matching strike to
    // `struck`, which NoteHighlightLayer turns into the HIT (green) class on top
    // of the current step's plain LIT paint. Assert the HIT class never appears —
    // a `play(64)`/cursor-unchanged pair alone would pass even with the old
    // subscription still wired up (nothing gates on it), so this only proves the
    // retirement through an effect that WOULD differ if the subscription came back.
    const rhEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    h.layoutExtras = {
      notes: [{ midi: 64, staff: 0, onsetQuarter: 0, durationQuarters: 1 }],
      steps: [{ onsetQuarter: 0, notes: [{ midi: 64, staff: 0, el: rhEl }] }],
    };
    renderPlayer();
    pickMode('Listen');
    await act(async () => {});
    expect(rhEl.classList.contains('piano-note-lit')).toBe(true);  // current-step paint, unconditional
    expect(rhEl.classList.contains('piano-note-hit')).toBe(false); // not struck — nothing played it yet
    play(64); // matches the current step's expected midi exactly
    expect(rhEl.classList.contains('piano-note-hit')).toBe(false); // still not struck — Listen has no subscriber
    expect(screen.getByText('1 / 4')).toBeTruthy(); // cursor unchanged — Listen never gates on input
    play(99); // an unmatched note does nothing either (no throw, no advance)
    expect(rhEl.classList.contains('piano-note-hit')).toBe(false);
    expect(screen.getByText('1 / 4')).toBeTruthy();
  });

  it('keeps a hand deselection across a re-engrave (zoom must not wipe it)', async () => {
    h.layoutExtras = { notes: [
      { midi: 64, staff: 0, onsetQuarter: 0, durationQuarters: 1 },
      { midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 4 },
    ] };
    renderPlayer();
    pickMode('Listen');
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Right hand' })); // deselect RH (default is both ON)
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Right hand' })).toHaveAttribute('aria-pressed', 'false');
    // Zoom via the Size stepper → re-engrave (fresh layout.notes identity).
    fireEvent.click(screen.getByRole('button', { name: /view options/i }));
    fireEvent.click(screen.getByRole('button', { name: '125%' }));
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Right hand' })).toHaveAttribute('aria-pressed', 'false'); // preserved
  });

  it('a mid-run view change (transpose) flushes the schedule, then picks the run back up (H2/M3)', async () => {
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
      notes: [{ midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 8 }],
    };
    renderPlayer();
    pickMode('Listen');
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click(); // Listen always plays immediately (no count-in — wave-3 A)
    await act(async () => {});
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument(); // playing
    h.sendPanic.mockClear();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Key' })); }); // open the Key sheet
    // The stub's default parse has written key fifths:0/mode:null (C major), so the
    // +1 cell speaks the sounding key name (C# major) per Task 5 — not a bare offset.
    act(() => { fireEvent.click(screen.getByRole('button', { name: /\+1/ })); }); // tap +1 semitone
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
    pickMode('Listen');
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(100)); // note 40 now sounding
    h.sendPanic.mockClear();
    act(() => { document.querySelector('.piano-score-player__scroll').click(); }); // tap to seek
    expect(h.sendPanic).toHaveBeenCalled(); // flushed, won't drone
  });

  // Wave-3 §0: loop/focus is Learn-only state, so Listen is a straight jukebox —
  // a range picked here (until the loop chrome leaves Listen entirely) neither
  // pins the performance nor wraps it. Wave-2's "plays only the loop" contract is
  // deliberately retired; what must hold now is that the piece plays through.
  it('Listen ignores a range: the performance runs to the end instead of wrapping', async () => {
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
    pickMode('Listen');
    await act(async () => {});
    // Loop measure 2 only (tail measure — exercises the onDone wrap path).
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); }); // no range yet -> direct tap starts selection
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
    expect(screen.getByText('m 2 / 2')).toBeTruthy(); // the range still parks the cursor at its in-point
    screen.getByRole('button', { name: 'Play' }).click(); // Listen always plays immediately (no count-in — wave-3 A)
    await act(async () => {});
    act(() => vi.advanceTimersByTime(1100)); // past the final step @60bpm → the run completes
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument(); // finished, never wrapped
    expect(screen.getByText('m 1 / 2')).toBeTruthy(); // …and the cursor went home, not to an in-point
    // Completion still flushes the audio plane (sendsAudio): the delayed panic
    // (lookahead+60ms) kills any in-flight tail sends so nothing drones.
    act(() => vi.advanceTimersByTime(500));
    expect(h.sendPanic).toHaveBeenCalled();
  });

  it('returns the cursor home when a run completes, so Play replays the piece (audit H2)', async () => {
    // The transport rewinds itself at onDone, but `step` used to stay parked on
    // the final step — so the next Play seeked to the end and produced ~1.6s of
    // the last measure. One field session hit that fourteen times.
    h.layoutExtras = { tempoEntries: [{ onsetQuarter: 0, bpm: 60 }] }; // 1000ms/quarter, onsets at q0..q3
    renderPlayer();
    pickMode('Listen');
    await act(async () => {});
    expect(screen.getByTestId('score-position')).toHaveTextContent('1 / 4');
    screen.getByRole('button', { name: 'Play' }).click(); // Listen always plays immediately (no count-in — wave-3 A)
    await act(async () => {});
    act(() => vi.advanceTimersByTime(5000)); // past the final onset AND its release → onDone
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument(); // the run finished
    expect(screen.getByTestId('score-position')).toHaveTextContent('1 / 4'); // home, not parked at 4 / 4
  });

  it('a tail-measure range in Listen arms no wrap dwell at all — nothing restarts itself (L6, retired)', async () => {
    // Wave-2 shape: a tail-measure Listen loop ended in a ZERO-SPAN dwell (the
    // loop's in-point IS the last playTimeline event), so onDone dwelled one beat
    // before restarting, and a hand toggle mid-dwell had to cancel that pending
    // restart or a stale timer would fire seconds later against a rebuilt
    // timeline. Wave-3 §0 removes the dwell from Listen entirely: Listen holds no
    // range, so the run simply completes. The observable that told a canceled
    // dwell from a fired one is the same one that proves the dwell is gone —
    // onDone's loop branch logs `score.transport.loop-wrap` every time it runs
    // (armed OR restarted), and here it must never run. The uncommanded-audio
    // half is kept too: nothing may sound after the run ends.
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
      // Both staves keep a real signature (grandStaff Hands control stays
      // visible), but their only notes sit at onset 0 with a short 0.5-quarter
      // duration (note_off @ 500ms, well clear of m2's 1000ms in-point) — m2 has
      // no note entries at all, at either staff.
      notes: [
        { midi: 64, staff: 0, onsetQuarter: 0, durationQuarters: 0.5 },
        { midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 0.5 },
      ],
    };
    // Capture logged events the same way the Polish describe's captureLog()
    // does (that helper is scoped to the Polish block, so inlined here).
    const root = getLogger();
    const origChild = root.child.bind(root);
    const emitted = []; // [event, data]
    vi.spyOn(root, 'child').mockImplementation((ctx) => {
      const c = origChild(ctx);
      const orig = c.info.bind(c);
      c.info = (ev, data, opts) => { emitted.push([ev, data]); return orig(ev, data, opts); };
      return c;
    });
    const wraps = () => emitted.filter(([ev]) => ev === 'score.transport.loop-wrap');

    renderPlayer();
    pickMode('Listen');
    await act(async () => {});
    // Loop measure 2 only (tail measure — the zero-span case).
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); }); // no range yet -> direct tap starts selection
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
    expect(screen.getByText('m 2 / 2')).toBeTruthy(); // the range still parks the cursor at its in-point
    screen.getByRole('button', { name: 'Play' }).click(); // Listen always plays immediately (no count-in — wave-3 A)
    await act(async () => {});
    act(() => vi.advanceTimersByTime(200)); // where wave-2 armed the zero-span dwell
    expect(wraps()).toEqual([]);            // …nothing is armed: Listen holds no range
    h.sendNoteAt.mockClear();

    // A hand toggle after the run — the wave-2 trigger for the stale restart.
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Right hand' })); });
    act(() => vi.advanceTimersByTime(1500)); // well past where the one-beat dwell would have fired
    expect(wraps()).toEqual([]);             // no loop-wrap, ever
    expect(h.sendNoteAt).not.toHaveBeenCalled(); // and no uncommanded audio
  });
});

// ── Task 9 (§B): the Learn state matrix ───────────────────────────────────────
// Learn has THREE states, not one:
//   1. no range           → machine playback of the active hands (Play live)
//   2. range + loop ON    → the gate: follow tracker drives, kiosk silent, Play locked
//   3. range + loop OFF   → machine playback of the WHOLE piece, brackets still shown
// Loop/focus is Learn-only state: entering any other mode clears both.
describe('ScorePlayer — Learn state matrix (wave-3 B)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
    vi.setSystemTime(0);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  // Three measures, one onset each @60bpm (1000ms/quarter). Step 0 is a
  // both-hands step (RH E4 + LH E2) so the follow gate has something to hold;
  // steps 1-2 are RH alone.
  const THREE = {
    tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
    events: [
      { midi: 64, midis: [64, 40], onsetQuarter: 0, x: 100, top: 10, bottom: 200, system: 0 },
      { midi: 62, midis: [62], onsetQuarter: 1, x: 160, top: 10, bottom: 200, system: 0 },
      { midi: 60, midis: [60], onsetQuarter: 2, x: 220, top: 10, bottom: 200, system: 0 },
    ],
    steps: [
      { onsetQuarter: 0, measure: 0, notes: [{ midi: 64, staff: 0, x: 100, top: 10, bottom: 200, width: 8 }, { midi: 40, staff: 1, x: 100, top: 10, bottom: 200, width: 8 }] },
      { onsetQuarter: 1, measure: 1, notes: [{ midi: 62, staff: 0, x: 160, top: 10, bottom: 200, width: 8 }] },
      { onsetQuarter: 2, measure: 2, notes: [{ midi: 60, staff: 0, x: 220, top: 10, bottom: 200, width: 8 }] },
    ],
    measures: [
      { index: 0, number: 1, firstStep: 0, lastStep: 0 },
      { index: 1, number: 2, firstStep: 1, lastStep: 1 },
      { index: 2, number: 3, firstStep: 2, lastStep: 2 },
    ],
    notes: [
      { midi: 64, staff: 0, onsetQuarter: 0, durationQuarters: 1 },
      { midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 1 },
      { midi: 62, staff: 0, onsetQuarter: 1, durationQuarters: 1 },
      { midi: 60, staff: 0, onsetQuarter: 2, durationQuarters: 1 },
    ],
  };

  const enterLearnFresh = async () => {
    renderPlayer();
    pickMode('Learn');
    await act(async () => {});
    clearAutoRange(); // this describe tests the matrix rows from a BLANK entry
  };
  // Guided two-tap selection: both taps on the note at `clientX` → a ONE-measure
  // range, looping (a freshly-picked range always arms the loop).
  const armLoopAt = (clientX) => {
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); });
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX, clientY: 100 }); });
    act(() => { fireEvent.click(scroll, { clientX, clientY: 100 }); });
  };
  const armLoopSpan = (x1, x2) => {
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); });
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: x1, clientY: 100 }); });
    act(() => { fireEvent.click(scroll, { clientX: x2, clientY: 100 }); });
  };
  const pos = () => screen.getByTestId('score-position').textContent;
  const runBtn = () => document.querySelector('.piano-score-run');

  // ── Spec 1: Learn with no range = machine playback ──────────────────────────
  it('Learn without a range performs the active hands through the piano, on a live transport', async () => {
    h.layoutExtras = THREE;
    await enterLearnFresh();
    const btn = screen.getByRole('button', { name: 'Play' });
    expect(btn).not.toBeDisabled(); // Play is NOT locked without a range
    btn.click();
    await act(async () => {});
    expect(document.querySelector('.piano-score-countin')).toBeNull(); // Polish-only count-in
    act(() => vi.advanceTimersByTime(100));
    expect(h.sendNoteAt).toHaveBeenCalledWith(64, expect.any(Number), expect.any(Number)); // RH performed
    expect(h.sendNoteAt).toHaveBeenCalledWith(40, expect.any(Number), expect.any(Number)); // LH performed
    act(() => vi.advanceTimersByTime(1000));
    expect(pos()).toContain('m 2 / 3'); // the transport advances the cursor
  });

  it('Learn without a range runs no wrong-note gate — a mismatched note neither shakes nor blocks', async () => {
    h.layoutExtras = THREE;
    await enterLearnFresh();
    expect(h.noteCb).toBeNull(); // the follow tracker never subscribed
    play(61); // a wrong note against step 0 (E4/E2)
    expect(document.querySelector('.piano-score-cursor.is-wrong')).toBeNull();
    expect(pos()).toContain('m 1 / 3'); // and input does not drive the cursor either
  });

  // ── Spec 2: range + loop ON = the gate ──────────────────────────────────────
  it('Learn with a looping range locks Play, stays silent, and lets the follow tracker drive', async () => {
    h.layoutExtras = THREE;
    await enterLearnFresh();
    armLoopSpan(100, 220); // m1–m3, looping
    expect(screen.getByRole('button', { name: 'Learn advances as you play' })).toBeDisabled();
    act(() => vi.advanceTimersByTime(2000));
    expect(h.sendNoteAt).not.toHaveBeenCalled(); // the kiosk performs nothing in the gate
    expect(h.noteCb).toBeTypeOf('function');     // the tracker is subscribed
    play(64); play(40);                          // all active-staff notes of step 0
    expect(pos()).toContain('m 2 / 3');           // …advances the cursor
    play(63);                                     // a plausible wrong note flashes — the gate is armed
    expect(document.querySelector('.piano-score-cursor.is-wrong')).not.toBeNull();
  });

  // ── Spec 3: range + loop OFF = machine playback of the whole piece ──────────
  it('Learn with a range but the loop OFF plays the WHOLE piece, brackets still visible', async () => {
    h.layoutExtras = THREE;
    await enterLearnFresh();
    armLoopAt(160); // one-measure range on m2 — cursor jumps to the in-point
    expect(pos()).toContain('m 2 / 3');
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); }); // loop OFF, range kept
    expect(screen.getByRole('button', { name: 'Loop' })).toHaveTextContent(/m2–m2/i);
    expect(document.querySelectorAll('.piano-score-range-bracket').length).toBeGreaterThan(0);
    const btn = screen.getByRole('button', { name: 'Play' });
    expect(btn).not.toBeDisabled();
    btn.click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(1100)); // one quarter past the out-point
    expect(pos()).toContain('m 3 / 3');      // ran PAST the range — no wrap
  });

  // ── Spec 4: turning the loop ON is a matrix change ──────────────────────────
  it('turning the loop ON stops the transport, silences, jumps to the in-point, and does not auto-play', async () => {
    h.layoutExtras = THREE;
    await enterLearnFresh();
    armLoopAt(160);                                                            // range on m2
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); }); // …loop OFF
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 220, clientY: 100 }); });    // seek to m3
    expect(pos()).toContain('m 3 / 3');
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(100));
    expect(h.sendNoteAt).toHaveBeenCalled(); // machine playback is running
    h.sendPanic.mockClear();
    h.sendNoteAt.mockClear();

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); }); // loop back ON
    expect(h.sendPanic).toHaveBeenCalled();                                        // silenced
    expect(screen.getByRole('button', { name: 'Learn advances as you play' })).toBeDisabled();
    expect(pos()).toContain('m 2 / 3');   // jumped to the in-point
    act(() => vi.advanceTimersByTime(2000));
    expect(pos()).toContain('m 2 / 3');   // …and never started itself
    expect(h.sendNoteAt).not.toHaveBeenCalled();
  });

  // ── Spec 5: turning the loop OFF leaves the cursor alone ────────────────────
  it('turning the loop OFF drops the follow gate cleanly and leaves the cursor put', async () => {
    h.layoutExtras = THREE;
    await enterLearnFresh();
    armLoopAt(160);
    expect(h.noteCb).toBeTypeOf('function');
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); }); // loop OFF
    expect(h.noteCb).toBeNull();                                  // tracker unsubscribed
    expect(pos()).toContain('m 2 / 3');                            // cursor stays where it was
    expect(screen.getByRole('button', { name: 'Play' })).not.toBeDisabled();
  });

  // ── Spec 6: loop/focus is Learn-only state ──────────────────────────────────
  it('entering Listen or Polish clears the range AND the loop toggle; Learn keeps it', async () => {
    h.layoutExtras = THREE;
    await enterLearnFresh();
    armLoopAt(160);
    const trigger = () => screen.getByRole('button', { name: 'Loop' });
    expect(trigger()).toHaveTextContent(/m2–m2/i);
    expect(trigger()).toHaveAttribute('aria-pressed', 'true');

    pickMode('Listen');
    expect(trigger().textContent).toBe('');                       // range gone
    expect(trigger()).toHaveAttribute('aria-pressed', 'false');   // …and the loop toggle with it
    pickMode('Learn');
    clearAutoRange(); // this spec checks the range does NOT survive the round trip
    expect(trigger().textContent).toBe('');                       // nothing came back

    armLoopAt(160);
    expect(trigger()).toHaveTextContent(/m2–m2/i);
    pickMode('Polish');                                            // Polish grades whole-piece only
    expect(trigger().textContent).toBe('');
    expect(trigger()).toHaveAttribute('aria-pressed', 'false');
  });

  it('Perform still releases the range (unchanged)', async () => {
    h.layoutExtras = THREE;
    await enterLearnFresh();
    armLoopAt(160);
    pickMode('Perform');
    pickMode('Learn');
    clearAutoRange(); // this spec checks the range does NOT survive the round trip
    expect(screen.getByRole('button', { name: 'Loop' }).textContent).toBe('');
  });

  // ── Spec 7: every former `mode === 'listen'` audio guard is `sendsAudio` ─────
  const startMachineLearn = async () => {
    h.layoutExtras = THREE;
    await enterLearnFresh();
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(100));
    expect(h.sendNoteAt).toHaveBeenCalled();
    h.sendPanic.mockClear();
  };

  it('a tap-seek during Learn machine playback flushes the schedule', async () => {
    await startMachineLearn();
    act(() => { fireEvent.click(document.querySelector('.piano-score-player__scroll'), { clientX: 220, clientY: 100 }); });
    expect(h.sendPanic).toHaveBeenCalled();
  });

  it('pausing Learn machine playback flushes the schedule', async () => {
    await startMachineLearn();
    screen.getByRole('button', { name: 'Pause' }).click();
    await act(async () => {});
    expect(h.sendPanic).toHaveBeenCalled();
  });

  it('Restart during Learn machine playback flushes the schedule', async () => {
    await startMachineLearn();
    act(() => { fireEvent.click(screen.getByRole('button', { name: /restart/i })); });
    expect(h.sendPanic).toHaveBeenCalled();
  });

  it('a hand change during Learn machine playback flushes the schedule and picks the run back up', async () => {
    // The machine states perform the same note timeline Listen does, so a hand
    // change invalidates it the same way (audit H5) — pause + flush, then resume.
    await startMachineLearn();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Left hand' })); });
    await act(async () => {});
    expect(h.sendPanic).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument(); // resumed, not stranded
  });

  it('a completed Learn machine run flushes the schedule and returns the cursor home', async () => {
    await startMachineLearn();
    act(() => vi.advanceTimersByTime(5000)); // past the final onset + its release → onDone
    expect(h.sendPanic).toHaveBeenCalled();
    expect(pos()).toContain('m 1 / 3');
    expect(runBtn()).not.toBeDisabled(); // still a live transport, back at the top
  });

  // ── A matrix change must never panic a SILENT kiosk (fix round 1) ───────────
  // silenceScheduled() arms a delayed CC123 unconditionally — silence() self-
  // guards on the sounding ledger, but the timer does not. In Learn's gate the
  // player is holding keys down, so a stray panic cuts off THEIR notes. A quiet
  // matrix change (mount, arming a range, flipping the loop with nothing playing)
  // must send nothing at all; an audible one must still flush.
  it('mounting the player sends no panic — nothing has played yet', async () => {
    h.layoutExtras = THREE;
    renderPlayer();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(1000)); // well past lookahead + 60ms
    expect(h.sendPanic).not.toHaveBeenCalled();
  });

  // Entering a mode flushes unconditionally (onMode, pre-existing) — let that
  // delayed panic land and reset the spy, so these assert the matrix change ALONE.
  const settleInSilentLearn = async () => {
    h.layoutExtras = THREE;
    await enterLearnFresh();
    act(() => vi.advanceTimersByTime(1000)); // drain the mode-change flush
    h.sendPanic.mockClear();
  };

  it('arming a range in a silent Learn sends no panic', async () => {
    await settleInSilentLearn();
    armLoopAt(160);
    act(() => vi.advanceTimersByTime(1000));
    expect(h.sendPanic).not.toHaveBeenCalled();
  });

  it('flipping the loop in a silent Learn gate sends no panic, either way', async () => {
    await settleInSilentLearn();
    armLoopAt(160);
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); }); // gate → machine
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); }); // …and back
    act(() => vi.advanceTimersByTime(1000));
    expect(h.sendPanic).not.toHaveBeenCalled();
  });

  it('clearing a range in a silent Learn sends no panic', async () => {
    await settleInSilentLearn();
    armLoopAt(160);
    act(() => { fireEvent.click(screen.getByRole('button', { name: /clear loop/i })); });
    act(() => vi.advanceTimersByTime(1000));
    expect(h.sendPanic).not.toHaveBeenCalled();
  });

  it('…but a matrix change during AUDIBLE machine playback still flushes, twice', async () => {
    await startMachineLearn();            // playing, notes sounding
    act(() => vi.advanceTimersByTime(400)); // let the mode-change flush land first
    h.sendPanic.mockClear();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); }); // no range → starts selection
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); }); // range set → matrix change
    const immediate = h.sendPanic.mock.calls.length;
    expect(immediate).toBeGreaterThanOrEqual(1); // the sounding note is killed now…
    act(() => vi.advanceTimersByTime(500));      // …and the lookahead window is swept after
    expect(h.sendPanic.mock.calls.length).toBeGreaterThan(immediate);
  });

  // ── Spec 8: the Learn free metronome is orthogonal to the matrix ────────────
  it('the Learn free metronome works in all three states', async () => {
    h.layoutExtras = THREE;
    await enterLearnFresh();
    const click = () => screen.getByRole('button', { name: /metronome/i });
    act(() => { fireEvent.click(click()); });                     // state 1: no range
    expect(h.clickSched.start).toHaveBeenCalledTimes(1);
    act(() => { fireEvent.click(click()); });
    armLoopAt(160);                                               // state 2: the gate
    act(() => { fireEvent.click(click()); });
    expect(h.clickSched.start).toHaveBeenCalledTimes(2);
    expect(click()).toHaveAttribute('aria-pressed', 'true');
    act(() => { fireEvent.click(click()); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); }); // state 3: loop OFF
    act(() => { fireEvent.click(click()); });
    expect(h.clickSched.start).toHaveBeenCalledTimes(3);
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
    pickMode('Listen');
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(100));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Right hand' })); });
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
    pickMode('Listen');
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click(); // Listen always plays immediately (no count-in — wave-3 A)
    await act(async () => {});
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument(); // playing

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Right hand' })); });
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
    pickMode('Listen');
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
    pickMode('Listen');
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click(); // Listen always plays immediately (no count-in — wave-3 A)
    await act(async () => {});
    act(() => vi.advanceTimersByTime(1100)); // one step in
    expect(screen.getByTestId('score-position')).toHaveTextContent('2 / 4');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();

    // The re-engrave is in flight: the stub holds its publish, so the reported
    // layout still belongs to the WRITTEN key.
    h.holdLayout = true;
    fireEvent.click(screen.getByRole('button', { name: 'Key' })); // open the Key sheet
    // Default parse key is fifths:0/mode:null (C major), so the +1 cell speaks the
    // sounding key name (C# major) — see Task 5.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /\+1/ })); }); // tap +1 semitone
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
    pickMode('Listen');
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
  // Loop/focus is Learn-only state now (wave-3 §0), so this is a Learn scenario:
  // the loop is OFF-limits to Polish, but Restart's home-step rule is unchanged.
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
    // Set a loop on measure 2 only (two selection taps at x=160 → step 1 → measure index 1).
    enterLearnGate(160);
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
    pickMode('Learn');
    clearAutoRange(); // this spec arms its own loop from a blank entry
    // Set a loop of m1–m1 (two selection taps on the first note).
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); }); // no range yet -> direct tap starts selection
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 100, clientY: 100 }); });
    act(() => { fireEvent.click(scroll, { clientX: 100, clientY: 100 }); });
    expect(screen.getByRole('button', { name: 'Loop' })).toHaveTextContent(/m1–m1/i);
    // Open the Loop menu (the chevron, now that the trigger is a direct toggle) and nudge the end later.
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop options' })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /loop end later/i })); });
    expect(screen.getByRole('button', { name: 'Loop' })).toHaveTextContent(/m1–m2/i);
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
    pickMode('Learn');
    clearAutoRange(); // this spec starts selection from a blank entry
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); }); // no range yet -> direct tap starts selection
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
    pickMode('Learn');
    clearAutoRange(); // this spec starts selection from a blank entry
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); }); // no range yet -> direct tap starts selection
    expect(screen.getByText(/tap the first measure/i)).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(15001); }); // the user wandered off
    expect(screen.queryByText(/tap the first measure/i)).toBeNull(); // banner gone — arming expired

    // A tap now SEEKS (the whole point: arming was gating tap-to-seek).
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
    expect(screen.getByText('m 2 / 2')).toBeTruthy();
    // Inactive trigger is icon-only (wave-2: no range → no visible label) — and set no loop.
    expect(screen.getByRole('button', { name: 'Loop' }).textContent).toBe('');
  });
});

describe('ScorePlayer — metronome in Learn (M1/M2/M4)', () => {
  it('is an icon-only toggle in Learn; toggling starts/stops the click immediately', () => {
    renderPlayer();
    enterLearn();
    const btn = screen.getByRole('button', { name: /metronome/i });
    expect(btn.textContent).toBe(''); // icon-only — no bpm span (wave-2 T6)
    expect(btn.querySelector('svg')).not.toBeNull(); // MetronomeIcon
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
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^60%/ })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /metronome/i })); });
    expect(h.clickSched.start).toHaveBeenCalledWith(60); // 100 × 0.6
  });

  it('retunes a running Learn click live with the EXACT bpm (no rounding)', () => {
    h.layoutExtras = { tempoEntries: [{ onsetQuarter: 0, bpm: 90 }] }; // 90 × 1.25 = 112.5 — rounding would corrupt it
    renderPlayer();
    enterLearn();
    act(() => { fireEvent.click(screen.getByRole('button', { name: /metronome/i })); }); // ON first
    expect(h.clickSched.start).toHaveBeenCalledWith(90);
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^tempo/i })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^125%/ })); }); // change tempo while ticking
    // The hook must receive the exact product, not a rounded display value —
    // (playTimeline scales by exact 1/tempoMult): 90 × 1.25 = 112.5.
    expect(h.clickSched.setBpm).toHaveBeenCalledWith(112.5);
  });

  it('tempo steps show the resulting BPM (M4)', () => {
    renderPlayer(); // Listen
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^tempo/i })); });
    // Each percent step also shows the BPM it produces (base 100 from the fixture).
    expect(screen.getByRole('button', { name: /^60%.*60/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^100%.*100/ })).toBeInTheDocument();
  });
});

describe('ScorePlayer — Listen metronome (wave-3 G)', () => {
  it('is session-local like Learn: toggling ON starts the click, and a mode round-trip resets it OFF', () => {
    // Default fixture has no tempoEntries → buildTempoMap falls back to a single
    // entry, so the guard allows the click in Listen.
    renderPlayer(); // opens in Listen
    const click = () => screen.getByRole('button', { name: /metronome/i });
    expect(click()).toHaveAttribute('aria-pressed', 'false'); // Listen defaults OFF
    expect(h.clickSched.start).not.toHaveBeenCalled();
    act(() => { fireEvent.click(click()); });
    expect(click()).toHaveAttribute('aria-pressed', 'true');
    expect(h.clickSched.start).toHaveBeenCalledTimes(1);
    // Leave Listen (Learn) and come back — session-local, never persisted (M2 discipline).
    pickMode('Learn');
    pickMode('Listen');
    expect(click()).toHaveAttribute('aria-pressed', 'false');
  });

  it('is disabled when the tempo map has more than one entry (mid-piece tempo change)', () => {
    h.layoutExtras = { tempoEntries: [{ onsetQuarter: 0, bpm: 60 }, { onsetQuarter: 4, bpm: 120 }] };
    renderPlayer(); // opens in Listen
    const click = screen.getByRole('button', { name: /metronome/i });
    expect(click).toBeDisabled();
    act(() => { fireEvent.click(click); });
    expect(h.clickSched.start).not.toHaveBeenCalled();
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
    enterLearnGate(); // stamps the reference point at t=1000; the gate is what tracks
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
    enterLearnGate();
    // Complete step 0 (E4 + LH E3/E2) at +300ms, then answer step 1 at +900ms.
    t = 1300; play(64); play(52); play(40);
    t = 2200; play(62);
    pickMode('Listen'); // leaving Learn flushes

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

  // Wave-3 §0 retires "enter Learn on the loop another mode was holding": no other
  // mode holds a range any more. What replaces it is the round trip — a range set
  // in Learn does not survive the trip out, so Learn is re-entered from the top.
  it('re-enters from the top: leaving Learn released the range that pinned the cursor', () => {
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
    enterLearn();
    // Loop measures 2–3 (steps 1–2) via the guided two-tap selection.
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); }); // no range yet -> direct tap starts selection
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); }); // m2
    act(() => { fireEvent.click(scroll, { clientX: 220, clientY: 100 }); }); // m3
    expect(screen.getByTestId('score-position')).toHaveTextContent('m 2 / 4'); // at the in-point
    act(() => { fireEvent.click(scroll, { clientX: 280, clientY: 100 }); }); // seek deeper (clamped to m3)
    expect(screen.getByTestId('score-position')).toHaveTextContent('m 3 / 4');
    pickMode('Listen');
    expect(screen.getByRole('button', { name: 'Loop' }).textContent).toBe(''); // range released
    enterLearn();
    expect(screen.getByTestId('score-position')).toHaveTextContent('m 1 / 4'); // from the top
  });
});

// ── Task 14: the Learn landing auto-picks a practice range so a walk-up user is
// never dropped on a blank "no range" Learn — pickLearnRange (learnRange.js)
// resolves frontier/section/density/fallback/whole, and the wiring effect
// arms it as the loop the instant Learn opens without one.
describe('ScorePlayer — Learn auto-range landing (Task 14)', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  // Two single-note measures, no rests, no sections, no practice history — the
  // heuristic has nothing to key off but "where the notes are", so it falls
  // through frontier/section/density to the FALLBACK rule: the first non-empty
  // run, clipped to the piece. With only 2 measures (< the 4-measure window)
  // that fallback span is the whole piece: {0, 1}.
  const AUTO_TWO = {
    steps: [
      { onsetQuarter: 0, measure: 0, notes: [{ midi: 64, staff: 0, x: 100, top: 10, bottom: 200, width: 8 }] },
      { onsetQuarter: 1, measure: 1, notes: [{ midi: 62, staff: 0, x: 160, top: 10, bottom: 200, width: 8 }] },
    ],
    measures: [
      { index: 0, number: 1, firstStep: 0, lastStep: 0 },
      { index: 1, number: 2, firstStep: 1, lastStep: 1 },
    ],
  };
  // Same shape, mirroring the captureLog pattern already used by the Polish
  // describe above (a local spy on the session-logged child, scoped to this
  // describe's own afterEach restore).
  const captureLog = () => {
    const root = getLogger();
    const origChild = root.child.bind(root);
    const emitted = [];
    vi.spyOn(root, 'child').mockImplementation((ctx) => {
      const c = origChild(ctx);
      const orig = c.info.bind(c);
      c.info = (ev, data, opts) => { emitted.push([ev, data]); return orig(ev, data, opts); };
      return c;
    });
    return emitted;
  };

  it('entering Learn on a fresh score sets a focus with loopOn true and logs score.learn.auto-range', async () => {
    h.layoutExtras = AUTO_TWO;
    const emitted = captureLog();
    renderPlayer(); // opens in Listen
    pickMode('Learn');
    await act(async () => {});
    const trigger = screen.getByRole('button', { name: 'Loop' });
    expect(trigger).toHaveTextContent(/m1–m2/i);         // a range was picked…
    expect(trigger).toHaveAttribute('aria-pressed', 'true'); // …and the loop is ON
    // …which is the Learn GATE — Play is locked, the follow tracker drives.
    expect(screen.getByRole('button', { name: 'Learn advances as you play' })).toBeDisabled();
    const picks = emitted.filter(([ev]) => ev === 'score.learn.auto-range').map(([, d]) => d);
    expect(picks).toEqual([{ inMeasure: 0, outMeasure: 1, reason: 'fallback' }]);
  });

  it('does not auto-pick again after the user clears the picked range mid-Learn', async () => {
    h.layoutExtras = AUTO_TWO;
    const emitted = captureLog();
    renderPlayer();
    pickMode('Learn');
    await act(async () => {});
    expect(emitted.filter(([ev]) => ev === 'score.learn.auto-range').length).toBe(1);
    // The user clears the picked range (back to a blank Learn) — the SAME
    // mode==='learn' && !focus shape the arm effect keys off, but the arm is
    // spent for this Learn entry (it only re-arms on a mode TRANSITION into
    // Learn), so it must not silently repick under the user.
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Clear loop' })); });
    expect(screen.getByRole('button', { name: 'Loop' }).textContent).toBe('');
    expect(emitted.filter(([ev]) => ev === 'score.learn.auto-range').length).toBe(1); // still just the one
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
    enterLearnGate(); // the all-notes rule (and this prompt's whole premise) is Learn's gate
    // Step 0 is E4 (staff 0) + E3/E2 (staff 1) — a step the all-notes rule holds
    // hostage until both hands arrive.
    expect(stuck()).toBeNull();          // not offered immediately — dwelling is the signal
    act(() => vi.advanceTimersByTime(5100));
    expect(stuck()).not.toBeNull();

    // Disambiguate from the bar's Right-hand toggle: pick inside the prompt.
    act(() => { fireEvent.click(within(stuck()).getByRole('button', { name: /right hand/i })); });
    expect(stuck()).toBeNull();          // taken up → the offer goes away

    // …and Learn now advances on the RH note alone: staff 1 is no longer active.
    expect(screen.getByTestId('score-position')).toHaveTextContent('1 / 4');
    play(64);
    expect(screen.getByTestId('score-position')).toHaveTextContent('2 / 4');
  });

  it('does not offer on a single-staff step — a split would not help', async () => {
    renderPlayer();
    await act(async () => {});
    enterLearnGate();
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

describe('ScorePlayer — staff dim layer (Task 8)', () => {
  afterEach(() => { cleanup(); });

  it('dims the deselected staff in Learn and clears when reselected', async () => {
    renderPlayer(); // opens in Listen
    await act(async () => {});
    enterLearn();
    await act(async () => {});
    expect(document.querySelectorAll('.piano-score-staff-dim')).toHaveLength(0);

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Left hand' })); }); // deselect LH
    expect(document.querySelectorAll('.piano-score-staff-dim').length).toBeGreaterThan(0);

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Left hand' })); }); // reselect LH
    expect(document.querySelectorAll('.piano-score-staff-dim')).toHaveLength(0);
  });
});
