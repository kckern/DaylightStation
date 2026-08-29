import { describe, expect, it, vi } from 'vitest';
import { HomeAssistantAmbientSensorGateway } from './HomeAssistantAmbientSensorGateway.mjs';

class FakeSocket {
  handlers = {};
  sent = [];
  on(event, handler) { this.handlers[event] = handler; }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() {}
}

describe('HomeAssistantAmbientSensorGateway', () => {
  it('owns the HA auth/subscription protocol and emits semantic readings', () => {
    let socket;
    const WebSocketImpl = class extends FakeSocket { constructor() { super(); socket = this; } };
    const gateway = new HomeAssistantAmbientSensorGateway({
      haGateway: { getConnection: () => ({ baseUrl: 'http://ha:8123', token: 'TKN' }) },
      WebSocketImpl,
      logger: {},
    });
    const listener = vi.fn();
    gateway.subscribe(['sensor.a'], listener);

    socket.handlers.message(JSON.stringify({ type: 'auth_required' }));
    socket.handlers.message(JSON.stringify({ type: 'auth_ok' }));
    socket.handlers.message(JSON.stringify({
      type: 'event',
      event: { event_type: 'state_changed', data: { entity_id: 'sensor.a', new_state: { state: '42' } } },
    }));

    expect(socket.sent).toEqual([
      { type: 'auth', access_token: 'TKN' },
      { id: 1, type: 'subscribe_events', event_type: 'state_changed' },
    ]);
    expect(listener).toHaveBeenCalledWith({ entity: 'sensor.a', state: '42' });
  });
});
