import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── Task 13: config-gated recorder lifecycle ─────────────────────────────────
// This file lives apart from ScorePlayer.test.jsx because vi.mock is per-file
// hoisted: here we mock the inputRecorder module so start/stopRecorder are spies,
// and drive the config through a mutable holder so ON and OFF paths are both
// exercised without a second file.

const cfg = vi.hoisted(() => ({ value: { keyboard: { startNote: 21, endNote: 108 } } }));

const rec = vi.hoisted(() => ({
  startRecorder: vi.fn(),
  stopRecorder: vi.fn(),
  record: vi.fn(),
  intern: vi.fn(() => 0),
  __snapshotForTest: vi.fn(() => ({ count: 0, dropped: 0, records: [] })),
  __resetRecorder: vi.fn(),
}));

vi.mock('../../../../../lib/logging/inputRecorder.js', () => ({
  ...rec,
  KIND: {
    MIDI_ON: 1, MIDI_OFF: 2, SUSTAIN: 3, CC: 4,
    TAP: 5, TOUCH_START: 6, TOUCH_MOVE: 7, TOUCH_END: 8,
    UI_INTENT: 9, RENDER: 10,
  },
}));

// Telemetry is mocked here so the CALL SITE can be asserted directly: what
// ScorePlayer hands recordFire is the thing under test, not what the hook does
// with it. One stable object identity across renders, matching the real hook's
// memoized-callback contract (ScorePlayer depends on that — see its comment).
const tel = vi.hoisted(() => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {}, sampled: () => {} },
  startSession: () => {}, logLoad: () => {}, recordFire: null, recordSchedule: () => {},
  flushPlayback: () => {}, recordFollowHit: () => {}, flushFollow: () => {},
  logMeasureGrade: () => {}, logRunSummary: () => {}, logFocus: () => {},
  logTranspose: () => {}, logMode: () => {},
}));
// …except for the session-log tests below, which must observe the REAL logger:
// session-log.start is auto-emitted by the child logger at creation (Logger.js:218),
// so a stubbed hook can never see the double-open. `telMode.real` flips this mock
// to the actual hook. Flip it BETWEEN tests only, never mid-mount — the real hook
// calls hooks and the stub does not, so switching under a live component would
// change the hook order.
const telMode = vi.hoisted(() => ({ real: false }));
vi.mock('./useScoreTelemetry.js', async () => {
  const actual = await vi.importActual('./useScoreTelemetry.js');
  const pick = (opts) => (telMode.real ? actual.useScoreTelemetry(opts) : tel);
  return { default: pick, useScoreTelemetry: pick };
});

const h = vi.hoisted(() => ({
  events: [
    { midi: 64, midis: [64], onsetQuarter: 0, x: 100, top: 10, bottom: 200, system: 0 },
    { midi: 62, midis: [62], onsetQuarter: 1, x: 160, top: 10, bottom: 200, system: 0 },
  ],
  layoutExtras: null,
  // An OSMD parse/engrave throw takes the renderer's catch path: nothing is
  // published and onReady never runs, so the session gets no score.load.
  failEngrave: false,
  publishes: 0, // how many times the stub published a layout (re-engrave counter)
}));
const deriveSteps = (events) => events.map((e) => ({
  onsetQuarter: e.onsetQuarter,
  notes: (e.midis || [e.midi]).map((midi, i) => ({ midi, staff: i === 0 ? 0 : 1, x: e.x, top: e.top, bottom: e.bottom, width: 8 })),
}));
const deriveNotes = (steps) => steps.flatMap((s) => s.notes.map((n) => ({ midi: n.midi, staff: n.staff, onsetQuarter: s.onsetQuarter, durationQuarters: 1 })));

vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({
    subscribe: () => () => {},
    subscribeRaw: () => () => {},
    pressNote: vi.fn(), releaseNote: vi.fn(),
    sendNoteAt: vi.fn(), sendNoteOffAt: vi.fn(), sendPanic: vi.fn(),
  }),
  usePianoMidiNotes: () => ({ activeNotes: new Map(), noteHistory: [], sustainPedal: false, isPlaying: false }),
}));
vi.mock('../../PianoPlaybackContext.jsx', () => ({ usePianoPlayback: () => ({ setPlaying: () => {} }) }));
vi.mock('../../PianoConfig.jsx', () => ({ usePianoKioskConfig: () => ({ config: cfg.value }) }));
vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumb: () => {} }));
vi.mock('../../useReloadGuard.js', () => ({ default: () => {} }));
vi.mock('./clickScheduler.js', () => ({ createClickScheduler: () => ({ start: vi.fn(), stop: vi.fn(), setBpm: vi.fn() }) }));

vi.mock('../../../../MusicNotation/renderers/MusicXmlRenderer.jsx', async () => {
  const { useEffect } = await import('react');
  return {
    MusicXmlRenderer: ({ onLayout, onReady, children }) => {
      useEffect(() => {
        if (h.failEngrave) return; // engrave threw: no layout, no onReady (so no score.load)
        h.publishes += 1;
        const events = h.events;
        const steps = deriveSteps(events);
        const notes = deriveNotes(steps).map((n) => ({ ...n }));
        onLayout?.({ width: 800, height: 400, tempoEntries: [], flow: 'wrapped', events, steps, notes, ...(h.layoutExtras || {}) });
        onReady?.();
      }, [onLayout, onReady]);
      return <div data-testid="renderer" className="musicxml-renderer">{children}</div>;
    },
  };
});

import ScorePlayer from './ScorePlayer.jsx';
import { inputTelemetryEnabled, makeInputSender } from '../../../../../lib/logging/inputTelemetryGate.js';
import { getRecentEvents } from '../../../../../lib/logging/Logger.js';

const renderPlayer = () =>
  render(<MemoryRouter><ScorePlayer score={{ id: 'files:t.musicxml', title: 'T', musicXml: '<score/>' }} /></MemoryRouter>);
const renderScore = (musicXml) =>
  render(<MemoryRouter><ScorePlayer score={{ id: 'files:t2.musicxml', title: 'T2', musicXml }} /></MemoryRouter>);

beforeEach(() => {
  telMode.real = false;
  cfg.value = { keyboard: { startNote: 21, endNote: 108 } };
  rec.startRecorder.mockClear();
  rec.stopRecorder.mockClear();
  h.layoutExtras = null;
  h.failEngrave = false;
  h.publishes = 0;
  tel.recordFire = vi.fn();
  // Emitted events are the assertion surface for the control telemetry below;
  // the logger object identity must stay stable (ScorePlayer memoizes on it).
  tel.logger.info = vi.fn();
  tel.logFocus = vi.fn();
  try { window.localStorage.clear(); } catch { /* no storage */ }
});
afterEach(() => cleanup());

describe('inputTelemetryEnabled (pure predicate)', () => {
  it('is true only when config.inputTelemetry.enabled is truthy', () => {
    expect(inputTelemetryEnabled({ inputTelemetry: { enabled: true } })).toBe(true);
  });
  it('is false when disabled, absent, or config is null', () => {
    expect(inputTelemetryEnabled({ inputTelemetry: { enabled: false } })).toBe(false);
    expect(inputTelemetryEnabled({ inputTelemetry: {} })).toBe(false);
    expect(inputTelemetryEnabled({})).toBe(false);
    expect(inputTelemetryEnabled(null)).toBe(false);
    expect(inputTelemetryEnabled(undefined)).toBe(false);
  });
});

