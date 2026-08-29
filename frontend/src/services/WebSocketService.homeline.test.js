// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketService } from './WebSocketService.js';

describe('WebSocketService Home Line transport', () => {
  let service;
  beforeEach(() => { service = new WebSocketService(); });

  it('never puts ephemeral signaling in the reconnect queue', () => {
    expect(service.sendEphemeral({ topic: 'homeline-call:c', type: 'offer' })).toBe(false);
    expect(service.getStatus().queuedMessages).toBe(0);
    service.send({ topic: 'ordinary', type: 'event' });
    expect(service.getStatus().queuedMessages).toBe(1);
  });

  it('keeps authorized subscriptions exact and reauthorizes them on reconnect', () => {
    const send = vi.fn();
    service.ws = { readyState: 1, send };
    service.connected = true;
    const unsubscribe = service.subscribeAuthorized({
      topic: 'homeline-call:c', credential: 'memory-only', role: 'phone', peerId: 'p',
    }, vi.fn());
    send.mockClear();
    service._reauthorizeTopics();
    const messages = send.mock.calls.map(([message]) => JSON.parse(message));
    expect(messages).toEqual([expect.objectContaining({
      type: 'homeline-authorize', topic: 'homeline-call:c', credential: 'memory-only',
    })]);
    expect([...service.subscribers.values()].map(item => item.filter)).toContain('homeline-call:c');
    unsubscribe();
    expect(service.authorizedTopics.size).toBe(0);
  });
});
