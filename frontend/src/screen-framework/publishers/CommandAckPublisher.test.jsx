import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../../services/WebSocketService.js', () => ({
  wsService: { send: vi.fn() },
}));

import { wsService } from '../../services/WebSocketService.js';
import { CommandAckPublisher } from './CommandAckPublisher.jsx';

function makeBus() {
  const handlers = new Map();
  return {
    subscribe(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
      return () => handlers.get(event)?.delete(handler);
    },
    emit(event, payload) {
      const set = handlers.get(event);
      if (!set) return;
      for (const h of set) h(payload);
    },
  };
}

describe('CommandAckPublisher (standalone)', () => {
  beforeEach(() => wsService.send.mockClear());

  it('renders nothing when deviceId is missing', () => {
    const bus = makeBus();
    const { container } = render(<CommandAckPublisher actionBus={bus} />);
    expect(container.firstChild).toBeNull();
  });

  it('mounts the ack publisher and sends device-ack on media:queue-op', () => {
    const bus = makeBus();
    render(<CommandAckPublisher deviceId="livingroom-tv" actionBus={bus} />);

    bus.emit('media:queue-op', {
      op: 'play-now',
      contentId: 'plex:620707',
      commandId: 'cmd-abc',
    });

    const ackCalls = wsService.send.mock.calls.filter(
      ([m]) => m?.topic === 'device-ack',
    );
    expect(ackCalls.length).toBe(1);
    expect(ackCalls[0][0]).toMatchObject({
      topic: 'device-ack',
      deviceId: 'livingroom-tv',
      commandId: 'cmd-abc',
      ok: true,
    });
  });
});
