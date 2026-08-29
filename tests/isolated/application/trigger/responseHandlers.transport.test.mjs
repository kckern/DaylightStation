import { describe, it, expect, vi } from 'vitest';
import { dispatchResponse } from '#apps/trigger/responseHandlers.mjs';

describe('transport handler', () => {
  it('broadcasts the resolved command payload to the target screen', async () => {
    const screenBroadcast = vi.fn();
    const commandResolver = vi.fn((cmd, arg) => (cmd === 'volume' ? { volume: Number(arg) } : null));
    const actuationGateway = {
      sendTransport: vi.fn((target, command, arg) => {
        const payload = commandResolver(command, arg);
        screenBroadcast(target, payload);
        return { handled: true, result: payload };
      }),
    };
    await dispatchResponse({ kind: 'transport', target: 'living-room', command: 'volume', arg: '30' }, { actuationGateway });
    expect(actuationGateway.sendTransport).toHaveBeenCalledWith('living-room', 'volume', '30');
    expect(screenBroadcast).toHaveBeenCalledWith('living-room', { volume: 30 });
  });

  it('no-ops (no broadcast) on an unknown command', async () => {
    const screenBroadcast = vi.fn();
    const logger = { warn: vi.fn() };
    const actuationGateway = { sendTransport: vi.fn(() => ({ handled: false })) };
    await dispatchResponse({ kind: 'transport', target: 't', command: 'nope' }, { actuationGateway, logger });
    expect(screenBroadcast).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('trigger.transport.unknown', expect.objectContaining({ command: 'nope' }));
  });
});
