import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const midi = vi.hoisted(() => ({
  midiHealth: { in: 'down', out: 'down' }, status: 'no-input', bridgeLink: 'closed',
  bridgeUnavailable: false, bindingGeneration: 1, inputName: null, outputName: null,
  resetLink: vi.fn(async () => ({ ok: true })),
}));
const resetPianoBridge = vi.hoisted(() => vi.fn());
vi.mock('./PianoMidiContext.jsx', () => ({ usePianoMidi: () => midi }));
vi.mock('./usePianoSound.js', () => ({ usePianoSound: () => ({ resync: vi.fn() }) }));
vi.mock('./usePianoMix.js', () => ({ usePianoMix: () => ({ reassertPianoLevel: vi.fn() }) }));
vi.mock('./PianoConfig.jsx', () => ({ usePianoKioskConfig: () => ({ pianoId: 'default' }) }));
vi.mock('./pianoBridgeClient.js', () => ({ resetPianoBridge }));

import { PianoConnectionProvider } from './PianoConnectionContext.jsx';
import { usePianoConnection } from './usePianoConnection.js';

let connection;
function Probe() { connection = usePianoConnection(); return null; }

describe('PianoConnectionProvider repair guard', () => {
  beforeEach(() => { resetPianoBridge.mockReset(); midi.bridgeUnavailable = false; });

  it('prevents concurrent repairs and releases the guard after a structured failure', async () => {
    let release;
    resetPianoBridge.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    render(<PianoConnectionProvider><Probe /></PianoConnectionProvider>);
    let first;
    act(() => { first = connection.repairConnection(); });
    let concurrent;
    await act(async () => { concurrent = await connection.repairConnection(); });
    expect(concurrent).toMatchObject({ ok: false, phase: 'guard', reason: 'already-working' });
    await act(async () => { release({ ok: false, reason: 'timeout' }); await first; });
    expect(connection.repair).toMatchObject({ state: 'failed', result: { phase: 'bridge-reset', reason: 'timeout' } });
    resetPianoBridge.mockResolvedValueOnce({ ok: false, reason: 'request-failed' });
    let next;
    await act(async () => { next = await connection.repairConnection(); });
    expect(next).toMatchObject({ phase: 'bridge-reset', reason: 'request-failed' });
    expect(resetPianoBridge).toHaveBeenCalledTimes(2);
  });
});
