import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../services/WebSocketService.js', () => ({
  wsService: { send: vi.fn() },
}));

// Fake bus — return a stable Map-based bus the publishers can subscribe to.
const fakeBus = (() => {
  const handlers = new Map();
  return {
    subscribe(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
      return () => handlers.get(event)?.delete(handler);
    },
    emit(event, payload) {
      handlers.get(event)?.forEach((h) => h(payload));
    },
  };
})();

vi.mock('./input/ActionBus.js', () => ({ getActionBus: () => fakeBus }));

import { wsService } from '../services/WebSocketService.js';
import { ScreenSessionPublishers } from './ScreenSessionPublishers.jsx';

describe('ScreenSessionPublishers gating', () => {
  beforeEach(() => wsService.send.mockClear());

  it('mounts ack publisher when commands:true even without publishState', () => {
    const wsConfig = { commands: true, guardrails: { device: 'livingroom-tv' } };
    render(<ScreenSessionPublishers wsConfig={wsConfig} />);

    fakeBus.emit('media:queue-op', {
      op: 'play-now',
      contentId: 'plex:620707',
      commandId: 'cmd-1',
    });

    const ackCalls = wsService.send.mock.calls.filter(
      ([m]) => m?.topic === 'device-ack',
    );
    expect(ackCalls.length).toBe(1);
    expect(ackCalls[0][0]).toMatchObject({
      deviceId: 'livingroom-tv',
      commandId: 'cmd-1',
      ok: true,
    });
  });

  it('mounts state publisher when publishState:true', () => {
    const wsConfig = {
      publishState: true,
      guardrails: { device: 'livingroom-tv' },
    };
    render(<ScreenSessionPublishers wsConfig={wsConfig} />);
    const stateCalls = wsService.send.mock.calls.filter(
      ([m]) => m?.topic === 'device-state',
    );
    expect(stateCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('renders nothing when neither flag is set', () => {
    const wsConfig = { guardrails: { device: 'livingroom-tv' } };
    const { container } = render(<ScreenSessionPublishers wsConfig={wsConfig} />);
    expect(container.firstChild).toBeNull();
    expect(wsService.send.mock.calls.length).toBe(0);
  });

  it('renders nothing when device is missing', () => {
    const wsConfig = { commands: true };
    const { container } = render(<ScreenSessionPublishers wsConfig={wsConfig} />);
    expect(container.firstChild).toBeNull();
  });
});