describe('ScorePlayer — recorder gate (Task 13)', () => {
  it('does NOT start the recorder when config has no inputTelemetry (default OFF)', () => {
    renderPlayer();
    expect(rec.startRecorder).not.toHaveBeenCalled();
  });

  it('starts the recorder exactly once on mount when inputTelemetry is enabled', () => {
    cfg.value = { keyboard: { startNote: 21, endNote: 108 }, inputTelemetry: { enabled: true } };
    renderPlayer();
    expect(rec.startRecorder).toHaveBeenCalledTimes(1);
    const arg = rec.startRecorder.mock.calls[0][0];
    expect(arg.score).toBe('files:t.musicxml');
    expect(typeof arg.send).toBe('function');
    expect(typeof arg.session).toBe('string');
  });

  it('installs a window.__INPUT_REC__ kill switch even when shipping is OFF', () => {
    renderPlayer();
    expect(window.__INPUT_REC__).toBeTruthy();
    expect(typeof window.__INPUT_REC__.start).toBe('function');
    expect(typeof window.__INPUT_REC__.stop).toBe('function');
    // Manual start works the deploy-free lever even with config off.
    window.__INPUT_REC__.start();
    expect(rec.startRecorder).toHaveBeenCalledTimes(1);
  });
});

describe('ScorePlayer — stall budget follows the EFFECTIVE tempo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
    vi.setSystemTime(0);
    h.layoutExtras = { tempoEntries: [{ onsetQuarter: 0, bpm: 90 }] };
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  // playTimeline is scaled by 1/tempoMult, so at 2x a 90bpm piece is REALLY
  // playing at 180bpm and the beat is half as long. Handing recordFire the
  // written bpm would size the stall budget to a beat that isn't happening.
  it('hands recordFire bpm x tempoMult, not the written bpm', async () => {
    window.localStorage.setItem('daylight.piano.sm.files:t.musicxml', JSON.stringify({ v: 1, mode: 'polish', tempoMult: 2 }));
    renderPlayer();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    // 180 effective bpm is past the countable rate, so the count-in is 4 half-note
    // clicks over 2 bars = 2667ms (it used to be 4 quarter clicks in 1333ms).
    act(() => vi.advanceTimersByTime(2700));
    act(() => vi.advanceTimersByTime(500));  // quarters are 333ms at 2x → fires

    expect(tel.recordFire.mock.calls.length).toBeGreaterThan(0);
    for (const call of tel.recordFire.mock.calls) expect(call[3]).toBe(180);
  });

  it('hands recordFire the written bpm when tempoMult is 1', async () => {
    window.localStorage.setItem('daylight.piano.sm.files:t.musicxml', JSON.stringify({ v: 1, mode: 'polish', tempoMult: 1 }));
    renderPlayer();
    await act(async () => {});
    screen.getByRole('button', { name: 'Play' }).click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(2700)); // 4-beat count-in @90 = 2667ms
    act(() => vi.advanceTimersByTime(700));  // quarters are 667ms → fires

    expect(tel.recordFire.mock.calls.length).toBeGreaterThan(0);
    for (const call of tel.recordFire.mock.calls) expect(call[3]).toBe(90);
  });
});

