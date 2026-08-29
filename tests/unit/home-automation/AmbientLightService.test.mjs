import { createAmbientLightService } from '../../../backend/src/3_applications/home-automation/AmbientLightService.mjs';

const noopLogger = { warn: () => {}, error: () => {}, debug: () => {}, info: () => {} };
const makeService = (over = {}) => {
  const broadcasts = [];
  const publications = { report: (payload) => broadcasts.push(payload) };
  let onReading = null;
  const ambientGateway = {
    getCurrentStates: async () => new Map(),
    subscribe: (_entities, listener) => { onReading = listener; return () => {}; },
  };
  let now = 100000;
  const svc = createAmbientLightService({
    ambientGateway, publications, logger: noopLogger,
    entities: ['sensor.a', 'sensor.b'],
    clock: { now: () => now },
    ...over,
  });
  return {
    svc,
    broadcasts,
    emit: (entity, state) => onReading?.({ entity, state }),
    setNow: (n) => { now = n; },
  };
};

describe('AmbientLightService', () => {
  it('broadcasts max lux on a configured-entity state change', async () => {
    const { svc, broadcasts, emit } = makeService();
    await svc.start();
    emit('sensor.a', '50');
    emit('sensor.b', '120');
    expect(broadcasts.at(-1)).toEqual({ lux: 120, sources: { 'sensor.a': 50, 'sensor.b': 120 } });
  });

  it('ignores entities not in the config', async () => {
    const { svc, broadcasts, emit } = makeService();
    await svc.start();
    emit('sensor.other', '999');
    expect(broadcasts).toHaveLength(0);
  });

  it('throttles broadcasts within the window', async () => {
    const { svc, broadcasts, emit, setNow } = makeService();
    await svc.start();
    emit('sensor.a', '50');
    emit('sensor.a', '80');
    expect(broadcasts).toHaveLength(1);
    setNow(103000);                                       // +3s past the 2s window
    emit('sensor.a', '110');
    expect(broadcasts).toHaveLength(2);
    expect(broadcasts.at(-1).lux).toBe(110);
  });
});
