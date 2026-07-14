import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Hermetic: mock the two hooks PianoMidiProvider composes, so we can drive
// their return values directly and assert on the wiring (not their internals
// — those are covered by useWebMidiBLE.* and usePianoBridgeNotes.test.js).
const h = vi.hoisted(() => ({
  midi: {
    status: 'connected', // Web MIDI OUTPUT/INPUT status (source of truth only in fallback)
    outputConnected: true,
    connect: vi.fn(),
    feedNote: vi.fn(),
    notes: { subscribe: vi.fn(), getSnapshot: vi.fn(() => ({})) },
  },
  bridgeLink: 'idle',
  bridgeUnavailable: false,
  useWebMidiBLEArgs: null,
  usePianoBridgeNotesArgs: null,
}));

vi.mock('./useWebMidiBLE.js', () => ({
  useWebMidiBLE: (args) => { h.useWebMidiBLEArgs = args; return h.midi; },
}));
vi.mock('./usePianoBridgeNotes.js', () => ({
  usePianoBridgeNotes: (args) => {
    h.usePianoBridgeNotesArgs = args;
    return { link: h.bridgeLink, unavailable: h.bridgeUnavailable };
  },
}));

import { PianoMidiProvider, usePianoMidi } from './PianoMidiContext.jsx';

function Probe() {
  const ctx = usePianoMidi();
  return (
    <div>
      <span data-testid="status">{ctx.status}</span>
      <span data-testid="connected">{String(ctx.connected)}</span>
      <span data-testid="bridgeLink">{ctx.bridgeLink}</span>
      <span data-testid="bridgeUnavailable">{String(ctx.bridgeUnavailable)}</span>
      <span data-testid="outputConnected">{String(ctx.outputConnected)}</span>
    </div>
  );
}

beforeEach(() => {
  h.midi.status = 'connected';
  h.bridgeLink = 'idle';
  h.bridgeUnavailable = false;
  h.useWebMidiBLEArgs = null;
  h.usePianoBridgeNotesArgs = null;
  h.midi.connect.mockClear();
});

describe('PianoMidiProvider wiring', () => {
  it('keeps Web MIDI input OFF (acquireInput:false) while the bridge is present/first-trying', () => {
    render(<PianoMidiProvider><Probe /></PianoMidiProvider>);
    expect(h.useWebMidiBLEArgs).toMatchObject({ acquireInput: false });
  });

  it('feeds bridge notes into midi.feedNote', () => {
    render(<PianoMidiProvider><Probe /></PianoMidiProvider>);
    // onNote must forward to midi.feedNote (directly or via a stable ref shim).
    h.usePianoBridgeNotesArgs.onNote('note_on', 60, 90);
    expect(h.midi.feedNote).toHaveBeenCalledWith('note_on', 60, 90);
  });

  it('status/connected reflect the bridge link when the bridge is connected', () => {
    h.bridgeLink = 'connected';
    render(<PianoMidiProvider><Probe /></PianoMidiProvider>);
    expect(screen.getByTestId('status').textContent).toBe('connected');
    expect(screen.getByTestId('connected').textContent).toBe('true');
    expect(screen.getByTestId('bridgeLink').textContent).toBe('connected');
  });

  it('status is "requesting" while the bridge is still trying (not yet unavailable)', () => {
    h.bridgeLink = 'reconnecting';
    render(<PianoMidiProvider><Probe /></PianoMidiProvider>);
    expect(screen.getByTestId('status').textContent).toBe('requesting');
    expect(screen.getByTestId('connected').textContent).toBe('false');
  });

  it('falls back to Web MIDI input when the bridge is unavailable (non-kiosk client)', () => {
    h.bridgeUnavailable = true;
    h.bridgeLink = 'reconnecting';
    h.midi.status = 'connected';
    render(<PianoMidiProvider><Probe /></PianoMidiProvider>);
    expect(h.useWebMidiBLEArgs).toMatchObject({ acquireInput: true }); // arm Web MIDI input
    expect(screen.getByTestId('status').textContent).toBe('connected'); // reflect Web MIDI status
    expect(screen.getByTestId('connected').textContent).toBe('true');
    expect(screen.getByTestId('bridgeUnavailable').textContent).toBe('true');
  });

  it('in fallback, reflects a Web MIDI no-input status (piano still not found)', () => {
    h.bridgeUnavailable = true;
    h.bridgeLink = 'reconnecting';
    h.midi.status = 'no-input';
    render(<PianoMidiProvider><Probe /></PianoMidiProvider>);
    expect(screen.getByTestId('status').textContent).toBe('no-input');
    expect(screen.getByTestId('connected').textContent).toBe('false');
  });

  it('still exposes Web MIDI output health (outputConnected) from midi', () => {
    render(<PianoMidiProvider><Probe /></PianoMidiProvider>);
    expect(screen.getByTestId('outputConnected').textContent).toBe('true');
  });

  it('auto-fires Web MIDI connect() when its OWN status is idle, even though the bridge status is connected', () => {
    // On the kiosk the bridge makes the outer status 'connected' immediately, so
    // PianoApp's idle→connect never runs. The context must initialize Web MIDI
    // itself off midi.status so the OUTPUT port (voice/note OUT) actually binds.
    h.midi.status = 'idle';
    h.bridgeLink = 'connected';
    render(<PianoMidiProvider><Probe /></PianoMidiProvider>);
    expect(h.midi.connect).toHaveBeenCalledTimes(1);
    // Outer status still reflects the bridge (note-IN is up) even while Web MIDI inits.
    expect(screen.getByTestId('status').textContent).toBe('connected');
  });

  it('does NOT re-fire connect() once Web MIDI is already connected', () => {
    h.midi.status = 'connected';
    render(<PianoMidiProvider><Probe /></PianoMidiProvider>);
    expect(h.midi.connect).not.toHaveBeenCalled();
  });
});
