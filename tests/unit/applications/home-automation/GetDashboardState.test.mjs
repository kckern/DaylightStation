import { describe, it, expect, vi } from 'vitest';
import { GetDashboardState } from '#apps/home-automation/usecases/GetDashboardState.mjs';

const config = {
  summary: {
    weather: true,
    scenes: [{ id: 'scene.all_off', label: 'All Off', icon: 'power' }],
  },
  rooms: [
    {
      id: 'living_room',
      label: 'Living Room',
      icon: 'sofa',
      camera: 'doorbell',
      lights: [{ entity: 'light.lr_main', label: 'Main' }],
      climate: { temp: 'sensor.lr_temp', humidity: 'sensor.lr_hum' },
      motion: 'binary_sensor.lr_motion',
    },
  ],
};

function makeGateway(statesMap) {
  return { getStates: vi.fn().mockResolvedValue(statesMap) };
}

describe('GetDashboardState', () => {
  it('shapes config + state into domain response', async () => {
    const states = new Map([
      ['light.lr_main',         { state: 'on',  attributes: { brightness: 180 } }],
      ['sensor.lr_temp',        { state: '71.4', attributes: { unit_of_measurement: '°F' } }],
      ['sensor.lr_hum',         { state: '42',   attributes: { unit_of_measurement: '%' } }],
      ['binary_sensor.lr_motion', { state: 'off', lastChanged: '2026-04-20T12:00:00Z' }],
    ]);
    const uc = new GetDashboardState({
      configRepository: { load: async () => config },
      haGateway: makeGateway(states),
    });

    const result = await uc.execute();

    expect(result.summary.sceneButtons[0].id).toBe('scene.all_off');
    expect(result.rooms).toHaveLength(1);
    const room = result.rooms[0];
    expect(room.id).toBe('living_room');
    expect(room.camera).toBe('doorbell');
    expect(room.lights[0]).toMatchObject({
      entityId: 'light.lr_main', label: 'Main', on: true, available: true,
    });
    expect(room.climate).toMatchObject({ tempF: 71.4, humidityPct: 42, available: true });
    expect(room.motion).toMatchObject({ state: 'clear', available: true });
  });

  it('marks entities unavailable when not returned by gateway', async () => {
    const uc = new GetDashboardState({
      configRepository: { load: async () => config },
      haGateway: makeGateway(new Map()),
    });
    const result = await uc.execute();
    expect(result.rooms[0].lights[0].available).toBe(false);
    expect(result.rooms[0].climate.available).toBe(false);
    expect(result.rooms[0].motion.available).toBe(false);
  });

  it('batches gateway call with all distinct entity ids from config', async () => {
    const gateway = makeGateway(new Map());
    const uc = new GetDashboardState({
      configRepository: { load: async () => config },
      haGateway: gateway,
    });
    await uc.execute();
    const ids = gateway.getStates.mock.calls[0][0];
    expect(ids).toEqual(expect.arrayContaining([
      'light.lr_main', 'sensor.lr_temp', 'sensor.lr_hum', 'binary_sensor.lr_motion',
    ]));
  });
});