// ── Task 5: the controls users press must leave a trace ───────────────────────
// Restart, tap-to-seek and Perform's tap-scroll emitted NOTHING, so a three-day
// field log could not say whether a mode was used or abandoned; and the ±1 loop
// nudge emitted a bare score.focus.set indistinguishable from a two-tap commit
// or a section pick (audit T1).
describe('ScorePlayer — control telemetry (Task 5)', () => {
  const TWO_MEASURES = {
    steps: [
      { onsetQuarter: 0, measure: 0, notes: [{ midi: 64, staff: 0, x: 100, top: 10, bottom: 200, width: 8 }] },
      { onsetQuarter: 1, measure: 1, notes: [{ midi: 62, staff: 0, x: 160, top: 10, bottom: 200, width: 8 }] },
    ],
    measures: [
      { index: 0, number: 1, firstStep: 0, lastStep: 0 },
      { index: 1, number: 2, firstStep: 1, lastStep: 1 },
    ],
  };
  // Two rehearsal marks → two pickable sections in the Loop menu.
  const SECTIONED_XML = `<score-partwise><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
    <part id="P1">
      <measure number="1"><direction><direction-type><rehearsal>A</rehearsal></direction-type></direction></measure>
      <measure number="2"><direction><direction-type><rehearsal>B</rehearsal></direction-type></direction></measure>
    </part></score-partwise>`;

  const emitted = (name) => tel.logger.info.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
  const tapScore = (x, y = 100) => {
    const el = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(el, { clientX: x, clientY: y }); });
  };
  const selectLoop = (x) => { // Loop → Select measures… → two taps on the same note
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^loop/i })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /select measures/i })); });
    tapScore(x); tapScore(x);
  };

  beforeEach(() => { h.layoutExtras = TWO_MEASURES; });

  it('emits score.transport.restart when Restart is pressed', () => {
    renderPlayer();
    tapScore(160); // seek to step 1 so Restart is enabled
    act(() => { fireEvent.click(screen.getByRole('button', { name: /restart/i })); });
    expect(emitted('score.transport.restart')).toEqual([{ from: 1, to: 0, mode: 'listen' }]);
  });

  it('emits score.seek.tap for a tap-to-seek in a non-Perform mode', () => {
    renderPlayer();
    act(() => { screen.getByText('Learn').click(); });
    tapScore(160);
    expect(emitted('score.seek.tap')).toEqual([{ from: 0, to: 1, mode: 'learn' }]);
  });

  it('emits score.perform.tapscroll instead of a seek in Perform', () => {
    renderPlayer();
    act(() => { screen.getByText('Perform').click(); });
    tapScore(160);
    expect(emitted('score.perform.tapscroll')).toEqual([{ axis: 'y' }]);
    expect(emitted('score.seek.tap')).toEqual([]);
  });

  it('tags a focus set by the ±1 loop nudge with origin: nudge', () => {
    renderPlayer();
    act(() => { screen.getByText('Learn').click(); });
    selectLoop(100); // loop m1–m1
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Loop' })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /loop end later/i })); });
    const last = tel.logFocus.mock.calls.at(-1)[0];
    expect(last).toMatchObject({ kind: 'custom', inMeasure: 0, outMeasure: 1, origin: 'nudge' });
  });

  it('tags a focus set by a two-tap selection with origin: select', () => {
    renderPlayer();
    act(() => { screen.getByText('Learn').click(); });
    selectLoop(160);
    expect(tel.logFocus.mock.calls.at(-1)[0]).toMatchObject({ kind: 'custom', origin: 'select' });
  });

  it('tags a focus set by a section pick with origin: section', () => {
    renderScore(SECTIONED_XML);
    act(() => { screen.getByText('Learn').click(); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^loop/i })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'B' })); });
    expect(tel.logFocus.mock.calls.at(-1)[0]).toMatchObject({ kind: 'section', inMeasure: 1, outMeasure: 1, origin: 'section' });
  });
});


describe('makeInputSender — one event per batch', () => {
  it('emits exactly one logger.info per call, on the input channel with no sessionLog', async () => {
    const Logger = await import('../../../../../lib/logging/Logger.js');
    const info = vi.spyOn(Logger.default(), 'info').mockImplementation(() => {});
    const send = makeInputSender('piano-sheetmusic');
    send({ h: 1, session: 's', score: 'x' }); // header
    send({ b: [[0, 1, 60, 80, 0, 0]] });      // batch
    expect(info).toHaveBeenCalledTimes(2);
    expect(info.mock.calls[0][0]).toBe('input.header');
    expect(info.mock.calls[1][0]).toBe('input.batch');
    const ctx = info.mock.calls[0][2].context;
    expect(ctx).toMatchObject({ app: 'piano-sheetmusic', channel: 'input' });
    expect(ctx.sessionLog).toBeUndefined();
    info.mockRestore();
  });
});

