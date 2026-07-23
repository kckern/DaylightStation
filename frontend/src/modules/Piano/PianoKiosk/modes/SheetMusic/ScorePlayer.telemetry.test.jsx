import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
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

const h = vi.hoisted(() => ({
  events: [
    { midi: 64, midis: [64], onsetQuarter: 0, x: 100, top: 10, bottom: 200, system: 0 },
    { midi: 62, midis: [62], onsetQuarter: 1, x: 160, top: 10, bottom: 200, system: 0 },
  ],
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
        onLayout?.({ width: 800, height: 400, tempoEntries: [], flow: 'wrapped', events, steps, notes });
        onReady?.();
      }, [onLayout, onReady]);
      return <div data-testid="renderer" className="musicxml-renderer">{children}</div>;
    },
  };
});

import ScorePlayer, { inputTelemetryEnabled } from './ScorePlayer.jsx';

const renderPlayer = () =>
  render(<MemoryRouter><ScorePlayer score={{ id: 'files:t.musicxml', title: 'T', musicXml: '<score/>' }} /></MemoryRouter>);

beforeEach(() => {
  cfg.value = { keyboard: { startNote: 21, endNote: 108 } };
  rec.startRecorder.mockClear();
  rec.stopRecorder.mockClear();
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

describe('makeInputSender — one event per batch', () => {
  it('emits exactly one logger.info per call, on the input channel with no sessionLog', async () => {
    const Logger = await import('../../../../../lib/logging/Logger.js');
    const info = vi.spyOn(Logger.default(), 'info').mockImplementation(() => {});
    const { makeInputSender } = await import('./ScorePlayer.jsx');
    const send = makeInputSender();
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
