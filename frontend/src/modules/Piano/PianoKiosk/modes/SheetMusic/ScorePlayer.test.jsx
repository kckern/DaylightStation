import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { __resetRecorder, __snapshotForTest, KIND } from '../../../../../lib/logging/inputRecorder.js';

// Shared holders (hoisted so the vi.mock factories can see them).
const h = vi.hoisted(() => ({
  // EVERY live note-event subscriber, not just the last one. The real
  // PianoMidiContext is a multicast bus, and ScorePlayer now has more than one
  // possible subscriber per mode (the follow tracker, the Polish evaluator, and
  // Learn's machine-row wet ink). A single-slot mock silently collapses them: the
  // last effect to subscribe wins the slot, so "the tracker unsubscribed" and "the
  // tracker is still subscribed but something else overwrote the slot" become
  // indistinguishable — which is exactly how a widened gate would sail through the
  // machine-row guards below. Subscribing adds; unsubscribing removes THAT fn.
  noteCbs: new Set(),
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
  // usePianoPreferences (Task 15): a plain key→value bag a test can seed before
  // render to control getPref('learnHands', …) — empty by default, so every
  // OTHER test in this file falls through to the household/hardcoded default
  // ('both') exactly as an unconfigured kiosk would.
  prefs: {},
  // usePracticeRecord's `record` (Task 15) — {} by default (no history).
  practice: {},
  // usePracticeRecord's `persistent` (wave-3 H) — whether a write can reach the
  // server at all. True by default (a signed-in user); a test sets it false to
  // exercise the guest branch of the tier-best bank decision.
  practicePersistent: true,
  // usePianoPreferences' `loaded` (Task 15 review fix round 1) — true by
  // default (every OTHER test's prefs are "already resolved"). A test that
  // needs to prove the seeding effect WAITS for a late-resolving prefs fetch
  // sets this false before render, then flips it true and notifies
  // prefsListeners (subscribed by the mock hook below) to simulate the GET
  // landing after the score has already engraved.
  prefsLoaded: true,
  prefsListeners: new Set(),
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
    subscribe: (fn) => { h.noteCbs.add(fn); return () => { h.noteCbs.delete(fn); }; },
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
  // `record` reads h.practice so a test can seed per-bucket pass history before
  // render (Task 15's frontier-follows-the-seeded-bucket test) — {} by default,
  // matching every OTHER test's prior no-history behavior exactly.
  default: () => ({ record: h.practice, loaded: true, persistent: h.practicePersistent, recordCycle: h.recordCycle, recordTierBest: h.recordTierBest }),
}));
// usePianoPreferences (Task 15) reaches usePianoUser exactly like
// usePracticeRecord does — mock it out for the same reason (no
// PianoUserProvider in this harness). getPref reads h.prefs, which starts
// empty and individual tests can seed before render. `loaded` reads
// h.prefsLoaded LIVE via a subscribed re-render (not just at mock-creation
// time): a real hook flips `loaded` false→true asynchronously after its own
// GET resolves, and the seeding effect must be provably re-entered when that
// happens — a static `loaded: true` can't exercise that path.
vi.mock('../../usePianoPreferences.js', async () => {
  const { useEffect, useReducer } = await import('react');
  return { usePianoPreferences: () => {
    const [, bump] = useReducer((c) => c + 1, 0);
    useEffect(() => {
      h.prefsListeners.add(bump);
      return () => h.prefsListeners.delete(bump);
    }, [bump]);
    return {
      prefs: h.prefs,
      loaded: h.prefsLoaded,
      getPref: (key, fallback) => (key in h.prefs ? h.prefs[key] : fallback),
      setPref: vi.fn(),
    };
  } };
});

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
      return (
        <div data-testid="renderer" className="musicxml-renderer">
          {/* Mirrors the engraved DOM: OSMD renders its <svg> into the host div,
              one g.staffline per staff per system with a 1-based id suffix. */}
          <div className="musicxml-renderer__svg">
            <svg>
              <g className="staffline" id="Piano0-1" />
              <g className="staffline" id="Piano0-2" />
            </svg>
          </div>
          {children}
        </div>
      );
    },
  };
});

import ScorePlayer from './ScorePlayer.jsx';

// One physical key press, fanned out to every live subscriber (the real bus is
// multicast). Snapshot the set first: a callback may subscribe or unsubscribe as a
// side effect of the state it commits, and mutating a Set mid-iteration is
// undefined-ish.
const emitNote = (evt) => act(() => { [...h.noteCbs].forEach((fn) => fn(evt)); });
const play = (note) => emitNote({ type: 'note_on', note, velocity: 80 });
const renderPlayer = () =>
  render(<MemoryRouter><ScorePlayer score={{ title: 'Mary', musicXml: '<score/>' }} /></MemoryRouter>);

