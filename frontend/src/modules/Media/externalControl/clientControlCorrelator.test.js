import { describe, expect, it, vi } from 'vitest';
import { createClientControlCorrelator } from './clientControlCorrelator.js';

function transport() {
  let listener;
  let status;
  return {
    subscribe: vi.fn((filter, cb) => { listener = { filter, cb }; return vi.fn(); }),
    onStatusChange: vi.fn((cb) => { status = cb; return vi.fn(); }),
    sendEphemeral: vi.fn(() => true),
    ack: (msg) => listener.cb(msg),
    status: (s) => status(s),
  };
}

describe('client control correlator', () => {
  it('installs its exact caller ack listener before sending and resolves only matching target plus command', async () => {
    const ws = transport();
    const correlator = createClientControlCorrelator({ controlClientId: 'caller', service: ws, timeoutMs: 1000 });
    const pending = correlator.send({ targetControlClientId: 'target', command: { commandId: 'cmd-1', command: 'transport', params: { action: 'pause' } } });
    expect(ws.subscribe).toHaveBeenCalledBefore(ws.sendEphemeral);
    expect(ws.sendEphemeral).toHaveBeenCalledWith(expect.objectContaining({ topic: 'client-control:target', replyToControlClientId: 'caller' }));
    ws.ack({ topic: 'client-ack:caller', clientId: 'other', commandId: 'cmd-1', ok: true });
    ws.ack({ topic: 'client-ack:caller', clientId: 'target', commandId: 'other', ok: true });
    ws.ack({ topic: 'client-ack:caller', clientId: 'target', commandId: 'cmd-1', ok: false, code: 'REFUSED' });
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'REFUSED' });
    correlator.dispose();
  });

  it('fails pending work on disconnect and does not claim send success when unavailable', async () => {
    const ws = transport();
    const correlator = createClientControlCorrelator({ controlClientId: 'caller', service: ws, timeoutMs: 1000 });
    ws.sendEphemeral.mockReturnValue(false);
    await expect(correlator.send({ targetControlClientId: 'target', command: { commandId: 'cmd-2', command: 'transport', params: { action: 'pause' } } })).rejects.toThrow(/unavailable/);
    ws.sendEphemeral.mockReturnValue(true);
    const pending = correlator.send({ targetControlClientId: 'target', command: { commandId: 'cmd-3', command: 'transport', params: { action: 'pause' } } });
    ws.status({ connected: false });
    await expect(pending).rejects.toThrow(/disconnect/);
    correlator.dispose();
  });

  it('fails a duplicate pending commandId without displacing the original correlation', async () => {
    const ws = transport();
    const correlator = createClientControlCorrelator({ controlClientId: 'caller', service: ws, timeoutMs: 1000 });
    const original = correlator.send({ targetControlClientId: 'target', command: { commandId: 'cmd-duplicate', command: 'transport', params: { action: 'pause' } } });

    await expect(correlator.send({ targetControlClientId: 'target', command: { commandId: 'cmd-duplicate', command: 'transport', params: { action: 'play' } } })).rejects.toThrow(/duplicate-commandId/);
    expect(ws.sendEphemeral).toHaveBeenCalledTimes(1);

    ws.ack({ topic: 'client-ack:caller', clientId: 'target', commandId: 'cmd-duplicate', ok: true });
    await expect(original).resolves.toMatchObject({ commandId: 'cmd-duplicate', ok: true });
    correlator.dispose();
  });
});
