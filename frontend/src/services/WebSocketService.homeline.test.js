// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketService } from './WebSocketService.js';

describe('WebSocketService Home Line transport', () => {
  let service;
  beforeEach(() => { service = new WebSocketService(); });
  afterEach(() => { service._stopStaleCheck(); vi.unstubAllGlobals(); });

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

  it('reserves call topics for a credentialed subscriber on the same connection', () => {
    const send = vi.fn();
    service.ws = { readyState: 1, send };
    service.connected = true;
    const topic = 'homeline-call:fixture';
    const ordinary = vi.fn();
    const credentialed = vi.fn();
    const releaseOrdinary = service.subscribeTopic(topic, ordinary);
    const releaseCall = service.subscribeAuthorized({ topic, credential: 'fixture', role: 'phone', peerId: 'test' }, credentialed);
    expect(send.mock.calls.map(([message]) => JSON.parse(message))).toEqual([
      { type: 'homeline-authorize', topic, credential: 'fixture', role: 'phone', peerId: 'test' },
      { type: 'bus_command', action: 'subscribe', topics: [topic] },
    ]);

    const signal = { topic, type: 'offer' };
    service._dispatch(signal);
    expect(credentialed).toHaveBeenCalledWith(signal);
    expect(ordinary).not.toHaveBeenCalled();
    releaseOrdinary();
    releaseCall();
    expect(JSON.parse(send.mock.calls.at(-1)[0])).toEqual({ type: 'bus_command', action: 'unsubscribe', topics: [topic] });
  });

  it('authorizes call topics before a connection observer can reassert subscriptions', () => {
    vi.stubGlobal('WebSocket', class {
      static OPEN = 1;
      static CONNECTING = 0;
      readyState = 0;
      send = vi.fn();
    });
    service.onStatusChange(({ connected }) => { if (connected) service.refreshSubscriptions(); });
    const topic = 'homeline-call:fixture';
    service.subscribeAuthorized({ topic, credential: 'fixture', role: 'phone', peerId: 'test' }, vi.fn());
    service.ws.readyState = 1;
    service.ws.onopen();

    expect(service.ws.send.mock.calls.map(([message]) => JSON.parse(message))).toEqual([
      { type: 'homeline-authorize', topic, credential: 'fixture', role: 'phone', peerId: 'test' },
      { type: 'bus_command', action: 'subscribe', topics: [topic] },
    ]);
  });
});