beforeEach(() => {
  h.noteCbs = new Set(); h.rawCb = null; h.layoutExtras = {};
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
  h.prefs = {};
  h.practice = {};
  h.practicePersistent = true;
  h.prefsLoaded = true;
  h.prefsListeners = new Set();
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

// ── Armed endpoint picking (wave-3 F) ────────────────────────────────────────
// The loop cluster is LoopGroup's four buttons, rendered ONLY in Learn: tap
// "Mark loop start" / "Mark loop end" to ARM that edge, then tap the measure on
// the score. There is no two-tap flow and no half-marked state — the first commit
// lands a real one-measure range with the loop OFF (§F), and a later endpoint
// replaces that edge (auto-swapping if the ends cross).
const loopIn = () => screen.getByRole('button', { name: 'Mark loop start' });
const loopOut = () => screen.getByRole('button', { name: 'Mark loop end' });
const loopToggle = () => screen.getByRole('button', { name: 'Toggle loop' });
// The armed range as the bar shows it: 'm1–m2' (1-based), or '–' when no range
// is set — both mark buttons are icon-only until an endpoint exists.
const loopSpan = () => `${loopIn().textContent.trim()}–${loopOut().textContent.trim()}`;
const tapScore = (clientX, clientY = 100) => {
  act(() => { fireEvent.click(document.querySelector('.piano-score-player__scroll'), { clientX, clientY }); });
};
const arm = (edge) => act(() => { fireEvent.click(edge === 'in' ? loopIn() : loopOut()); });
const armAndTap = (edge, clientX, clientY = 100) => { arm(edge); tapScore(clientX, clientY); };
const toggleLoop = () => act(() => { fireEvent.click(loopToggle()); });

// Task 14's Learn landing auto-picks a range (and arms the loop) the instant
// Learn opens on a fixture whose layout reports `measures` — the frontier/
// section/density/fallback heuristic always resolves to SOME range, never
// null. The many pre-14 tests below assume a BLANK Learn entry (no range) so
// they can arm their own endpoints or exercise the no-range machine-playback row
// directly; clear the auto-pick immediately after entering so their original,
// fixture-independent assumptions hold. A no-op when no range was picked (e.g.
// layout.measures is empty/absent — Clear is disabled with nothing to clear).
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
// Learn, plant the in-point on the measure under `clientX` (a one-measure range,
// loop OFF per §F), then turn the loop on — that pair IS the gate. Fixtures with
// no `measures` in their layout resolve to a null step span, so the tracker
// advances linearly through the whole piece — exactly as it did before wave-3.
const enterLearnGate = (clientX = 100) => {
  enterLearn();
  armAndTap('in', clientX);
  toggleLoop();
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

  it('PianoApp.scss gives .piano-note-hit its own fixed dark brown, never the shared --nh-color ink (wave-2 A)', () => {
    // jsdom doesn't compute styles from the stylesheet, so assert the source
    // directly (same pattern as TransportButton.test.jsx's SCSS floor check).
    const scss = readFileSync(fileURLToPath(new URL('../../../../../Apps/PianoApp.scss', import.meta.url)), 'utf8');
    // .piano-note-hit nests one level (its `path, rect, ...` sub-rule), so match
    // through that inner brace pair too, not just up to the first `}`.
    const hitBlock = scss.match(/\.piano-note-hit\s*\{(?:[^{}]|\{[^{}]*\})*\}/s)?.[0];
    expect(hitBlock).toBeTruthy();
    expect(hitBlock).toContain('#6b4423'); // struck-correctly reads as dark brown ink
    expect(hitBlock).not.toContain('#2ec46f'); // not the shared kiosk accent green
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
    expect(h.noteCbs.size).toBe(1); // Follow mode subscribed — and it is the ONLY subscriber in the gate

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
    // Arm a one-measure range the wave-3 F way: tap "Mark loop start", then tap
    // the measure. The endpoint labels are where the span now shows.
    enterLearnGate();
    expect(loopSpan()).toBe('m1–m1');
    // Polish grades whole-piece runs — it releases the range, and the loop
    // cluster goes with it (Learn-only chrome, §0/§F: no dead buttons for a
    // range the mode cannot hold).
    pickMode('Polish');
    expect(screen.queryByRole('button', { name: 'Toggle loop' })).toBeNull();
    // …and re-entering Learn does not resurrect it: what shows is this entry's
    // own fresh arm, nothing inherited.
    enterLearnGate();
    expect(loopSpan()).toBe('m1–m1');
    // Listen is a jukebox — it releases it too.
    pickMode('Listen');
    expect(screen.queryByRole('button', { name: 'Toggle loop' })).toBeNull();
    enterLearn();
    expect(loopSpan()).toBe('–'); // a blank Learn — the OLD range never came back
    // Perform still releases it (unchanged).
    enterLearnGate();
    pickMode('Perform');
    expect(screen.queryByRole('button', { name: 'Toggle loop' })).toBeNull();
    enterLearn();
    expect(loopSpan()).toBe('–');
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
  // A range spanning BOTH measures, the wave-3 F way: plant the in-point on the
  // note at x=100 (measure 1), then move the out-point to x=160 (measure 2), then
  // turn the loop on. Endpoint picking is incremental, so the SECOND endpoint is a
  // change against an already-active range — which voids the cycle it opened
  // (wave-3 C). `settleCycle` spends that void on a throwaway pass, so whatever a
  // test does next is the only disruption in play.
  const selectFullRange = () => {
    enterLearn();
    armAndTap('in', 100);
    armAndTap('out', 160);
    toggleLoop();
  };
  const playFullPass = () => { play(64); play(62); }; // 0→1, then 1→wraps to 0
  const settleCycle = () => { playFullPass(); h.recordCycle.mockClear(); };

  it('a fresh range arm starts an honest first cycle — the very first pass counts, no throwaway needed', () => {
    h.layoutExtras = TWO_MEASURE_LEARN;
    renderPlayer();
    // ONE atomic arm: an in-point tap lands a one-measure range at m1 (§F), and
    // the loop toggle makes it the gate. Nothing has touched the range since, so
    // this is a FRESH arm — its very first pass has to count.
    enterLearnGate(100);
    expect(h.recordCycle).not.toHaveBeenCalled(); // arming alone doesn't bank anything
    play(63); // a plausible wrong note against step 0's expected 64 (within 2 octaves)
    play(64); // the correct note — satisfies m1, the range's only measure → wraps
    expect(h.recordCycle).toHaveBeenCalledTimes(1);
    expect(h.recordCycle).toHaveBeenCalledWith({
      measureIndices: [0],
      wrongMeasures: new Set([0]), // the wrong note landed while the cursor sat on measure 0
      bucket: 'both', // single staff in this fixture → not a grand staff
    });
  });

  it('a tap-seek mid-cycle voids it (no recordCycle on the next wrap) — the following clean pass still counts', () => {
    h.layoutExtras = TWO_MEASURE_LEARN;
    renderPlayer();
    selectFullRange();
    settleCycle();
    // Tap-seek (nothing is armed after a commit, so a tap seeks) breaks the
    // in-progress cycle.
    tapScore(100);
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

  // The ±1 nudge is retired with the LoopSheet (wave-3 F); MOVING an endpoint is
  // now an armed re-tap, and it must still void the cycle it interrupts.
  it('moving a loop endpoint mid-cycle still voids the next wrap — the following clean pass still counts', () => {
    h.layoutExtras = TWO_MEASURE_LEARN;
    renderPlayer();
    // Arm a ONE-measure loop at m1 (fresh arm — no void; nothing played yet).
    enterLearnGate(100);
    expect(loopSpan()).toBe('m1–m1');
    // Move the out endpoint to m2 — grows to m1–m2. A range was ALREADY active
    // (the fresh arm above), so this is a genuine mid-cycle disruption and must
    // void, even though no note has been played since arming.
    armAndTap('out', 160);
    expect(loopSpan()).toBe('m1–m2');
    playFullPass(); // wraps m1→m2→m1 — but voided by the endpoint move above
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
    settleCycle();
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
    // Both hands are active here, so a settling pass needs all four notes.
    play(64); play(40); play(62); play(38);
    h.recordCycle.mockClear();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Left hand' })); }); // drop LH → voids
    // The LH note (40/38) is now inactive — only the RH note is expected per step.
    playFullPass(); // wraps — but voided by the hand toggle above
    expect(h.recordCycle).not.toHaveBeenCalled();
    playFullPass(); // a second, uninterrupted pass — this one counts
    expect(h.recordCycle).toHaveBeenCalledTimes(1);
  });

  it('a loop OFF→ON toggle discards wrongs from the dead gate session — the new session\'s first clean pass counts clean', () => {
    h.layoutExtras = TWO_MEASURE_LEARN;
    renderPlayer();
    selectFullRange();
    settleCycle();
    play(63);       // a wrong lands mid-cycle (cursor on measure 0)
    toggleLoop();   // gate OFF — the partial cycle dies with its session
    toggleLoop();   // gate back ON at the in-point — a fresh session
    playFullPass(); // clean pass
    expect(h.recordCycle).toHaveBeenCalledTimes(1);
    expect(h.recordCycle).toHaveBeenCalledWith({
      measureIndices: [0, 1],
      wrongMeasures: new Set(), // the pre-toggle wrong did NOT leak in
      bucket: 'both',
    });
  });

  it('Restart mid-cycle discards accumulated wrongs — the pass after Restart can be clean', () => {
    h.layoutExtras = TWO_MEASURE_LEARN;
    renderPlayer();
    selectFullRange();
    settleCycle();
    play(64); // satisfies step 0 → cursor to step 1 (Restart needs step > 0 to enable)
    play(63); // a wrong against step 1 → measure 1 tainted in the abandoned pass
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Restart' })); });
    playFullPass(); // a clean pass from the in-point
    expect(h.recordCycle).toHaveBeenCalledTimes(1);
    expect(h.recordCycle).toHaveBeenCalledWith({
      measureIndices: [0, 1],
      wrongMeasures: new Set(), // the pre-Restart wrong did NOT leak in
      bucket: 'both',
    });
  });

  // ── The completion card rides the WHOLE-PIECE wrap, not the tracker's onComplete ──
  // useFollowTracker fires onComplete only when it advances past the last step with
  // NO range (`atEnd = !range && …`), but the tracker only drives the cursor inside
  // Learn's gate — which by definition has a range. So the card was structurally
  // unreachable for every gated run: the piece could be played end to end and the
  // Learn journey just silently looped. A pass over a range that spans the whole
  // piece IS the end of the piece, so that wrap now fires the completion too.
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
  afterEach(() => { vi.restoreAllMocks(); });

  it('a clean pass over a WHOLE-PIECE range shows the completion card — and still records the cycle', () => {
    h.layoutExtras = TWO_MEASURE_LEARN;
    const emitted = captureLog();
    renderPlayer();
    selectFullRange(); // m1–m2 of a two-measure piece = the whole piece
    settleCycle();     // spend the second-endpoint void on a throwaway pass
    expect(document.querySelector('.piano-score-learn-complete')).toBeNull(); // the voided pass earns nothing

    playFullPass();
    expect(document.querySelector('.piano-score-learn-complete')).not.toBeNull();
    // The cycle is unaffected — the card is an additional consequence of the wrap,
    // not a replacement for it (attempts/passes still land).
    expect(h.recordCycle).toHaveBeenCalledTimes(1);
    expect(h.recordCycle).toHaveBeenCalledWith({ measureIndices: [0, 1], wrongMeasures: new Set(), bucket: 'both' });
    expect(emitted.filter(([ev]) => ev === 'score.learn.complete').length).toBe(1);
  });

  it('a clean pass over a PARTIAL range records the cycle and shows NO card', () => {
    // A lap of a passage is not the end of anything — the card would be a lie, and
    // an "on to Polish" offer for a piece the user has practised two measures of.
    h.layoutExtras = TWO_MEASURE_LEARN;
    const emitted = captureLog();
    renderPlayer();
    enterLearnGate(100); // a one-measure range at m1 — measure 2 is not in it
    play(64);            // satisfies the range's only measure → wraps
    expect(h.recordCycle).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.piano-score-learn-complete')).toBeNull();
    expect(emitted.filter(([ev]) => ev === 'score.learn.complete').length).toBe(0);
  });

  it('renders and completes a cycle without a PianoUserProvider — the practice hook is fully mocked out, so nothing crashes for a guest-shaped render', () => {
    h.layoutExtras = TWO_MEASURE_LEARN;
    expect(() => {
      renderPlayer();
      enterLearnGate(100); // a one-measure fresh arm — its first pass banks a cycle
      play(64);
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

  // Wave-3 I: Perform drops the page readout entirely — the bar renders NOTHING
  // in Perform (top-level `return null`), not just a hidden position span. Pedal
  // paging above still works with zero chrome on screen.
  it('renders no transport bar at all in Perform — zero chrome', async () => {
    renderPlayer();
    pickMode('Perform');
    await act(async () => {});
    expect(document.querySelector('.piano-score-transportbar')).toBeNull();
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
  // makes tier bests comparable. Wave-3 F closes the door completely — the loop
  // cluster is Learn-only, so a range cannot even be armed here, and the one the
  // user armed in Learn is released on the way in. The claim that has to hold is
  // the same as before: the run is never pinned, it finishes and finalizes.
  it('a range on the final measure does NOT pin a Polish run — it finishes and finalizes', async () => {
    h.layoutExtras = TAIL_MEASURE;
    renderPlayer();
    enterLearnGate(160);   // a tail-measure loop, armed where ranges live
    pickMode('Polish');
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Toggle loop' })).toBeNull(); // released with its chrome
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

  // A one-measure loop on the measure whose note sits at `clientX`, armed in LEARN
  // (wave-3 F: the loop cluster is Learn-only chrome) with the loop on — the state
  // a user actually arrives in Listen/Polish from. Callers hop modes afterwards.
  const loopMeasureAtX = (clientX) => enterLearnGate(clientX);
  const loopSecondMeasure = () => loopMeasureAtX(160); // THREE_MEASURES: a MIDDLE measure

  it('a range in Polish gates nothing: the cursor runs past the out-point and the measure still grades', async () => {
    // The wave-2 shape of this test asserted a WRAP onto the same measure. Polish
    // no longer loops (wave-3 §0), so what has to hold is the other half: the
    // advance-driven grader still banks the measure the user played, and the run
    // carries on past the (inert) out-point instead of being pinned to it.
    h.layoutExtras = THREE_MEASURES;
    const emitted = captureLog();

    renderPlayer();
    loopMeasureAtX(100); // a one-measure range on m1 (index 0), armed in Learn
    pickMode('Polish');  // …released on the way into Polish (§0), cursor stays put
    await act(async () => {});
    expect(screen.getByText('m 1 / 3')).toBeTruthy(); // where the range left the cursor
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // through the 4-beat @60 count-in
    play(64); // play the measure
    act(() => vi.advanceTimersByTime(1100)); // one quarter @60 → cursor passes the old out-point

    const grades = emitted.filter(([ev]) => ev === 'score.polish.measure');
    expect(grades.length).toBeGreaterThanOrEqual(1);
    expect(grades[0][1]).toMatchObject({ measure: 0, grade: 'green' });
    // Ran on into m2 — no wrap back to m1. Matched on the tail, because once a
    // measure is graded the Polish readout leads with the live run score (wave-3 H).
    expect(screen.getByTestId('score-position').textContent).toMatch(/m 2 \/ 3$/);
  });

  it('a Polish run that starts inside a range still grades the measure it played, exactly once', async () => {
    // The wave-2 version of this drove SIX passes over a tail-measure loop and
    // demanded a grade per pass. Polish has no passes now (wave-3 §0) — so what
    // must survive is that the single pass is scored from the note actually
    // played (not a silent red wash) and banked once, not once per phantom wrap.
    h.layoutExtras = THREE_MEASURES;
    const emitted = captureLog();

    renderPlayer();
    loopSecondMeasure(); // a one-measure range on m2 (index 1), armed in Learn
    pickMode('Polish');  // released on the way in — but the cursor stays at m2
    await act(async () => {});
    expect(screen.getByText('m 2 / 3')).toBeTruthy();
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // through the 4-beat @60 count-in
    play(62); // the pass
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
    play(60);
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
    loopSecondMeasure(); // armed in Learn — the only mode that holds a range
    pickMode('Listen');
    expect(screen.queryByRole('button', { name: 'Toggle loop' })).toBeNull(); // released with its chrome
    screen.getByRole('button', { name: 'Play' }).click(); // Listen always plays immediately (no count-in — wave-3 A)
    await act(async () => {});
    act(() => vi.advanceTimersByTime(3000)); // where wave-2 would have wrapped several times
    expect(emitted.filter(([ev]) => ev === 'score.transport.loop-wrap')).toEqual([]); // Listen does not loop
    // Now drill in Polish — which arrives with no range at all.
    pickMode('Polish');
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Toggle loop' })).toBeNull();
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
    armAndTap('in', 160); // eslint-disable-line no-unexpected-multiline // one-measure loop on m2 (index 1)
    toggleLoop();
    expect(screen.getByText('m 2 / 3')).toBeTruthy(); // parked at the loop in-point
    expect(loopSpan()).toBe('m2–m2');
    expect(loopToggle()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Learn advances as you play' })).toBeDisabled(); // the gate
    // The toggle flips looping off IN PLACE — the range survives it (audit L2
    // follow-up), so there is nothing to re-pick when it comes back on.
    toggleLoop();
    expect(loopToggle()).toHaveAttribute('aria-pressed', 'false'); // unlit…
    expect(loopSpan()).toBe('m2–m2'); // …but the endpoints are still shown, not cleared
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
    enterLearnGate(160); // an (unrelated) loop on m2, armed where ranges live
    pickMode('Polish');
    await act(async () => {});
    // Entering Polish releases the range AND forces the loop toggle off (§0) —
    // which IS the state the fix has to survive: setFocus alone would leave the
    // drilled range un-looped.
    // Play the piece out silently —
    // five reds, same as the completion-summary test above.
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(4100)); // count-in
    for (let i = 0; i < 8; i++) act(() => vi.advanceTimersByTime(1100)); // play the piece out
    expect(document.querySelector('.piano-score-run-summary')).not.toBeNull();
    const drillBtn = screen.getByRole('button', { name: /drill worst section/i });
    act(() => { fireEvent.click(drillBtn); });
    // A fresh range from the drill flow must loop, regardless of the earlier state.
    expect(loopToggle()).toHaveAttribute('aria-pressed', 'true');
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
    expect(loopSpan()).toBe('m1–m5');
    expect(loopToggle()).toHaveAttribute('aria-pressed', 'true');
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

// ── Polish tempo tiers (wave-3 H) ───────────────────────────────────────────────
// A whole-piece Polish run banks a per-tier best, so the tier and the score have
// to be exact — not "roughly green". Two things make that possible here:
//
//  1. The fixture's WRITTEN bpm is derived from the tempo the test will pick
//     (`60 / tempoMult`), so the run's scaled quarter is exactly 1000ms AND the
//     count-in runs at exactly 60 effective bpm (4 clicks × 1000ms = 4000ms).
//     Both land on multiples of the 100ms transport tick.
//  2. Advancing to exactly the boundary means the step fires with dueWall ===
//     performance.now(), so a note played immediately after has drift 0 →
//     timingScore 1 → combined = noteScore. The score is then pure note accuracy.
//
// Only 0.8 (→75bpm) and 1.25 (→48bpm) are used: both divide cleanly. 0.9 would
// give 66.666…bpm and a 1000.0000000000002ms quarter, which the tick misses.
describe('ScorePlayer — Polish tempo tiers (wave-3 H)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
    vi.setSystemTime(0);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  const COUNT_IN_MS = 4000; // 4 clicks at 60 effective bpm, by fixture construction

  // Same spy shape as the Polish describe's captureLog (which is scoped to that
  // block): assert on the SHIPPED session-log event, not an internal call.
  const captureTierLog = () => {
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

  /** n single-step measures, one per scaled quarter, all on ONE staff (bucket 'both'). */
  const tierFixture = (n, tempoMult) => ({
    tempoEntries: [{ onsetQuarter: 0, bpm: 60 / tempoMult }],
    events: Array.from({ length: n }, (_, i) => ({ midi: 60 + i, midis: [60 + i], onsetQuarter: i, x: 100 + i * 60, top: 10, bottom: 200, system: 0 })),
    steps: Array.from({ length: n }, (_, i) => ({ onsetQuarter: i, measure: i, notes: [{ midi: 60 + i, staff: 0, x: 100 + i * 60, top: 10, bottom: 200, width: 8 }] })),
    notes: Array.from({ length: n }, (_, i) => ({ midi: 60 + i, staff: 0, onsetQuarter: i, durationQuarters: 1 })),
    measures: Array.from({ length: n }, (_, i) => ({ index: i, number: i + 1, firstStep: i, lastStep: i })),
  });

  /** Same shape but a GRAND staff: each measure's note doubled an octave down on staff 1. */
  const grandTierFixture = (n, tempoMult) => ({
    tempoEntries: [{ onsetQuarter: 0, bpm: 60 / tempoMult }],
    events: Array.from({ length: n }, (_, i) => ({ midi: 60 + i, midis: [60 + i, 48 + i], onsetQuarter: i, x: 100 + i * 60, top: 10, bottom: 200, system: 0 })),
    steps: Array.from({ length: n }, (_, i) => ({
      onsetQuarter: i,
      measure: i,
      notes: [
        { midi: 60 + i, staff: 0, x: 100 + i * 60, top: 10, bottom: 200, width: 8 },
        { midi: 48 + i, staff: 1, x: 100 + i * 60, top: 120, bottom: 300, width: 8 },
      ],
    })),
    notes: Array.from({ length: n }, (_, i) => [
      { midi: 60 + i, staff: 0, onsetQuarter: i, durationQuarters: 1 },
      { midi: 48 + i, staff: 1, onsetQuarter: i, durationQuarters: 1 },
    ]).flat(),
    measures: Array.from({ length: n }, (_, i) => ({ index: i, number: i + 1, firstStep: i, lastStep: i })),
  });

  const pickTempo = (label) => {
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^tempo/i })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) })); });
  };
  const pressPlay = async () => {
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
  };
  const position = () => screen.getByTestId('score-position').textContent;

  // Polish runs a SILENT step timeline — pauseForRebuild must not panic a piano
  // the kiosk never played through while the player is holding keys (Task 4).
  // holdLayout keeps the stub's re-engrave publish pending (M3's resume gate),
  // so the rebuild-resume effect can't race in and cancel the delayed panic
  // before the assertion — isolating pauseForRebuild's own guard.
  it('a transpose during a silent Polish run sends no panic — Polish never sounds through the kiosk', async () => {
    h.layoutExtras = tierFixture(3, 1);
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS)); // run active, transport ticking silently
    h.sendPanic.mockClear();                        // drain anything the entry path sent
    h.holdLayout = true;
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Key' })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /\+1/ })); }); // → pauseForRebuild('transpose')
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull(); // paused, held for the re-engrave
    act(() => vi.advanceTimersByTime(1000));
    expect(h.sendPanic).not.toHaveBeenCalled();
  });

  it('a completed run at 80% banks the medium tier best for the bucket, and the summary shows the run + all four bests (spec 1)', async () => {
    // Three measures, all played dead on the beat → every combined is 1.0 → 100.
    h.layoutExtras = tierFixture(3, 0.8);
    h.practice = { polish: { both: { slow: 78, medium: 84 } } }; // prior history
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS)); // count-in exactly → play() fires step 0 at drift 0
    play(60);
    act(() => vi.advanceTimersByTime(1000)); // → step 1 (grades m0)
    play(61);
    play(62); // the closing note, rolled in before the tick that ends the run
    act(() => vi.advanceTimersByTime(1000)); // → final step + onDone (finalize grades m1 AND m2)

    expect(document.querySelector('.piano-score-run-summary')).not.toBeNull();
    expect(h.recordTierBest).toHaveBeenCalledTimes(1);
    expect(h.recordTierBest).toHaveBeenCalledWith({ bucket: 'both', tier: 'medium', score: 100 });
    // The panel reports THIS run and the bucket's bests — the seeded 78/84 plus
    // two never-run tiers.
    expect(document.querySelector('.piano-score-run-score__value').textContent).toBe('100');
    expect(document.querySelector('.piano-score-run-score__tier').textContent).toBe('medium');
    const cells = [...document.querySelectorAll('.piano-score-run-tier__value')].map((n) => n.textContent);
    expect(cells).toEqual(['78', '84', '—', '—']);
    expect(document.querySelector('.piano-score-run-tier--current .piano-score-run-tier__value').textContent).toBe('84');
  });

  it('an RH-only run banks polish.rh, never polish.both — and the strip shows the rh bests (spec 2)', async () => {
    h.layoutExtras = grandTierFixture(3, 0.8);
    // Seeded so a bucket mix-up is visible: 'both' bests would render 11/22.
    h.practice = { polish: { rh: { medium: 84 }, both: { slow: 11, medium: 22 } } };
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Left hand' })); }); // both → rh
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60);
    act(() => vi.advanceTimersByTime(1000));
    play(61);
    play(62);
    act(() => vi.advanceTimersByTime(1000)); // → onDone

    expect(h.recordTierBest).toHaveBeenCalledTimes(1);
    const call = h.recordTierBest.mock.calls[0][0];
    expect(call.bucket).toBe('rh');
    expect(call.tier).toBe('medium');
    // Only the RH notes were expected (LH is inactive), and all three were played.
    expect(call.score).toBe(100);
    const cells = [...document.querySelectorAll('.piano-score-run-tier__value')].map((n) => n.textContent);
    expect(cells).toEqual(['—', '84', '—', '—']); // the rh bucket's bests, not both's
    expect(screen.getByText(/right hand/i)).toBeInTheDocument();
  });

  it('a mid-run tempo change voids the run: the summary says mixed tempo and NO best is written (spec 3)', async () => {
    h.layoutExtras = tierFixture(3, 0.8);
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60);
    act(() => vi.advanceTimersByTime(1000));
    pickTempo('125%'); // mid-run tempo change → tier bests are no longer comparable
    play(61);
    play(62);
    act(() => vi.advanceTimersByTime(2000)); // let the (now rescaled) run finish → onDone

    expect(document.querySelector('.piano-score-run-summary')).not.toBeNull();
    expect(screen.getByText(/mixed tempo/i)).toBeInTheDocument();
    expect(h.recordTierBest).not.toHaveBeenCalled();
    // Live grades still flow — voiding is about persistence, not feedback.
    expect(document.querySelector('.piano-score-run-score__value')).not.toBeNull();
  });

  it('the voiding flag is scoped to a run: a tempo change made BEFORE Play does not void the next run', async () => {
    // runMixedRef must be armed by the run, not by the session — otherwise the
    // first tempo pick a user ever makes would poison every run that follows.
    h.layoutExtras = tierFixture(3, 0.8);
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('125%'); // …changed their mind…
    pickTempo('80%');  // …twice, all before pressing Play
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60);
    act(() => vi.advanceTimersByTime(1000));
    play(61);
    play(62);
    act(() => vi.advanceTimersByTime(1000));

    expect(screen.queryByText(/mixed tempo/i)).toBeNull();
    expect(h.recordTierBest).toHaveBeenCalledWith({ bucket: 'both', tier: 'medium', score: 100 });
  });

  // The bank/withhold decision is invisible in the field without its own event:
  // voided, not-an-improvement and guest all look identical from the outside (no
  // write, no complaint). Each must name itself.
  const tierBestEvents = (emitted) => emitted.filter(([ev]) => ev === 'score.polish.tier-best').map(([, d]) => d);

  it('logs the bank decision on a clean completion (banked: true)', async () => {
    h.layoutExtras = tierFixture(3, 0.8);
    const emitted = captureTierLog();
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60);
    act(() => vi.advanceTimersByTime(1000));
    play(61);
    play(62);
    act(() => vi.advanceTimersByTime(1000));

    expect(tierBestEvents(emitted)).toEqual([
      { bucket: 'both', tier: 'medium', score: 100, banked: true, reason: 'banked' },
    ]);
  });

  it('logs banked: false with reason "mixed" when a mid-run tempo change voided the run', async () => {
    h.layoutExtras = tierFixture(3, 0.8);
    const emitted = captureTierLog();
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60);
    act(() => vi.advanceTimersByTime(1000));
    pickTempo('125%');
    play(61);
    play(62);
    act(() => vi.advanceTimersByTime(2000));

    const events = tierBestEvents(emitted);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ banked: false, reason: 'mixed', tier: 'medium' });
    // The score is still reported — the run HAD a score, it just cannot be banked.
    expect(events[0].score).toBeGreaterThan(0);
    expect(h.recordTierBest).not.toHaveBeenCalled();
  });

  it('the live score readout keeps the RUN\'s tier across a mid-run tempo change — no overclock credit on a voided run', async () => {
    h.layoutExtras = tierFixture(3, 1);
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    await pressPlay();                        // 100% — tier 'full', no multiplier
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60);
    act(() => vi.advanceTimersByTime(1000));  // m0 graded — a live base score exists
    const before = position().split(' · ')[0]; // e.g. "100%"
    pickTempo('125%');                        // voids the run; the live knob is now 'overclocked'
    expect(position().split(' · ')[0]).toBe(before); // the readout must NOT jump ×1.25
  });

  it('logs reason "not-better" when the run did not beat the stored best (and skips the write)', async () => {
    h.layoutExtras = tierFixture(3, 0.8);
    h.practice = { polish: { both: { medium: 100 } } }; // already perfect at this tier
    const emitted = captureTierLog();
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60);
    act(() => vi.advanceTimersByTime(1000));
    play(61);
    play(62);
    act(() => vi.advanceTimersByTime(1000));

    expect(tierBestEvents(emitted)).toEqual([
      { bucket: 'both', tier: 'medium', score: 100, banked: false, reason: 'not-better' },
    ]);
    expect(h.recordTierBest).not.toHaveBeenCalled();
  });

  it('logs reason "guest" when nothing can persist, so a guest is not read as a non-improvement', async () => {
    h.layoutExtras = tierFixture(3, 0.8);
    h.practicePersistent = false; // guest / no user
    const emitted = captureTierLog();
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60);
    act(() => vi.advanceTimersByTime(1000));
    play(61);
    play(62);
    act(() => vi.advanceTimersByTime(1000));

    expect(tierBestEvents(emitted)).toEqual([
      { bucket: 'both', tier: 'medium', score: 100, banked: false, reason: 'guest' },
    ]);
    expect(h.recordTierBest).not.toHaveBeenCalled();
  });

  it('logs reason "nothing-graded" for a completion with no gradeable measure', async () => {
    // A rest-only / never-touched piece completes with runScore null. There is no
    // score to bank, and that is not the same as failing to improve.
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 / 0.8 }],
      events: [{ midi: 60, midis: [60], onsetQuarter: 0, x: 100, top: 10, bottom: 200, system: 0 }],
      steps: [{ onsetQuarter: 0, measure: 0, notes: [] }], // a rest bar: nothing expected
      notes: [{ midi: 60, staff: 0, onsetQuarter: 0, durationQuarters: 1 }],
      measures: [{ index: 0, number: 1, firstStep: 0, lastStep: 0 }],
    };
    const emitted = captureTierLog();
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    act(() => vi.advanceTimersByTime(1000)); // → onDone

    expect(tierBestEvents(emitted)).toEqual([
      { bucket: 'both', tier: 'medium', score: null, banked: false, reason: 'nothing-graded' },
    ]);
    expect(h.recordTierBest).not.toHaveBeenCalled();
  });

  it('the run summary log carries the tier outcome on every path that opens the panel', async () => {
    // score.polish.summary is the ONE event a field reader has for a run. It must
    // say what the run scored and at which tier, on the completion path AND on the
    // pause path (which shows a score but banks nothing).
    h.layoutExtras = tierFixture(4, 0.8);
    const emitted = captureTierLog();
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60);
    act(() => vi.advanceTimersByTime(1000)); // m0 graded 1.0
    act(() => { screen.getByRole('button', { name: 'Pause' }).click(); });
    await act(async () => {});

    const summaries = emitted.filter(([ev]) => ev === 'score.polish.summary').map(([, d]) => d);
    expect(summaries.length).toBe(1);
    // m0 played clean (1.0); the pause FINALIZES the measure in progress, which had
    // nothing played in it yet (0.0) — mean 0.5 → 50. The point is that the score
    // and tier ship at all on this path, and that they match the tally beside them.
    expect(summaries[0]).toMatchObject({ score: 50, tier: 'medium', mixed: false, greens: 1, reds: 1 });
    // …and no bank decision at all: a pause is not a completion.
    expect(tierBestEvents(emitted)).toEqual([]);
  });

  it('the summary log reports mixed: true for a voided run', async () => {
    h.layoutExtras = tierFixture(3, 0.8);
    const emitted = captureTierLog();
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60);
    act(() => vi.advanceTimersByTime(1000));
    pickTempo('125%');
    play(61);
    play(62);
    act(() => vi.advanceTimersByTime(2000));

    const summaries = emitted.filter(([ev]) => ev === 'score.polish.summary').map(([, d]) => d);
    expect(summaries.length).toBe(1);
    expect(summaries[0]).toMatchObject({ mixed: true, tier: 'medium' });
    expect(summaries[0].score).toBeGreaterThan(0); // graded, just not bankable
  });

  it('an open summary keeps describing the run it reported, even once the NEXT run has started', async () => {
    // Play does not dismiss the panel, and starting a run re-arms the tier/void
    // state. If the panel read those live it would silently re-label a finished,
    // VOIDED run as a clean one at the new tempo — a best the user never earned,
    // shown next to a run that never earned it.
    h.layoutExtras = tierFixture(4, 0.8);
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60);
    act(() => vi.advanceTimersByTime(1000));
    pickTempo('125%'); // void this run
    play(61);
    play(62);
    play(63);
    act(() => vi.advanceTimersByTime(3000)); // finish it → voided summary
    expect(screen.getByText(/mixed tempo/i)).toBeInTheDocument();

    // A fresh run: onGo re-arms runTierRef/runMixedRef while the panel is still up.
    await pressPlay();
    act(() => vi.advanceTimersByTime(3200)); // count-in at 125% (48bpm base → 60 eff) → onGo
    expect(screen.getByText(/mixed tempo/i)).toBeInTheDocument(); // still the OLD run's report
  });

  it('a silent-stop shows the summary but banks NO best (spec 4)', async () => {
    // Seven silent measures: the 4th consecutive silent one trips the auto-stop.
    // The run never reached the end, so it is not a comparable whole-piece score.
    h.layoutExtras = tierFixture(7, 0.8);
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    for (let i = 0; i < 5; i++) act(() => vi.advanceTimersByTime(1000)); // 4 silent measures → stop

    expect(document.querySelector('.piano-score-run-summary')).not.toBeNull();
    expect(h.recordTierBest).not.toHaveBeenCalled();
  });

  it('a manual pause shows the summary but banks NO best (spec 4)', async () => {
    h.layoutExtras = tierFixture(5, 0.8);
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60);
    act(() => vi.advanceTimersByTime(1000)); // one graded measure — a real, scored partial run
    play(61);
    act(() => { screen.getByRole('button', { name: 'Pause' }).click(); });
    await act(async () => {});

    expect(document.querySelector('.piano-score-run-summary')).not.toBeNull();
    expect(document.querySelector('.piano-score-run-score__value')).not.toBeNull(); // it DOES have a score…
    expect(h.recordTierBest).not.toHaveBeenCalled();                                // …but banks nothing
  });

  it('an overclocked completed run earns the 1.25 multiplier (spec 6)', async () => {
    // Two measures, mean combined 0.9 → base 90 → overclocked stores round(90 × 1.25) = 113.
    // m0 is a five-note chord with only FOUR played (noteScore 0.8, timing perfect);
    // m1 is a single note played clean (1.0). The multiplier itself is pinned in
    // polishTiers.test.js — what this proves is that the RUN's tier reaches it.
    const CHORD = [60, 62, 64, 65, 67];
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 / 1.25 }], // 48bpm → 1000ms scaled quarter
      events: [
        { midi: 60, midis: CHORD, onsetQuarter: 0, x: 100, top: 10, bottom: 200, system: 0 },
        { midi: 72, midis: [72], onsetQuarter: 1, x: 160, top: 10, bottom: 200, system: 0 },
      ],
      steps: [
        { onsetQuarter: 0, measure: 0, notes: CHORD.map((m) => ({ midi: m, staff: 0, x: 100, top: 10, bottom: 200, width: 8 })) },
        { onsetQuarter: 1, measure: 1, notes: [{ midi: 72, staff: 0, x: 160, top: 10, bottom: 200, width: 8 }] },
      ],
      notes: [...CHORD.map((m) => ({ midi: m, staff: 0, onsetQuarter: 0, durationQuarters: 1 })),
        { midi: 72, staff: 0, onsetQuarter: 1, durationQuarters: 1 }],
      measures: [
        { index: 0, number: 1, firstStep: 0, lastStep: 0 },
        { index: 1, number: 2, firstStep: 1, lastStep: 1 },
      ],
    };
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('125%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    for (const n of [60, 62, 64, 65]) play(n); // four of five — the fifth is missed
    play(72);                                  // …and m1's note, rolled in on the same beat
    act(() => vi.advanceTimersByTime(1000));   // → final step + onDone

    expect(h.recordTierBest).toHaveBeenCalledWith({ bucket: 'both', tier: 'overclocked', score: 113 });
    expect(document.querySelector('.piano-score-run-score__value').textContent).toBe('113');
    expect(document.querySelector('.piano-score-run-score__tier').textContent).toBe('overclocked');
  });

  it('the bar readout leads with the live run score once a measure is graded (spec 5)', async () => {
    // Four measures, so the readout is observed MID-run: a 3-measure fixture would
    // complete on the second advance and send the cursor home (audit H2).
    h.layoutExtras = tierFixture(4, 0.8);
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    expect(position()).toBe('m 1 / 4'); // nothing graded yet → plain position
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60);
    expect(position()).toBe('m 1 / 4'); // still nothing GRADED — a hit is not a grade
    act(() => vi.advanceTimersByTime(1000)); // the boundary grades m0 → 100
    expect(position()).toBe('100% · m 2 / 4');
    // A wrong note in m1 drags the running mean down: (1.0 + 0.0) / 2 = 50.
    play(99);
    act(() => vi.advanceTimersByTime(1000));
    expect(position()).toBe('50% · m 3 / 4');
  });

  it('a guest / historyless record renders every tier as unset rather than zero', async () => {
    // h.practice is {} — polish.<bucket> is absent. Four em dashes, no zeros: a
    // tier that was never run is not a tier scored nothing.
    h.layoutExtras = tierFixture(3, 0.8);
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60);
    act(() => vi.advanceTimersByTime(1000));
    play(61);
    play(62);
    act(() => vi.advanceTimersByTime(1000));

    const cells = [...document.querySelectorAll('.piano-score-run-tier__value')].map((n) => n.textContent);
    expect(cells).toEqual(['—', '—', '—', '—']);
  });

  // ── A bank requires a COMPLETED WHOLE-PIECE run (design §H) ─────────────────
  // Reaching onDone's completion branch proves only that the run ENDED at the last
  // step. Four ways to end there without having played the whole piece at one
  // tempo on one pair of hands used to bank anyway — and a best only ever
  // improves, so every one of them was a permanent, unrecoverable inflation.
  const tierBestOnly = (emitted) => emitted.filter(([ev]) => ev === 'score.polish.tier-best').map(([, d]) => d);

  it('a run started by seeking into the piece banks nothing — reason "partial" (§H path a)', async () => {
    // The cheat: tap the third measure, play the tail clean, collect a 100. The
    // score is real for what it graded; it is just not a score for THIS PIECE.
    h.layoutExtras = tierFixture(4, 0.8);
    const emitted = captureTierLog();
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    tapScore(160); // measure 2's column (x = 100 + 1 × 60) → cursor seeks off the top
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(61);
    act(() => vi.advanceTimersByTime(1000)); // → step 2 (grades m1)
    play(62);
    play(63);
    act(() => vi.advanceTimersByTime(1000)); // → final step + onDone

    const events = tierBestOnly(emitted);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ bucket: 'both', tier: 'medium', banked: false, reason: 'partial' });
    expect(events[0].score).toBeGreaterThan(0); // it DID grade a clean tail — that is the whole hazard
    expect(h.recordTierBest).not.toHaveBeenCalled();
  });

  it('a tempo change taken while PAUSED banks nothing, even though the resume re-captures the tier (§H path b)', async () => {
    // `mixed` only watches an ACTIVE run, so a pause hides the tempo change from
    // it, and the resume's count-in re-freezes runTierRef at the new speed: half
    // the piece at 80% banked as a clean run at 125%.
    h.layoutExtras = tierFixture(4, 0.8);
    const emitted = captureTierLog();
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60);
    act(() => vi.advanceTimersByTime(1000)); // m0 graded at 80%
    act(() => { screen.getByRole('button', { name: 'Pause' }).click(); });
    await act(async () => {});
    pickTempo('125%'); // …and now the rest of the piece is a different exercise
    await pressPlay();
    act(() => vi.advanceTimersByTime(2560)); // count-in at 125% (93.75 eff bpm → 4 × 640ms)
    play(61);
    act(() => vi.advanceTimersByTime(700));
    play(62);
    play(63);
    act(() => vi.advanceTimersByTime(1400)); // → the end at the new tempo → onDone

    const events = tierBestOnly(emitted);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ banked: false, reason: 'partial' });
    expect(events[0].score).toBeGreaterThan(0);
    expect(h.recordTierBest).not.toHaveBeenCalled();
  });

  it('a tempo change taken in a view-rebuild gap banks nothing — the tier would be stale (§H path c)', async () => {
    // pauseForRebuild also drops runActive, so the same blind spot opens during a
    // zoom/flow/transpose re-engrave — and unlike path b nothing re-captures the
    // tier at all: the whole run would bank under the tier it STARTED at, at a
    // tempo it was never played at. No measure has been graded yet when the tempo
    // moves, so only the pending-resume signal can catch this one.
    h.layoutExtras = tierFixture(4, 0.8);
    const emitted = captureTierLog();
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS)); // running, step 0, nothing graded

    // Flow change → pauseForRebuild. The stub keeps reporting flow 'wrapped', so
    // the layout stays stale and the resume waits (same lever as the H5/M3 tests).
    fireEvent.click(screen.getByRole('button', { name: /view options/i }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^across$/i })); });
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull(); // paused for the re-engrave
    // Close the View sheet before touching Tempo: its zoom ladder carries its own
    // '125%' step, which would make the tempo pick ambiguous.
    act(() => { fireEvent.click(screen.getByRole('button', { name: /view options/i })); });
    pickTempo('125%'); // the gap the void check cannot see
    act(() => { fireEvent.click(screen.getByRole('button', { name: /view options/i })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /down the page/i })); }); // layout lands → resume

    play(60);
    act(() => vi.advanceTimersByTime(700)); // 125% → 640ms steps
    play(61);
    act(() => vi.advanceTimersByTime(700));
    play(62);
    play(63);
    act(() => vi.advanceTimersByTime(700)); // → onDone

    const events = tierBestOnly(emitted);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ banked: false, reason: 'partial' });
    expect(h.recordTierBest).not.toHaveBeenCalled();
  });

  it('a mid-run hands change banks nothing — both-hands measures must not land in the rh bucket (§H path d)', async () => {
    // The bucket is read at the END of the run, so dropping a hand mid-run filed
    // both-hands grades under `rh` — a best in a bucket the run never belonged to.
    h.layoutExtras = grandTierFixture(4, 0.8);
    const emitted = captureTierLog();
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60); play(48); // m0 played with BOTH hands
    act(() => vi.advanceTimersByTime(1000));
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Left hand' })); }); // both → rh, mid-run
    play(61);
    act(() => vi.advanceTimersByTime(1000));
    play(62);
    play(63);
    act(() => vi.advanceTimersByTime(1000)); // → onDone

    const events = tierBestOnly(emitted);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ bucket: 'rh', banked: false, reason: 'partial' });
    expect(h.recordTierBest).not.toHaveBeenCalled();
  });

  it('a pause and a same-tempo resume is still ONE whole-piece run — it banks (§H positive control)', async () => {
    // The gate must not become "never pause": stopping to shake out a hand and
    // picking the same run back up at the same tempo, on the same hands, is the
    // ordinary way a piece gets played.
    h.layoutExtras = tierFixture(4, 0.8);
    const emitted = captureTierLog();
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60);
    act(() => vi.advanceTimersByTime(1000));
    act(() => { screen.getByRole('button', { name: 'Pause' }).click(); });
    await act(async () => {});
    await pressPlay(); // same tempo, same hands, same run
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(61);
    act(() => vi.advanceTimersByTime(1000));
    play(62);
    play(63);
    act(() => vi.advanceTimersByTime(1000)); // → onDone

    const events = tierBestOnly(emitted);
    expect(events[events.length - 1]).toMatchObject({ bucket: 'both', tier: 'medium', banked: true, reason: 'banked' });
    expect(h.recordTierBest).toHaveBeenCalledTimes(1);
    expect(h.recordTierBest.mock.calls[0][0]).toMatchObject({ bucket: 'both', tier: 'medium' });
  });

  it('a tempo change made between runs does not disqualify the NEXT full run', async () => {
    // The clears must cost only the run they belong to: after a completed run the
    // grades are still on the board, and bumping the tempo for another go from the
    // top is exactly how the tiers are meant to be climbed.
    h.layoutExtras = tierFixture(3, 0.8);
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60);
    act(() => vi.advanceTimersByTime(1000));
    play(61);
    play(62);
    act(() => vi.advanceTimersByTime(1000)); // run 1 → banks medium
    expect(h.recordTierBest).toHaveBeenCalledTimes(1);

    // onDone parked the cursor back home, so this is a fresh run from the top.
    pickTempo('125%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(2560)); // count-in at 125% (93.75 eff bpm → 4 × 640ms)
    play(60);
    act(() => vi.advanceTimersByTime(700));
    play(61);
    play(62);
    act(() => vi.advanceTimersByTime(700)); // → onDone

    expect(h.recordTierBest).toHaveBeenCalledTimes(2);
    expect(h.recordTierBest.mock.calls[1][0]).toMatchObject({ bucket: 'both', tier: 'overclocked' });
  });

  it('a manual pause opens the summary with no current-tier highlight — a partial run belongs to no column', async () => {
    h.layoutExtras = tierFixture(3, 0.8);
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60);
    act(() => vi.advanceTimersByTime(1000)); // one measure graded — a real partial run
    screen.getByRole('button', { name: 'Pause' }).click(); // → toggleRun's finalize+open path
    await act(async () => {});
    expect(document.querySelector('.piano-score-run-summary')).not.toBeNull();
    expect(document.querySelectorAll('.piano-score-run-tier--current').length).toBe(0);
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
    // Loop measure 2 only (tail measure — what would exercise the onDone wrap
    // path), armed in Learn: Listen has no loop chrome of its own (§F).
    enterLearnGate(160);
    pickMode('Listen');
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Toggle loop' })).toBeNull(); // released with its chrome
    expect(screen.getByText('m 2 / 2')).toBeTruthy(); // where the range left the cursor
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
    // The transport's loop-wrap branch is deleted outright: `range` is
    // Learn-only, and Learn's gate runs the transport with an empty timeline,
    // so no mode can ever reach onDone (or onEvent's step handler) with a
    // non-null range — no transport wrap can exist. This test survives as
    // the regression guard: nothing may restart itself after a tail-measure
    // run in Listen, and `score.transport.loop-wrap` (the log event the
    // deleted branch used to emit) must never be seen again — the `wraps()`
    // checks below now guard against reintroduction, not a live code path.
    //
    // The fixture keeps its zero-span shape (m2, the tail measure, has no
    // note entries at all, at either staff) because that shape is exactly
    // what the deleted loop-wrap machinery had to handle correctly. It also
    // means THIS run never calls sendNoteAt even when it genuinely plays —
    // so proof the run wasn't silently skipped is log-based
    // (`score.transport.play` / `score.transport.done`), not audio; the
    // "nothing happened after" negatives are only non-vacuous once that's
    // established.
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
    const hasEvent = (name) => emitted.some(([ev]) => ev === name);

    renderPlayer();
    // Loop measure 2 only (tail measure — the zero-span case), armed in Learn:
    // Listen holds no range, and after wave-3 F it has no loop chrome either.
    enterLearnGate(160);
    pickMode('Listen');
    await act(async () => {});
    expect(screen.getByText('m 2 / 2')).toBeTruthy(); // where the range left the cursor
    screen.getByRole('button', { name: 'Play' }).click(); // Listen always plays immediately (no count-in — wave-3 A)
    await act(async () => {});
    act(() => vi.advanceTimersByTime(200)); // where wave-2 armed the zero-span dwell
    expect(wraps()).toEqual([]);            // …nothing is armed: Listen holds no range
    // Non-vacuous anchor (log-based — see the comment above): the run really
    // started and really reached onDone, so the negatives below aren't
    // guarding against a run that never happened at all.
    expect(hasEvent('score.transport.play')).toBe(true);
    expect(hasEvent('score.transport.done')).toBe(true);
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
  // Plant the in-point on the note at `clientX` — a ONE-measure range (§F) — then
  // turn the loop on: range + loop ON is the gate.
  const armLoopAt = (clientX) => { armAndTap('in', clientX); toggleLoop(); };
  // A multi-measure range: in-point at x1, then move the out-point to x2.
  const armLoopSpan = (x1, x2) => { armAndTap('in', x1); armAndTap('out', x2); toggleLoop(); };
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
    // EXACTLY one subscriber, and it is the neutral wet ink (wave-3 D) — the
    // follow tracker is not on the bus at all. The count is the load-bearing
    // assertion: it is what fails if the tracker's `enabled` is ever widened from
    // `learnGate` to `mode === 'learn'`, which the behavioural checks below cannot
    // catch on their own (a second subscriber is invisible to them).
    expect(h.noteCbs.size).toBe(1);
    play(61); // a wrong note against step 0 (E4/E2)
    expect(document.querySelector('.piano-learn-ink__note.is-neutral')).not.toBeNull(); // ink is the one subscriber
    expect(document.querySelector('.piano-score-cursor.is-wrong')).toBeNull();
    expect(document.querySelector('.piano-learn-ink__note.is-wrong')).toBeNull();
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
    // Exactly one subscriber here too — the TRACKER. The wet-ink effect gates on
    // machineLearn, so the gate row inks via the tracker's own hit/wrong callbacks
    // rather than a second subscription.
    expect(h.noteCbs.size).toBe(1);
    play(64); play(40);                          // all active-staff notes of step 0
    expect(pos()).toContain('m 2 / 3');           // …advances the cursor
    play(63);                                     // a plausible wrong note flashes — the gate is armed
    expect(document.querySelector('.piano-score-cursor.is-wrong')).not.toBeNull();
  });

  // ── Spec 3: range + loop OFF = machine playback of the whole piece ──────────
  it('Learn with a range but the loop OFF plays the WHOLE piece, handles still visible', async () => {
    h.layoutExtras = THREE;
    await enterLearnFresh();
    armLoopAt(160); // one-measure range on m2 — cursor jumps to the in-point
    expect(pos()).toContain('m 2 / 3');
    toggleLoop(); // loop OFF, range kept
    expect(loopSpan()).toBe('m2–m2');
    expect(document.querySelectorAll('.piano-score-range-handle').length).toBe(2); // the ends are the handles now (wave-3 F)
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
    armLoopAt(160);  // range on m2
    toggleLoop();    // …loop OFF
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 220, clientY: 100 }); });    // seek to m3
    expect(pos()).toContain('m 3 / 3');
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(100));
    expect(h.sendNoteAt).toHaveBeenCalled(); // machine playback is running
    h.sendPanic.mockClear();
    h.sendNoteAt.mockClear();

    toggleLoop(); // loop back ON
    expect(h.sendPanic).toHaveBeenCalled(); // silenced
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
    expect(h.noteCbs.size).toBe(1); // the tracker, alone
    toggleLoop(); // loop OFF
    // The tracker actually UNSUBSCRIBED — still exactly one subscriber, but now it
    // is the neutral wet ink (wave-3 D), which gates nothing. Without the count,
    // "tracker gone, ink here" and "tracker still here, ink stacked on top" look
    // identical from the DOM.
    expect(h.noteCbs.size).toBe(1);
    play(63);
    expect(document.querySelector('.piano-score-cursor.is-wrong')).toBeNull();
    expect(document.querySelector('.piano-learn-ink__note.is-neutral')).not.toBeNull();
    expect(pos()).toContain('m 2 / 3');                            // cursor stays where it was
    expect(screen.getByRole('button', { name: 'Play' })).not.toBeDisabled();
  });

  // ── Spec 6: loop/focus is Learn-only state ──────────────────────────────────
  // Task 14 layers a fresh auto-pick on top of this: a blank Learn re-entry now
  // immediately lands on a NEW range (see "a full Listen→Learn round trip
  // re-fires the auto-pick" further down for that behavior). This spec isolates
  // the ORIGINAL claim under test — the user's OLD armed range/loop state does
  // not survive the round trip — by clearing each re-entry's auto-pick right
  // away, so what's left to assert is "nothing OLD came back".
  it('entering Listen or Polish clears the user-armed range AND the loop toggle; the OLD range never survives a round trip back into Learn', async () => {
    h.layoutExtras = THREE;
    await enterLearnFresh();
    armLoopAt(160);
    expect(loopSpan()).toBe('m2–m2');
    expect(loopToggle()).toHaveAttribute('aria-pressed', 'true');

    pickMode('Listen');
    // The whole cluster leaves with the range it described (§F): Listen cannot
    // hold one, so there is no loop chrome to read a stale label off.
    expect(screen.queryByRole('button', { name: 'Toggle loop' })).toBeNull();
    pickMode('Learn');
    clearAutoRange(); // isolate the OLD-range claim from Task 14's fresh auto-pick
    expect(loopSpan()).toBe('–');                                 // the OLD range did not come back
    expect(loopToggle()).toHaveAttribute('aria-pressed', 'false'); // …and neither did the loop toggle

    armLoopAt(160);
    expect(loopSpan()).toBe('m2–m2');
    pickMode('Polish');                                            // Polish grades whole-piece only
    expect(screen.queryByRole('button', { name: 'Toggle loop' })).toBeNull();
    pickMode('Learn');
    clearAutoRange();
    expect(loopSpan()).toBe('–');
  });

  it('Perform still releases the range (unchanged) — the OLD range never survives a round trip back into Learn', async () => {
    h.layoutExtras = THREE;
    await enterLearnFresh();
    armLoopAt(160);
    pickMode('Perform');
    pickMode('Learn');
    clearAutoRange(); // isolate the OLD-range claim from Task 14's fresh auto-pick
    expect(loopSpan()).toBe('–');
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
  // player is holding keys down, so a stray panic cuts off THEIR notes. The same
  // guard now covers stopForMatrixChange, onMode, AND pauseForRebuild: a quiet
  // matrix change (mount, arming a range, flipping the loop with nothing playing),
  // a silent mode switch, or a silent-run rebuild must send nothing at all; an
  // audible one must still flush.
  it('mounting the player sends no panic — nothing has played yet', async () => {
    h.layoutExtras = THREE;
    renderPlayer();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(1000)); // well past lookahead + 60ms
    expect(h.sendPanic).not.toHaveBeenCalled();
  });

  it('entering a mode on a silent kiosk sends no panic — held piano keys survive a mode switch', async () => {
    h.layoutExtras = THREE;
    await enterLearnFresh();               // a mode change with nothing sounding
    act(() => vi.advanceTimersByTime(1000)); // well past lookahead + 60ms
    expect(h.sendPanic).not.toHaveBeenCalled();
  });

  // Entering a mode is guarded too now (onMode) — on a silent kiosk it sends
  // nothing, so this is a plain settle before the matrix-change assertions below.
  const settleInSilentLearn = async () => {
    h.layoutExtras = THREE;
    await enterLearnFresh();
    act(() => vi.advanceTimersByTime(1000)); // settle
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
    toggleLoop(); // gate → machine
    toggleLoop(); // …and back
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
    armAndTap('in', 160); // range set → matrix change
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
    toggleLoop(); // state 3: loop OFF
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

// The ±1 nudge (and the LoopSheet it lived on) is retired by wave-3 F: an
// endpoint MOVES by arming that edge and tapping the new measure. The L2 claim
// itself is unchanged — one endpoint moves, the other stays.
describe('ScorePlayer — moving a loop endpoint (L2 successor)', () => {
  it('re-arming the out endpoint grows the loop by one measure, leaving the in-point alone', () => {
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
    enterLearn(); // this spec arms its own loop from a blank entry
    armAndTap('in', 100); // a one-measure loop at m1
    expect(loopSpan()).toBe('m1–m1');
    armAndTap('out', 160); // move the END to m2
    expect(loopSpan()).toBe('m1–m2');
  });
});

// Wave-3 F REVERSES the L3 threshold: endpoint picking has no near-a-note radius
// (see measureAtPoint), because a coarse gesture that dies in the whitespace after
// a system reads as a dead screen. What replaces the distance rule is a BAND rule —
// only a tap outside every system's vertical extent is refused. The exact tap the
// old rule swallowed is asserted here to commit.
describe('ScorePlayer — armed-tap rejection is a dead margin, not a distance (L3 reversed)', () => {
  it('commits a far-right in-system tap, and refuses only a tap outside the staves', () => {
    h.layoutExtras = {
      // `events` is published explicitly so the geometry and the measure map cover
      // the SAME steps: the default 4-event fixture would leave steps 2-3 outside
      // this 2-measure map, and a tap resolving there has no measure to commit.
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
    enterLearn(); // this spec arms its own endpoint from a blank entry
    // A tap 800px right of the last note is still INSIDE that system's band, so it
    // resolves to the nearest measure column (m2) instead of being swallowed.
    armAndTap('in', 960);
    expect(loopSpan()).toBe('m2–m2');
    // A tap BELOW every staff is the only kind that is refused — and it says so
    // rather than looking like a dead screen (audit H4a).
    arm('out');
    tapScore(160, 600);
    expect(screen.getByText(/inside the music/i)).toBeInTheDocument();
    expect(loopSpan()).toBe('m2–m2'); // unchanged — nothing committed
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
    enterLearn(); // this spec arms its own endpoint from a blank entry
    arm('in');
    expect(screen.getByText(/loop start/i)).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(15001); }); // the user wandered off
    expect(screen.queryByText(/loop start/i)).toBeNull(); // banner gone — the arm expired

    // A tap now SEEKS (the whole point: an arm was gating tap-to-seek).
    tapScore(160);
    expect(screen.getByText('m 2 / 2')).toBeTruthy();
    expect(loopSpan()).toBe('–'); // …and it set no endpoint
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
  // in Learn does not survive the trip out. Task 14 layers a fresh auto-pick on
  // top of that: a blank re-entry now immediately lands on a NEW range (see "a
  // full Listen→Learn round trip re-fires the auto-pick" further down). This
  // spec isolates the underlying claim — the OLD range/cursor position does not
  // survive the round trip — by clearing each re-entry's auto-pick (via
  // `enterLearn`'s built-in `clearAutoRange`), so what's left is "from the top".
  it('re-enters from the top: leaving Learn released the OLD range that pinned the cursor (auto-pick cleared to isolate this)', () => {
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
    // Loop measures 2–3 (steps 1–2) with armed endpoints, looping on.
    armAndTap('in', 160);  // m2
    armAndTap('out', 220); // m3
    toggleLoop();
    expect(screen.getByTestId('score-position')).toHaveTextContent('m 2 / 4'); // at the in-point
    tapScore(280); // seek deeper (clamped to m3)
    expect(screen.getByTestId('score-position')).toHaveTextContent('m 3 / 4');
    pickMode('Listen');
    expect(screen.queryByRole('button', { name: 'Toggle loop' })).toBeNull(); // range released with its chrome
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
    expect(loopSpan()).toBe('m1–m2');                         // a range was picked…
    expect(loopToggle()).toHaveAttribute('aria-pressed', 'true'); // …and the loop is ON
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
    expect(loopSpan()).toBe('–');
    expect(emitted.filter(([ev]) => ev === 'score.learn.auto-range').length).toBe(1); // still just the one
  });

  // Leaving Learn always releases its range (wave-3 §0 — Learn-only state), so a
  // full Listen→Learn round trip lands on a BLANK Learn again — the exact arm
  // shape (`mode === 'learn' && !focus`) the landing keys off. Unlike the
  // mid-Learn clear above, THIS re-entry is a real mode TRANSITION into Learn,
  // which is what re-arms `learnAutoRef` — so the landing must fire again,
  // fresh, on every return trip, not just the first-ever entry.
  it('a full Listen→Learn round trip re-fires the auto-pick — leaving and returning lands on a FRESH range', async () => {
    h.layoutExtras = AUTO_TWO;
    const emitted = captureLog();
    renderPlayer(); // opens in Listen
    pickMode('Learn');
    await act(async () => {});
    expect(loopToggle()).toHaveAttribute('aria-pressed', 'true');
    expect(emitted.filter(([ev]) => ev === 'score.learn.auto-range').length).toBe(1);

    pickMode('Listen'); // Learn-only state (wave-3 §0) — leaving releases the range AND the loop
    expect(screen.queryByRole('button', { name: 'Toggle loop' })).toBeNull();

    pickMode('Learn'); // re-enter — a blank Learn again, so the landing fires again
    await act(async () => {});
    expect(loopSpan()).toBe('m1–m2');
    expect(loopToggle()).toHaveAttribute('aria-pressed', 'true');
    const picks = emitted.filter(([ev]) => ev === 'score.learn.auto-range').map(([, d]) => d);
    expect(picks).toEqual([
      { inMeasure: 0, outMeasure: 1, reason: 'fallback' },
      { inMeasure: 0, outMeasure: 1, reason: 'fallback' }, // a FRESH pick, not a stale replay
    ]);
  });
});

// ── Task 15: Learn hand preference (wave-3 E) ──────────────────────────────────
// user → household → 'both', applied once per fresh (no persisted activeParts)
// grand-staff score, clamped to a staff that actually carries notes. Also proves
// the seed lands BEFORE Task 14's auto-range frontier reads activeParts — a
// naive same-pass ordering would let the picker bucket off the PRE-seed hands.
describe('ScorePlayer — Learn hand preference (Task 15)', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); try { window.localStorage.clear(); } catch { /* no storage */ } });

  // Six measures, both staves carrying a note in every measure, so every
  // measure is "active" for whichever single hand ends up seeded — the only
  // thing that can move the picked frontier is WHICH bucket's pass history it
  // reads.
  const GRAND_SIX = {
    steps: [0, 1, 2, 3, 4, 5].map((m) => ({
      onsetQuarter: m,
      measure: m,
      notes: [
        { midi: 72 - m, staff: 0, x: 100 + m * 60, top: 10, bottom: 200, width: 8 }, // RH
        { midi: 48 + m, staff: 1, x: 100 + m * 60, top: 10, bottom: 200, width: 8 }, // LH
      ],
    })),
    measures: [0, 1, 2, 3, 4, 5].map((m) => ({ index: m, number: m + 1, firstStep: m, lastStep: m })),
  };
  // rh/both are both under-practiced from measure 0 (frontier would land at 0);
  // lh alone is caught up through measure 1 and under-practiced from measure 2 —
  // a bucket mix-up is very visible: {in:0,out:3} (wrong bucket) vs {in:2,out:5}
  // (lh bucket, correct).
  const passHistory = (m, bucket) => (bucket === 'lh' ? (m < 2 ? 5 : 1) : 1);
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

  it('seeds LH-only from the learnHands preference and the auto-range frontier follows the LH practice history', async () => {
    h.prefs.learnHands = 'lh';
    h.layoutExtras = GRAND_SIX;
    h.practice = {
      measures: Object.fromEntries([0, 1, 2, 3, 4, 5].map((m) => [String(m), {
        rh: { passes: passHistory(m, 'rh') },
        both: { passes: passHistory(m, 'both') },
        lh: { passes: passHistory(m, 'lh') },
      }])),
    };
    const emitted = captureLog();
    renderPlayer();
    pickMode('Learn');
    await act(async () => {});
    // Hands seeded to LH-only — the RIGHT hand toggle is un-pressed.
    expect(screen.getByRole('button', { name: 'Right hand' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Left hand' })).toHaveAttribute('aria-pressed', 'true');
    // …and the frontier picker read the SEEDED (lh) bucket's history, not the
    // pre-seed 'both' bucket — {in:0,out:3} would mean it read the wrong one.
    const picks = emitted.filter(([ev]) => ev === 'score.learn.auto-range').map(([, d]) => d);
    expect(picks).toEqual([{ inMeasure: 2, outMeasure: 5, reason: 'frontier' }]);
  });

  it('clamps to the content-bearing hand when the preferred hand has no notes anywhere (content clamp)', async () => {
    h.prefs.learnHands = 'lh';
    // Real 2-staff extraction can never produce an entirely note-free staff —
    // OSMD drops rests before a note ever reaches `layout.notes`
    // (collectOnsetNotes) — so a genuinely empty staff-1 can't coexist with
    // parts.length===2 under the real index pair {0,1}. To exercise the CLAMP
    // branch itself (the wanted staff carries nothing anywhere → fall back to
    // the staff that does), fabricate a grand-staff-shaped layout whose two
    // note-bearing staves are 0 (RH) and 2 (stand-in for "some other staff",
    // deliberately never 1/LH) — grandStaff only cares that exactly two
    // staves carry notes, not which two.
    h.layoutExtras = {
      steps: [{ onsetQuarter: 0, measure: 0, notes: [
        { midi: 72, staff: 0, x: 100, top: 10, bottom: 200, width: 8 },
        { midi: 48, staff: 2, x: 100, top: 10, bottom: 200, width: 8 },
      ] }],
      measures: [{ index: 0, number: 1, firstStep: 0, lastStep: 0 }],
    };
    renderPlayer();
    pickMode('Learn');
    await act(async () => {});
    // want=LH has no notes anywhere → clamps to the content-bearing hand (RH).
    expect(screen.getByRole('button', { name: 'Right hand' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Left hand' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('a score with persisted activeParts ignores the hand preference entirely', async () => {
    const score = { id: 'files:hp-persisted.musicxml', title: 'Persisted', musicXml: '<score/>' };
    window.localStorage.setItem(
      'daylight.piano.sm.files:hp-persisted.musicxml',
      JSON.stringify({ v: 1, activeParts: { 0: true, 1: true } }),
    );
    h.prefs.learnHands = 'lh'; // would seed LH-only on a FRESH score — must be ignored here
    h.layoutExtras = GRAND_SIX;
    render(<MemoryRouter><ScorePlayer score={score} /></MemoryRouter>);
    pickMode('Learn');
    await act(async () => {});
    // Both hands stay on — the restored choice, not the preference, won.
    expect(screen.getByRole('button', { name: 'Right hand' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Left hand' })).toHaveAttribute('aria-pressed', 'true');
  });

  // Review fix round 1, finding 1: the prefs GET is a fresh round-trip per user
  // switch while OSMD engraving is pure client-side after mount — a fast score
  // can report notes before the real learnHands preference resolves. The seed
  // must wait for prefsLoaded, not fire off the household default and latch.
  it('waits for prefs to load before seeding — a fast-engraving score does not seed off the household default early', async () => {
    h.prefsLoaded = false; // the GET is still in flight when the score engraves
    h.layoutExtras = GRAND_SIX;
    renderPlayer();
    pickMode('Learn');
    await act(async () => {});
    // Still unresolved — must NOT have seeded off 'both' (the household default)
    // and latched there; both hands stay on exactly as they started.
    expect(screen.getByRole('button', { name: 'Right hand' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Left hand' })).toHaveAttribute('aria-pressed', 'true');
    // Prefs resolve late, carrying the real per-user choice.
    h.prefs.learnHands = 'lh';
    h.prefsLoaded = true;
    act(() => { h.prefsListeners.forEach((fn) => fn()); });
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Right hand' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Left hand' })).toHaveAttribute('aria-pressed', 'true');
  });

  // Review fix round 1, finding 2: a manual hand pick (any mode, this session)
  // must outrank the resolved preference the first time Learn is entered —
  // seeding must never clobber a choice the user already made.
  it('a manual hand toggle in Listen wins over the preference — Learn does not overwrite it', async () => {
    h.prefs.learnHands = 'lh'; // would seed LH-only on Learn entry if nothing else intervened
    h.layoutExtras = GRAND_SIX;
    renderPlayer(); // opens in Listen
    await act(async () => {});
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Left hand' })); }); // manual: drop LH → RH-only
    expect(screen.getByRole('button', { name: 'Right hand' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Left hand' })).toHaveAttribute('aria-pressed', 'false');
    pickMode('Learn');
    await act(async () => {});
    // The manual pick (RH-only) survives — the lh preference is NOT applied.
    expect(screen.getByRole('button', { name: 'Right hand' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Left hand' })).toHaveAttribute('aria-pressed', 'false');
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

describe('ScorePlayer — staff dim (Task 8)', () => {
  afterEach(() => { cleanup(); });

  const dimmedIds = () => [...document.querySelectorAll('g.staffline.is-dimmed')].map((g) => g.id);

  it('dims the deselected staff in Learn and clears when reselected', async () => {
    renderPlayer(); // opens in Listen
    await act(async () => {});
    enterLearn();
    await act(async () => {});
    expect(dimmedIds()).toEqual([]);

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Left hand' })); }); // deselect LH
    // The LOWER staff specifically — a count alone would pass if we dimmed the
    // hand the player is actually using.
    expect(dimmedIds()).toEqual(['Piano0-2']);

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Left hand' })); }); // reselect LH
    expect(dimmedIds()).toEqual([]);
  });

  it('covers nothing — no mask element is rendered', async () => {
    renderPlayer();
    await act(async () => {});
    enterLearn();
    await act(async () => {});
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Left hand' })); });
    expect(document.querySelectorAll('.piano-score-staff-dim')).toHaveLength(0);
  });

  it('PianoApp.scss fades the staff group and keeps no mask rule', () => {
    // jsdom computes no stylesheet, so assert the source (same pattern as the
    // .piano-note-hit colour check above).
    const scss = readFileSync(fileURLToPath(new URL('../../../../../Apps/PianoApp.scss', import.meta.url)), 'utf8');
    expect(scss).toMatch(/g\.staffline\.is-dimmed\s*\{[^}]*opacity/);
    expect(scss).not.toContain('.piano-score-staff-dim');
  });
});

// Learn wet ink (wave-3 D): a wrong note draws the PLAYED pitch in red on the
// staff, so "no" also answers "then what did I play?". The keyboard reveal moves
// onto a 3-consecutive-wrongs budget — help when genuinely stuck, not a spoiler
// on the first fumble.
describe('ScorePlayer — Learn wet ink + reveal budget (wave-3 D)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
    vi.setSystemTime(0);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  const ink = (kind) => document.querySelectorAll(`.piano-learn-ink__note.is-${kind}`);
  const targets = () => document.querySelectorAll('.piano-key.target');

  it('inks a wrong note red at the played pitch, and the mark expires on its own', async () => {
    renderPlayer();
    await act(async () => {});
    enterLearnGate();
    expect(document.querySelector('svg.piano-learn-ink')).toBeNull(); // nothing played yet

    play(63); // a plausible wrong note against step 0's E4 (within 2 octaves)
    expect(document.querySelectorAll('svg.piano-learn-ink')).toHaveLength(1); // ONE svg node, always
    expect(ink('wrong')).toHaveLength(1);
    // Spelled from the SOUNDING key — 63 in C major is D#/Eb, so the glyph carries
    // an accidental (the whole point: it names the pitch that was played).
    expect(document.querySelector('.piano-learn-ink [data-acc]')).not.toBeNull();

    act(() => vi.advanceTimersByTime(500));
    expect(ink('wrong')).toHaveLength(1); // still readable against the expected note
    act(() => vi.advanceTimersByTime(500)); // past the 900ms wrong TTL
    expect(ink('wrong')).toHaveLength(0);
    expect(document.querySelector('svg.piano-learn-ink')).toBeNull(); // layer folds away entirely
  });

  it('inks a correct note as a hit flash', async () => {
    renderPlayer();
    await act(async () => {});
    enterLearnGate();
    play(64); // step 0's RH note — a hit (the step needs the LH notes too, so no advance)
    expect(ink('hit')).toHaveLength(1);
    expect(ink('wrong')).toHaveLength(0);
    act(() => vi.advanceTimersByTime(400)); // past the 350ms hit TTL
    expect(ink('hit')).toHaveLength(0);
  });

  it('does not reveal the keyboard on the first two wrongs — the third does', async () => {
    renderPlayer();
    await act(async () => {});
    enterLearnGate();
    expect(targets()).toHaveLength(0); // Learn starts un-spoiled

    play(63);
    expect(document.querySelector('.piano-score-cursor.is-wrong')).not.toBeNull(); // shake still says "no"
    expect(targets()).toHaveLength(0);
    play(63);
    expect(targets()).toHaveLength(0); // two is a fumble, not stuck
    play(63);
    // Third consecutive wrong on ONE step → the dim half-shade hint appears, for
    // every active-staff note of the step (E4 + E3 + E2).
    expect(targets()).toHaveLength(3);
    expect(document.querySelector('.piano-keyboard.target-dim')).not.toBeNull();
  });

  it('a hit resets the streak, so wrongs spread around a chord never reveal', async () => {
    renderPlayer();
    await act(async () => {});
    enterLearnGate();
    play(63); play(63);   // two wrongs…
    play(64);             // …then a correct note: the player is reading, not stuck
    expect(targets()).toHaveLength(0);
    play(63); play(63);   // two more wrongs — the streak restarted at the hit
    expect(targets()).toHaveLength(0);
    play(63);
    expect(targets().length).toBeGreaterThan(0); // three consecutive → help
  });

  it('the streak resets on a step change, so the next note starts un-penalised', async () => {
    renderPlayer();
    await act(async () => {});
    enterLearnGate();
    play(63); play(63);            // two wrongs on step 0
    play(64); play(52); play(40);  // satisfy step 0 → advance
    expect(screen.getByTestId('score-position')).toHaveTextContent('2 / 4');
    play(63); play(63);            // two wrongs on step 1 (D4) — carried streak would reveal
    expect(targets()).toHaveLength(0);
  });

  it('inks NEUTRAL in the machine rows — never red, never a shake', async () => {
    renderPlayer();
    await act(async () => {});
    enterLearn(); // Learn WITHOUT a range = machine playback (wave-3 §B row 1)
    expect(h.noteCbs.size).toBe(1); // the ink effect, and nothing else — no gate on the bus
    play(63);
    expect(ink('neutral')).toHaveLength(1);
    expect(ink('wrong')).toHaveLength(0);
    expect(document.querySelector('.piano-score-cursor.is-wrong')).toBeNull();
    expect(targets()).toHaveLength(0); // and no reveal, however many notes land
    play(63); play(63); play(63);
    expect(targets()).toHaveLength(0);
    act(() => vi.advanceTimersByTime(600)); // past the 500ms neutral TTL
    expect(ink('neutral')).toHaveLength(0);
  });

  it('renders no ink layer outside Learn', async () => {
    renderPlayer(); // opens in Listen
    await act(async () => {});
    expect(h.noteCbs.size).toBe(0); // Listen subscribes to nothing at all
    play(63);
    expect(document.querySelector('svg.piano-learn-ink')).toBeNull();
    pickMode('Polish');
    expect(h.noteCbs.size).toBe(0); // …and idle Polish only arms its evaluator inside a run
    play(63);
    expect(document.querySelector('svg.piano-learn-ink')).toBeNull();
    pickMode('Perform');
    play(63);
    expect(document.querySelector('svg.piano-learn-ink')).toBeNull();
  });

  it('clears live ink when the mode changes', async () => {
    renderPlayer();
    await act(async () => {});
    enterLearnGate();
    play(63);
    expect(ink('wrong')).toHaveLength(1);
    pickMode('Polish');
    expect(document.querySelector('svg.piano-learn-ink')).toBeNull();
    pickMode('Learn'); // back to Learn — the old mark must not reappear
    expect(document.querySelector('svg.piano-learn-ink')).toBeNull();
  });

  it('spells the ink in the SOUNDING key when the piece is transposed', async () => {
    renderPlayer();
    await act(async () => {});
    enterLearnGate();
    // The fixture parses no key (fifths 0 = C major), where midi 70 spells A#.
    // Transposing −2 makes the SOUNDING key Bb major (fifths −2), where the very
    // same played pitch spells Bb — a different letter, a different staff line, a
    // different accidental. That flip is the whole claim: ink is spelled in the
    // key the player is HEARING, not the one on the page.
    play(70);
    expect(document.querySelector('.piano-learn-ink [data-acc="sharp"]')).not.toBeNull();
    expect(document.querySelector('.piano-learn-ink [data-acc="flat"]')).toBeNull();
    act(() => vi.advanceTimersByTime(1000)); // let the mark expire

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Key' })); }); // open the Key sheet
    act(() => { fireEvent.click(screen.getByRole('button', { name: /-2/ })); });  // −2 semitones
    await act(async () => {});
    play(70);
    expect(ink('wrong')).toHaveLength(1);
    expect(document.querySelector('.piano-learn-ink [data-acc="flat"]')).not.toBeNull();
    expect(document.querySelector('.piano-learn-ink [data-acc="sharp"]')).toBeNull();
  });
});

// ── Task 20 (§F): armed endpoint picking replaces the two-tap selection ───────
// The loop cluster (LoopGroup) is four buttons in the Learn bar. Tapping a mark
// button ARMS that edge; the next tap on the music commits it. One tap is one
// endpoint — there is no "now tap the last measure" half-state to strand a user
// in, and an unarmed tap always seeks.
describe('ScorePlayer — armed endpoint picking (wave-3 F)', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  // Four single-note measures, one system, x = 100/160/220/280 — a tap near one
  // of those x values resolves to that measure.
  const FOUR = {
    events: [0, 1, 2, 3].map((m) => ({ midi: 64 - m, midis: [64 - m], onsetQuarter: m, x: 100 + m * 60, top: 10, bottom: 200, system: 0 })),
    steps: [0, 1, 2, 3].map((m) => ({
      onsetQuarter: m,
      measure: m,
      notes: [{ midi: 64 - m, staff: 0, x: 100 + m * 60, top: 10, bottom: 200, width: 8 }],
    })),
    measures: [0, 1, 2, 3].map((m) => ({ index: m, number: m + 1, firstStep: m, lastStep: m })),
  };
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
  const banner = () => document.querySelector('.piano-score-select-banner');

  // ── Spec 1 ────────────────────────────────────────────────────────────────
  it('arming the start with no range lands a one-measure range at the tapped measure, loop OFF, no auto-play', () => {
    h.layoutExtras = FOUR;
    renderPlayer();
    enterLearn();
    expect(loopSpan()).toBe('–');            // blank Learn (auto-pick cleared)
    arm('in');
    expect(banner()).not.toBeNull();          // the banner says what to tap
    expect(banner().textContent).toMatch(/loop start/i);
    tapScore(220);                            // measure 3 (index 2)
    expect(banner()).toBeNull();              // committed → guidance goes away
    expect(loopSpan()).toBe('m3–m3');         // a ONE-measure range
    expect(loopToggle()).toHaveAttribute('aria-pressed', 'false'); // …with the loop OFF (§F)
    expect(document.querySelectorAll('.piano-score-range-handle').length).toBe(2); // the ends are the handles now (wave-3 F)
    expect(screen.getByTestId('score-position')).toHaveTextContent('m 3 / 4'); // cursor at the in-point
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();        // …and nothing started
  });

  // ── Spec 2 ────────────────────────────────────────────────────────────────
  it('a second endpoint replaces that edge, and crossed endpoints auto-swap', () => {
    h.layoutExtras = FOUR;
    renderPlayer();
    enterLearn();
    armAndTap('in', 100);                     // {m1, m1}
    expect(loopSpan()).toBe('m1–m1');
    armAndTap('out', 220);                    // out → m3
    expect(loopSpan()).toBe('m1–m3');
    armAndTap('in', 280);                     // in → m4, which is PAST the out-point…
    expect(loopSpan()).toBe('m3–m4');         // …so the ends swap rather than invert
  });

  // ── Spec 3 ────────────────────────────────────────────────────────────────
  it('an armed tap in a dead margin is refused out loud and stays armed', () => {
    h.layoutExtras = FOUR;
    renderPlayer();
    enterLearn();
    arm('out');
    const first = banner();
    tapScore(160, 600);                       // y far below every system band
    expect(loopSpan()).toBe('–');             // nothing committed
    expect(banner()).not.toBeNull();          // still armed — the arm survives a miss
    expect(banner().textContent).toMatch(/inside the music/i);
    expect(banner()).not.toBe(first);         // re-keyed → the shake replays
    tapScore(160, 700);                       // a second miss shakes again
    expect(banner().textContent).toMatch(/inside the music/i);
    tapScore(160);                            // …and a real tap still commits
    expect(loopSpan()).toBe('m2–m2');
  });

  it('a tap far to the RIGHT of the last note still commits — endpoint picking is coarse', () => {
    // The retired two-tap flow refused any tap >90px from a note (audit L3), which
    // made the whitespace after a system dead. §F drops that rule: only a tap
    // outside every system's vertical band is a miss.
    h.layoutExtras = FOUR;
    renderPlayer();
    enterLearn();
    armAndTap('in', 960);                     // 680px right of the last note
    expect(loopSpan()).toBe('m4–m4');
  });

  // ── Spec 4 ────────────────────────────────────────────────────────────────
  it('an arm expires after the idle window, so a later tap seeks instead of setting an endpoint', () => {
    vi.useFakeTimers();
    try {
      h.layoutExtras = FOUR;
      renderPlayer();
      enterLearn();
      arm('in');
      expect(banner()).not.toBeNull();
      act(() => { vi.advanceTimersByTime(15001); }); // the user wandered off
      expect(banner()).toBeNull();
      tapScore(160);
      expect(loopSpan()).toBe('–');                                              // no endpoint set
      expect(screen.getByTestId('score-position')).toHaveTextContent('m 2 / 4'); // it SEEKED
    } finally { vi.useRealTimers(); }
  });

  it('a mode change, Play and Restart each cancel a pending arm', () => {
    h.layoutExtras = FOUR;
    renderPlayer();
    enterLearn();
    arm('in');
    pickMode('Listen');
    expect(banner()).toBeNull();
    enterLearn();
    arm('in');
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Play' })); });
    expect(banner()).toBeNull();
    act(() => { fireEvent.click(screen.getByRole('button', { name: /pause/i })); }); // stop the run again
    tapScore(160); // move the cursor off the top so Restart has a run to restart
    arm('out');
    act(() => { fireEvent.click(screen.getByRole('button', { name: /restart/i })); });
    expect(banner()).toBeNull();
  });

  // ── Spec 5 ────────────────────────────────────────────────────────────────
  // Rehearsal marks are the musician's landmarks: a coarse tap one measure off a
  // section boundary means the boundary, so the commit snaps to it.
  const sectionedXml = (n, marks) => `<score-partwise><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">${
    Array.from({ length: n }, (_, i) => `<measure number="${i + 1}">${
      marks[i + 1] ? `<direction><direction-type><rehearsal>${marks[i + 1]}</rehearsal></direction-type></direction>` : ''
    }</measure>`).join('')
  }</part></score-partwise>`;
  const EIGHTEEN = {
    events: Array.from({ length: 18 }, (_, m) => ({ midi: 60 + (m % 12), midis: [60 + (m % 12)], onsetQuarter: m, x: 100 + m * 40, top: 10, bottom: 200, system: 0 })),
    steps: Array.from({ length: 18 }, (_, m) => ({
      onsetQuarter: m,
      measure: m,
      notes: [{ midi: 60 + (m % 12), staff: 0, x: 100 + m * 40, top: 10, bottom: 200, width: 8 }],
    })),
    measures: Array.from({ length: 18 }, (_, m) => ({ index: m, number: m + 1, firstStep: m, lastStep: m })),
  };
  const xOfMeasure = (m1based) => 100 + (m1based - 1) * 40;

  it('snaps an endpoint to a section boundary within one measure of the tap', () => {
    h.layoutExtras = EIGHTEEN;
    const emitted = captureLog();
    render(<MemoryRouter><ScorePlayer score={{ title: 'S', musicXml: sectionedXml(18, { 8: 'A', 16: 'B' }) }} /></MemoryRouter>);
    enterLearn();
    armAndTap('in', xOfMeasure(7));   // one measure BEFORE the mark at m8 → snaps forward
    expect(loopSpan()).toBe('m8–m8');
    armAndTap('in', xOfMeasure(9));   // one measure AFTER it → snaps back
    expect(loopSpan()).toBe('m8–m8');
    armAndTap('out', xOfMeasure(16)); // the mark itself — already a boundary
    expect(loopSpan()).toBe('m8–m16');
    // A tap two measures out is NOT snapped — the user meant the measure they hit.
    armAndTap('in', xOfMeasure(6));
    expect(loopSpan()).toBe('m6–m16');
    const sets = emitted.filter(([ev]) => ev === 'score.loop.set').map(([, d]) => d);
    expect(sets[0]).toMatchObject({ edge: 'in', measure: 7, via: 'tap', snapped: true });  // 0-based measure index
    expect(sets.at(-1)).toMatchObject({ edge: 'in', measure: 5, via: 'tap', snapped: false });
  });

  // ── Spec 6 ────────────────────────────────────────────────────────────────
  it('an UNARMED tap always seeks, in Learn and inside the gate — clamped to an active loop', () => {
    h.layoutExtras = FOUR;
    const emitted = captureLog();
    renderPlayer();
    enterLearn();
    tapScore(280);                            // no arm → a plain seek
    expect(screen.getByTestId('score-position')).toHaveTextContent('m 4 / 4');
    expect(loopSpan()).toBe('–');             // …and it set no endpoint
    expect(emitted.filter(([ev]) => ev === 'score.seek.tap').map(([, d]) => d))
      .toEqual([{ from: 0, to: 3, mode: 'learn' }]);
    // Inside the gate the seek is clamped into the range, exactly as before.
    armAndTap('in', 160);                     // range m2–m2
    toggleLoop();
    tapScore(280);
    expect(screen.getByTestId('score-position')).toHaveTextContent('m 2 / 4');
  });

  // ── Telemetry (§F renames) ────────────────────────────────────────────────
  it('emits score.loop.arm / .set / .on and keeps score.focus.clear', () => {
    h.layoutExtras = FOUR;
    const emitted = captureLog();
    renderPlayer();
    enterLearn();
    emitted.length = 0; // the Learn landing + its clearAutoRange are setup, not the subject
    const names = () => emitted.map(([ev]) => ev);
    arm('in');
    expect(emitted.filter(([ev]) => ev === 'score.loop.arm').map(([, d]) => d)).toEqual([{ edge: 'in' }]);
    tapScore(160);
    expect(emitted.filter(([ev]) => ev === 'score.loop.set').map(([, d]) => d))
      .toEqual([{ edge: 'in', measure: 1, via: 'tap', snapped: false }]);
    toggleLoop();
    expect(emitted.filter(([ev]) => ev === 'score.loop.on').map(([, d]) => d)).toEqual([{ on: true }]);
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Clear loop' })); });
    expect(emitted.filter(([ev]) => ev === 'score.focus.clear').length).toBe(1);
    // The retired two-tap events are gone for good.
    expect(names()).not.toContain('score.focus.select-start');
    expect(names()).not.toContain('score.focus.select-timeout');
    expect(names()).not.toContain('score.focus.arm');
    expect(names()).not.toContain('score.loop.toggle');
  });

  it('a range change stops a running transport instead of playing on through it', () => {
    vi.useFakeTimers();
    try {
      h.layoutExtras = { ...FOUR, tempoEntries: [{ onsetQuarter: 0, bpm: 60 }] };
      renderPlayer();
      enterLearn();                            // no range → machine playback is live
      act(() => { fireEvent.click(screen.getByRole('button', { name: 'Play' })); });
      act(() => { vi.advanceTimersByTime(100); });
      expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
      armAndTap('in', 160);
      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument(); // stopped, never auto-played
    } finally { vi.useRealTimers(); }
  });

  // ── Task 21 (§F): the range's ends are DRAGGABLE handles ──────────────────
  // The two grips on the score are both the boundary visual and the way to move
  // it. A still press on one ARMS that edge (the same flow the bar's mark buttons
  // start); a drag moves it directly and commits the measure it is released over.
  // jsdom has no PointerEvent, but the listeners route by type string and a
  // MouseEvent carries clientX/clientY — the same trick the touch-gesture tests
  // above use. The handle layer's root rect is all zeros here, so client coords
  // are renderer-local coords.
  const pev = (type, x, y = 100) => new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
  const grip = (edge) => document.querySelector(`.piano-score-range-handle--${edge}`);
  const ticks = () => document.querySelectorAll('.piano-score-section-mark');
  const pressGrip = (edge, x) => { act(() => { grip(edge).dispatchEvent(pev('pointerdown', x)); }); };
  const moveGrip = (edge, x) => { act(() => { grip(edge).dispatchEvent(pev('pointermove', x)); }); };
  const releaseGrip = (edge, x) => { act(() => { grip(edge).dispatchEvent(pev('pointerup', x)); }); };

  const renderSectioned = () => {
    h.layoutExtras = EIGHTEEN;
    render(<MemoryRouter><ScorePlayer score={{ title: 'S', musicXml: sectionedXml(18, { 8: 'A', 16: 'B' }) }} /></MemoryRouter>);
    enterLearn();
  };

  it('renders a handle at each end of the range — Learn only, and only with a range', () => {
    renderSectioned();
    expect(document.querySelectorAll('.piano-score-range-handle')).toHaveLength(0); // no range yet
    armAndTap('in', xOfMeasure(8));
    expect(loopSpan()).toBe('m8–m8');
    expect(grip('in')).not.toBeNull();
    expect(grip('out')).not.toBeNull();
    expect(grip('in').getAttribute('aria-valuenow')).toBe('8'); // 1-based, like the readout
    pickMode('Polish'); // Polish has no loop (Task 9) — so it must not show its ends
    expect(document.querySelectorAll('.piano-score-range-handle')).toHaveLength(0);
  });

  it('dragging a handle commits that edge — snapped to a section boundary', () => {
    const emitted = captureLog();
    renderSectioned();
    armAndTap('in', xOfMeasure(8));            // range m8–m8 (the mark itself)
    emitted.length = 0;
    pressGrip('out', xOfMeasure(8));
    // m15 is section A's LAST measure (the mark at m16 starts B); release one
    // measure short of it…
    moveGrip('out', xOfMeasure(14));
    releaseGrip('out', xOfMeasure(14));
    expect(loopSpan()).toBe('m8–m15');          // …and the commit snaps to the boundary
    expect(emitted.filter(([ev]) => ev === 'score.loop.set').map(([, d]) => d))
      .toEqual([{ edge: 'out', measure: 14, via: 'drag', snapped: true }]);
  });

  it('a still press on a handle arms that edge instead of moving it', () => {
    renderSectioned();
    armAndTap('in', xOfMeasure(8));
    expect(banner()).toBeNull();
    pressGrip('out', 400);
    releaseGrip('out', 403);                    // inside the tap slop → a TAP
    expect(banner()).not.toBeNull();
    expect(banner().textContent).toMatch(/loop end/i);
    expect(loopSpan()).toBe('m8–m8');           // nothing moved
    tapScore(xOfMeasure(12));                   // …and the armed flow still commits
    expect(loopSpan()).toBe('m8–m12');
  });

  it('ticks the section boundaries only while an endpoint is up for grabs', () => {
    renderSectioned();
    expect(ticks()).toHaveLength(0);            // a score at rest is unmarked
    arm('in');
    const armedTicks = ticks().length;
    expect(armedTicks).toBeGreaterThan(0);      // armed with no range yet — still drawn
    tapScore(xOfMeasure(8));
    expect(ticks()).toHaveLength(0);            // committed → the landmarks go away
    // …and again for the whole span of a drag.
    pressGrip('out', xOfMeasure(8));
    moveGrip('out', xOfMeasure(12));
    expect(ticks()).toHaveLength(armedTicks);
    releaseGrip('out', xOfMeasure(12));
    expect(ticks()).toHaveLength(0);
  });

  it('a drag releases a pending arm, so the next tap on the music seeks', () => {
    // Both gestures answer "which measure?", so the drag supersedes the arm. If the
    // arm survived, the banner would still be up after the range committed and the
    // next tap would set an endpoint instead of seeking (audit H4b).
    renderSectioned();
    armAndTap('in', xOfMeasure(8));             // range m8–m8
    arm('out');                                 // …then arm the out edge
    expect(banner()).not.toBeNull();
    pressGrip('out', xOfMeasure(8));
    moveGrip('out', xOfMeasure(12));
    expect(banner()).toBeNull();                // the grab took over from the arm
    releaseGrip('out', xOfMeasure(12));
    expect(loopSpan()).toBe('m8–m12');
    expect(ticks()).toHaveLength(0);            // no latched arm chrome either
    tapScore(xOfMeasure(10));                   // the next tap SEEKS…
    expect(loopSpan()).toBe('m8–m12');          // …and sets no endpoint
    expect(screen.getByTestId('score-position')).toHaveTextContent('m 10 / 18');
  });

  it('a cancelled handle drag leaves the range alone and clears the tick chrome', () => {
    renderSectioned();
    armAndTap('in', xOfMeasure(8));
    pressGrip('out', xOfMeasure(8));
    moveGrip('out', xOfMeasure(12));
    expect(ticks().length).toBeGreaterThan(0);
    act(() => { grip('out').dispatchEvent(pev('pointercancel', xOfMeasure(12))); });
    expect(loopSpan()).toBe('m8–m8'); // nothing committed
    expect(ticks()).toHaveLength(0);  // and no latched drag chrome
  });
});
