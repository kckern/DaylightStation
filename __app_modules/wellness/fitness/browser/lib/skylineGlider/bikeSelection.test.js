import { describe, expect, it } from 'vitest';
import { listUsableSkylineBikes, selectSkylineBike } from "./bikeSelection.js";

// Fictional catalog: order comes from `skyline_glider.priority`, never from ids.
const equipment = [
  { id: 'bike_b', name: 'Bike B', cadence: 10, skyline_glider: { priority: 1 } },
  { id: 'bike_a', name: 'Bike A', cadence: 20, skyline_glider: { priority: 0 } },
  { id: 'spare', name: 'Spare', cadence: 30 },
];

function session({ riders = {}, cadence = {} } = {}) {
  return {
    getEquipmentRider: (id) => riders[id] || null,
    getEquipmentCadence: (id) => cadence[id] || { connected: false, rpm: 0 },
  };
}

describe('Skyline Glider bike selection', () => {
  it('prefers the usable bike with the lowest configured priority, then unranked bikes', () => {
    const live = session({ riders: { bike_a: 'test-rider', bike_b: 'dad', spare: 'alex' }, cadence: {
      bike_a: { connected: true, rpm: 60 }, bike_b: { connected: true, rpm: 55 }, spare: { connected: true, rpm: 50 },
    } });
    expect(selectSkylineBike(equipment, live).equipment.id).toBe('bike_a');
    expect(listUsableSkylineBikes(equipment, live).map((item) => item.equipment.id)).toEqual(['bike_a', 'bike_b', 'spare']);
    live.getEquipmentCadence = (id) => id === 'bike_b' ? { connected: true, rpm: 55 } : { connected: false, rpm: 0 };
    expect(selectSkylineBike(equipment, live).equipment.id).toBe('bike_b');
  });

  it('keeps config order when no bike carries a priority', () => {
    const plain = equipment.map(({ skyline_glider: _sg, ...item }) => item);
    const live = session({ riders: { bike_a: 'a', bike_b: 'b', spare: 'c' }, cadence: {
      bike_a: { connected: true, rpm: 60 }, bike_b: { connected: true, rpm: 55 }, spare: { connected: true, rpm: 50 },
    } });
    expect(listUsableSkylineBikes(plain, live).map((item) => item.equipment.id)).toEqual(['bike_b', 'bike_a', 'spare']);
  });

  it('skips unclaimed, disconnected, and transport-stalled bikes', () => {
    const live = session({ riders: { bike_a: 'test-rider', bike_b: 'dad', spare: 'alex' }, cadence: {
      bike_a: { connected: false, rpm: 60 }, bike_b: { connected: true, transportStalled: true, rpm: 55 }, spare: { connected: true, rpm: 50 },
    } });
    expect(listUsableSkylineBikes(equipment, live).map((item) => item.equipment.id)).toEqual(['spare']);
  });

  it('honors a manually preferred usable bike without mutating the catalog', () => {
    const live = session({ riders: { bike_a: 'test-rider', bike_b: 'dad' }, cadence: {
      bike_a: { connected: true, rpm: 60 }, bike_b: { connected: true, rpm: 55 },
    } });
    expect(selectSkylineBike(equipment, live, 'bike_b')).toMatchObject({ riderId: 'dad', equipment: { id: 'bike_b' } });
    expect(equipment.map((item) => item.id)).toEqual(['bike_b', 'bike_a', 'spare']);
  });
});
