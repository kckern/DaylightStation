import { startAmbientZones } from '../../../backend/src/3_applications/home-automation/ambientZones.mjs';
import { projectAmbientZones as normalizeAmbientZones } from '../../../backend/src/1_adapters/home-automation/ConfiguredAmbientZones.mjs';

describe('normalizeAmbientZones', () => {
  it('passes through a zones list', () => {
    const cfg = { zones: [
      { topic: 'ambient', entities: ['sensor.k1', 'sensor.k2'] },
      { topic: 'ambient:office', entities: ['sensor.o1'] },
    ] };
    expect(normalizeAmbientZones(cfg)).toEqual([
      { channel: 'ambient', entities: ['sensor.k1', 'sensor.k2'] },
      { channel: 'ambient:office', entities: ['sensor.o1'] },
    ]);
  });

  it('normalizes a legacy illuminance block to one default zone', () => {
    const cfg = { illuminance: { entities: ['sensor.k1', 'sensor.k2'] } };
    expect(normalizeAmbientZones(cfg)).toEqual([
      { channel: 'ambient', entities: ['sensor.k1', 'sensor.k2'] },
    ]);
  });

  it('honors a legacy illuminance.topic', () => {
    const cfg = { illuminance: { topic: 'lux', entities: ['sensor.k1'] } };
    expect(normalizeAmbientZones(cfg)).toEqual([{ channel: 'lux', entities: ['sensor.k1'] }]);
  });

  it('drops zones missing a topic or with no entities', () => {
    const cfg = { zones: [
      { topic: '', entities: ['sensor.x'] },
      { topic: 'ok', entities: [] },
      { entities: ['sensor.y'] },
      { topic: 'good', entities: ['sensor.z', 7, ''] },
    ] };
    expect(normalizeAmbientZones(cfg)).toEqual([{ channel: 'good', entities: ['sensor.z'] }]);
  });

  it('returns [] for empty/absent config', () => {
    expect(normalizeAmbientZones(undefined)).toEqual([]);
    expect(normalizeAmbientZones({})).toEqual([]);
    expect(normalizeAmbientZones({ illuminance: { entities: [] } })).toEqual([]);
  });
});

describe('startAmbientZones', () => {
  const ambientGatewayFactory = () => ({ getCurrentStates: async () => new Map(), subscribe: () => () => {} });
  const publicationsFactory = () => ({ report: () => {} });
  const clock = { now: () => 1 };
  const logger = { info: () => {}, warn: () => {} };

  it('starts one service per zone with that zone config', () => {
    const calls = [];
    const createService = (opts) => {
      calls.push(opts);
      return { start: () => { opts.__started = true; } };
    };
    const zones = [
      { channel: 'ambient', entities: ['sensor.k1'] },
      { channel: 'ambient:office', entities: ['sensor.o1'] },
    ];
    const started = startAmbientZones({ zones, ambientGatewayFactory, publicationsFactory, clock, logger, createService });
    expect(started).toHaveLength(2);
    expect(calls.map((c) => c.entities)).toEqual([['sensor.k1'], ['sensor.o1']]);
    expect(calls.every((c) => c.__started)).toBe(true);
  });

  it('starts nothing when the HA gateway cannot connect', () => {
    const createService = () => { throw new Error('should not be called'); };
    const started = startAmbientZones({
      zones: [{ channel: 'ambient', entities: ['sensor.k1'] }],
      ambientGatewayFactory: null, publicationsFactory, clock, logger, createService,
    });
    expect(started).toEqual([]);
  });

  it('starts nothing for an empty zone list', () => {
    const started = startAmbientZones({ zones: [], ambientGatewayFactory, publicationsFactory, clock, logger, createService: () => ({ start() {} }) });
    expect(started).toEqual([]);
  });
});
