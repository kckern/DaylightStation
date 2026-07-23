import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useEffect } from 'react';

// ── Task 8: config-gated recorder lifecycle + kill switch ────────────────────
// Kept apart from EditorSurface.test.jsx because vi.mock is per-file hoisted:
// here the inputRecorder module is mocked so start/stopRecorder are spies, and
// the OFF/ON paths are both driven through EditorSurface's `config` prop.

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
    UI_INTENT: 9, RENDER: 10, KEY: 11, EDIT: 12,
  },
}));

vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({
    subscribe: () => () => {},
    subscribeRaw: () => () => {},
    sendNoteAt: vi.fn(), sendNoteOffAt: vi.fn(), sendPanic: vi.fn(),
  }),
}));

vi.mock('../../../../MusicNotation/renderers/MusicXmlRenderer.jsx', () => ({
  MusicXmlRenderer: ({ onLayout, children }) => {
    useEffect(() => { onLayout?.({ steps: [], staves: [], width: 800, height: 400 }); }, [onLayout]);
    return <div data-testid="renderer">{children}</div>;
  },
}));

import { EditorSurface } from './EditorSurface.jsx';
import { makeEmptyScore } from './model/index.js';

const mount = (config) =>
  render(<EditorSurface initialScore={makeEmptyScore()} songId="files:s.musicxml" initialRevision={1} save={vi.fn()} config={config} />);

beforeEach(() => {
  rec.startRecorder.mockClear();
  rec.stopRecorder.mockClear();
});
afterEach(() => cleanup());

describe('EditorSurface — recorder gate (Task 8)', () => {
  it('does NOT start the recorder when config has no inputTelemetry (default OFF)', () => {
    mount({});
    expect(rec.startRecorder).not.toHaveBeenCalled();
  });

  it('starts the recorder exactly once on mount when inputTelemetry is enabled', () => {
    mount({ inputTelemetry: { enabled: true } });
    expect(rec.startRecorder).toHaveBeenCalledTimes(1);
    const arg = rec.startRecorder.mock.calls[0][0];
    expect(arg.score).toBe('files:s.musicxml');
    expect(typeof arg.send).toBe('function');
    expect(typeof arg.session).toBe('string');
  });

  it('records a draft score id when there is no songId yet', () => {
    render(<EditorSurface initialScore={makeEmptyScore()} songId={null} initialRevision={1} save={vi.fn()} config={{ inputTelemetry: { enabled: true } }} />);
    expect(rec.startRecorder.mock.calls[0][0].score).toBe('draft');
  });

  it('installs a window.__INPUT_REC__ kill switch even when shipping is OFF', () => {
    mount({});
    expect(window.__INPUT_REC__).toBeTruthy();
    expect(typeof window.__INPUT_REC__.start).toBe('function');
    expect(typeof window.__INPUT_REC__.stop).toBe('function');
    window.__INPUT_REC__.start();
    expect(rec.startRecorder).toHaveBeenCalledTimes(1);
  });
});