// ── Task 16: one session file per score open (audit L1) ───────────────────────
// The field logs held 54 session-log.start events for 27 score opens: the
// sessionLog child logger auto-emits one when it is created at mount
// (Logger.js:218, carrying `app` only) and ScorePlayer emitted a second ~300ms
// later carrying `scoreId`. The first opened a backend session file that never
// received another line — seven 416-byte orphans sit in the field log directory.
describe('ScorePlayer — one session log per score open (audit L1)', () => {
  // The real logger is in play here (see the telMode note above), so the
  // recent-events ring is the observation surface.
  const startCount = () => getRecentEvents(300)
    .filter((e) => e.event === 'session-log.start' && e.context?.app === 'piano-sheetmusic').length;

  beforeEach(() => { telMode.real = true; });

  it('opens exactly ONE session file per mount', async () => {
    const before = startCount();
    renderPlayer();
    await act(async () => {});
    expect(startCount() - before).toBe(1);
  });

  // The guard must not cost us a fresh file when the user opens a DIFFERENT
  // score in the same mounted player — that file boundary is what keeps a run
  // log bounded and attributable.
  it('opens a FRESH session file when the document changes', async () => {
    const before = startCount();
    const view = (id, xml) => (
      <MemoryRouter><ScorePlayer score={{ id, title: id, musicXml: xml }} /></MemoryRouter>
    );
    const { rerender } = render(view('files:a.musicxml', '<score/>'));
    await act(async () => {});
    expect(startCount() - before).toBe(1);

    rerender(view('files:b.musicxml', '<score-partwise/>'));
    await act(async () => {});
    expect(startCount() - before).toBe(2);
  });
});

// ── Task 24: a failed engrave must still be attributable (audit H6) ───────────
// The mount-time session-log.start carried only { app }, so the score id reached
// the run log solely through score.load — and logLoad runs from onReady, which
// MusicXmlRenderer fires only on a SUCCESSFUL extraction. The field logs hold 24
// score.load events for 27 score opens: ~3 sessions per corpus have events but no
// attributable score, and those are exactly the failed/slow engraves worth
// investigating.
describe('ScorePlayer — the session log names its score (audit H6)', () => {
  const starts = () => getRecentEvents(300)
    .filter((e) => e.event === 'session-log.start' && e.context?.app === 'piano-sheetmusic');
  // Everything logged since the last session file was opened — i.e. this run's log.
  const sinceLastStart = () => {
    const evs = getRecentEvents(300);
    const i = evs.map((e) => e.event).lastIndexOf('session-log.start');
    return evs.slice(i);
  };

  beforeEach(() => { telMode.real = true; });

  it('puts the score id on the start event the mount writes', async () => {
    renderPlayer();
    await act(async () => {});
    expect(starts().at(-1)?.context?.scoreId).toBe('files:t.musicxml');
  });

  it('names the score even when the engrave never completes (no score.load at all)', async () => {
    h.failEngrave = true; // OSMD threw → onReady never runs
    renderPlayer();
    await act(async () => {});
    const run = sinceLastStart();
    expect(run.some((e) => e.event === 'score.load')).toBe(false); // the gap being covered
    expect(run[0].context?.scoreId).toBe('files:t.musicxml');      // …still attributable
  });

  it('names the NEW score after a document change, and does not re-engrave in a loop', async () => {
    const view = (id, xml) => (
      <MemoryRouter><ScorePlayer score={{ id, title: id, musicXml: xml }} /></MemoryRouter>
    );
    const { rerender } = render(view('files:a.musicxml', '<score/>'));
    await act(async () => {});
    expect(starts().at(-1)?.context?.scoreId).toBe('files:a.musicxml');
    expect(h.publishes).toBe(1);

    rerender(view('files:b.musicxml', '<score-partwise/>'));
    await act(async () => {});
    expect(starts().at(-1)?.context?.scoreId).toBe('files:b.musicxml'); // not the stale one
    // The logger identity must not churn: a fresh child per render would re-fire
    // the renderer's onLayout/onReady forever (why its memo deps are []). One
    // engrave per document, and settling does not add more.
    expect(h.publishes).toBe(2);
    await act(async () => {});
    await act(async () => {});
    expect(h.publishes).toBe(2);
  });
});
