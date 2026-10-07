import { describe, expect, it } from 'vitest';
import { listUsableSkylineBikes, selectSkylineBike } from './bikeSelection.js';

const equipment = [
  { id: 'cycle_ace', name: 'CycleAce', cadence: 10 },
  { id: 'niceday', name: 'NiceDay', cadence: 20 },
  { id: 'spare', name: 'Spare', cadence: 30 },
];

function session({ riders = {}, cadence = {} } = {}) {
  return {
    getEquipmentRider: (id) => riders[id] || null,
    getEquipmentCadence: (id) => cadence[id] || { connected: false, rpm: 0 },
  };
}

describe('Skyline Glider bike selection', () => {
  it('prefers a usable NiceDay, then CycleAce, then another usable cadence bike', () => {
    const live = session({ riders: { niceday: 'test-rider', cycle_ace: 'dad', spare: 'alex' }, cadence: {
      niceday: { connected: true, rpm: 60 }, cycle_ace: { connected: true, rpm: 55 }, spare: { connected: true, rpm: 50 },
    } });
    expect(selectSkylineBike(equipment, live).equipment.id).toBe('niceday');
    live.getEquipmentCadence = (id) => id === 'cycle_ace' ? { connected: true, rpm: 55 } : { connected: false, rpm: 0 };
    expect(selectSkylineBike(equipment, live).equipment.id).toBe('cycle_ace');
  });

  it('skips unclaimed, disconnected, and transport-stalled bikes', () => {
    const live = session({ riders: { niceday: 'test-rider', cycle_ace: 'dad', spare: 'alex' }, cadence: {
      niceday: { connected: false, rpm: 60 }, cycle_ace: { connected: true, transportStalled: true, rpm: 55 }, spare: { connected: true, rpm: 50 },
    } });
    expect(listUsableSkylineBikes(equipment, live).map((item) => item.equipment.id)).toEqual(['spare']);
  });

  it('honors a manually preferred usable bike without mutating the catalog', () => {
    const live = session({ riders: { niceday: 'test-rider', cycle_ace: 'dad' }, cadence: {
      niceday: { connected: true, rpm: 60 }, cycle_ace: { connected: true, rpm: 55 },
    } });
    expect(selectSkylineBike(equipment, live, 'cycle_ace')).toMatchObject({ riderId: 'dad', equipment: { id: 'cycle_ace' } });
    expect(equipment.map((item) => item.id)).toEqual(['cycle_ace', 'niceday', 'spare']);
  });
});
