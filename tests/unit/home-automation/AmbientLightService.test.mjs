import { createAmbientLightService } from '../../../backend/src/3_applications/home-automation/AmbientLightService.mjs';

const noopLogger = { warn: () => {}, error: () => {}, debug: () => {}, info: () => {} };
const makeService = (over = {}) => {
  const broadcasts = [];
  const eventBus = { broadcast: (topic, payload) => broadcasts.push({ topic, payload }) };
  const haGateway = {
    getStates: async () => new Map(),
    getConnection: () => ({ baseUrl: 'http://ha:8123', token: 'TKN' }),
  };
  let now = 100000;
  const svc = createAmbientLightService({
    haGateway, eventBus, logger: noopLogger,
    config: { entities: ['sensor.a', 'sensor.b'], topic: 'ambient' },
    now: () => now,
    ...over,
  });
  return { svc, broadcasts, setNow: (n) => { now = n; } };
};

const evt = (entity, state) =>
  JSON.stringify({ type: 'event', event: { event_type: 'state_changed', data: { entity_id: entity, new_state: { state } } } });

describe('AmbientLightService', () => {
  it('authenticates then subscribes on the HA handshake', () => {
    const { svc } = makeService();
    const sent = [];
    const send = (m) => sent.push(m);
    svc._onHaMessage(JSON.stringify({ type: 'auth_required' }), send);
    svc._onHaMessage(JSON.stringify({ type: 'auth_ok' }), send);
    expect(sent[0]).toEqual({ type: 'auth', access_token: 'TKN' });
    expect(sent[1].type).toBe('subscribe_events');
    expect(sent[1].event_type).toBe('state_changed');
  });

  it('broadcasts max lux on a configured-entity state change', () => {
    const { svc, broadcasts } = makeService();
    svc._onHaMessage(evt('sensor.a', '50'), () => {});
    svc._onHaMessage(evt('sensor.b', '120'), () => {});
    expect(broadcasts.at(-1)).toEqual({ topic: 'ambient', payload: { topic: 'ambient', lux: 120, sources: { 'sensor.a': 50, 'sensor.b': 120 } } });
  });

  it('ignores entities not in the config', () => {
    const { svc, broadcasts } = makeService();
    svc._onHaMessage(evt('sensor.other', '999'), () => {});
    expect(broadcasts).toHaveLength(0);
  });

  it('throttles broadcasts within the window', () => {
    const { svc, broadcasts, setNow } = makeService();
    svc._onHaMessage(evt('sensor.a', '50'), () => {});   // t=100000 → broadcast
    svc._onHaMessage(evt('sensor.a', '80'), () => {});   // same instant → throttled
    expect(broadcasts).toHaveLength(1);
    setNow(103000);                                       // +3s past the 2s window
    svc._onHaMessage(evt('sensor.a', '110'), () => {});
    expect(broadcasts).toHaveLength(2);
    expect(broadcasts.at(-1).payload.lux).toBe(110);
  });
});
