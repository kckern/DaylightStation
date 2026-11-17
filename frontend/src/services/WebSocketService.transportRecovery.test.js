import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketService } from './WebSocketService.js';
vi.mock('../lib/logging/Logger.js', () => ({ default: () => { const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }; log.child = () => log; return log; } }));

describe('WebSocketService coalesced transport recovery', () => {
  let service;
  beforeEach(() => { vi.useFakeTimers(); service = new WebSocketService(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('bridge reboot fences old sequences and duplicate reconnect owners', () => {
    service.connect = vi.fn();
    service.requestRecovery?.({ owner: 'fitness', reason: 'lost' });
    service.requestRecovery?.({ owner: 'fitness', reason: 'lost' });
    service.requestRecovery?.({ owner: 'other', reason: 'lost' });
    const activeReconnectTimers = vi.getTimerCount();
    expect(activeReconnectTimers).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(service.connect).toHaveBeenCalledTimes(1);
  });

  it('reasserts the full desired subscription set exactly once and preserves queued messages', () => {
    const sockets = [];
    class Socket { static OPEN = 1; static CONNECTING = 0; constructor() { this.readyState = 0; this.send = vi.fn(); this.close = vi.fn(); sockets.push(this); } }
    vi.stubGlobal('WebSocket', Socket);
    service.subscribe(['fitness', 'fitness.transport.health'], vi.fn());
    service.subscribe('unrelated', vi.fn());
    service.send({ type: 'queued' });
    sockets[0].readyState = 1; sockets[0].onopen();
    sockets[0].send.mockClear();
    service.refreshSubscriptions?.();
    expect(sockets[0].send.mock.calls.map(([s]) => JSON.parse(s))).toEqual([{ type: 'bus_command', action: 'subscribe', topics: ['fitness', 'fitness.transport.health', 'unrelated'] }]);
    service.requestRecovery?.({ owner: 'fitness', reason: 'lost' });
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    service.send({ type: 'during-recovery' });
    sockets[1].readyState = 1; sockets[1].onopen();
    expect(sockets[1].send.mock.calls.map(([s]) => JSON.parse(s))).toEqual([
      { type: 'bus_command', action: 'subscribe', topics: ['fitness', 'fitness.transport.health', 'unrelated'] },
      { type: 'during-recovery' },
    ]);
    service._stopStaleCheck();
  });

  it('cancels only its pending recovery while preserving an ordinary reconnect owner', () => {
    service.connect = vi.fn();
    const cancel = service.requestRecovery?.({ owner: 'fitness', reason: 'lost' });
    expect(cancel).toBeTypeOf('function');
    cancel();
    expect(vi.getTimerCount()).toBe(0);
    service._scheduleReconnect();
    const release = service.requestRecovery({ owner: 'fitness', reason: 'lost' });
    release();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(service.connect).toHaveBeenCalledTimes(1);
  });
});
