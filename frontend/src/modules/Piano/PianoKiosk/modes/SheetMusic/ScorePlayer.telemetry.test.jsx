import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, act } from '@testing-library/react';
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
vi.mock('./useScoreTelemetry.js', () => ({ default: () => tel, useScoreTelemetry: () => tel }));

const h = vi.hoisted(() => ({
  events: [
    { midi: 64, midis: [64], onsetQuarter: 0, x: 100, top: 10, bottom: 200, system: 0 },
    { midi: 62, midis: [62], onsetQuarter: 1, x: 160, top: 10, bottom: 200, system: 0 },
  ],
  layoutExtras: null,
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

const renderPlayer = () =>
  render(<MemoryRouter><ScorePlayer score={{ id: 'files:t.musicxml', title: 'T', musicXml: '<score/>' }} /></MemoryRouter>);

beforeEach(() => {
  cfg.value = { keyboard: { startNote: 21, endNote: 108 } };
  rec.startRecorder.mockClear();
  rec.stopRecorder.mockClear();
  h.layoutExtras = null;
  tel.recordFire = vi.fn();
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
    act(() => vi.advanceTimersByTime(1400)); // 4-beat count-in @180 = 1333ms
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
