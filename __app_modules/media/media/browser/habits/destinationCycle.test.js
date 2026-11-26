import { describe, it, expect } from 'vitest';
import { destinationCycle, nextDestination } from './destinationCycle.js';

const devices = [
  { id: 'livingroom-tv', content_control: {} },
  { id: 'office-tv', name: 'Office Screen', content_control: {} },
  { id: 'speaker-red', type: 'speaker', content_control: {} },
  { id: 'garage-tv', fleet: true },
];

describe('destinationCycle', () => {
  it('usual first, then other video screens by name, then This device', () => {
    const cycle = destinationCycle({ devices, usualIds: ['office-tv'], localId: 'browser:x' });
    expect(cycle.map((c) => c.label)).toEqual(['Office Screen', 'Living Room TV', 'This device']);
    expect(cycle[0].targetIds).toEqual(['office-tv']);
    expect(cycle[2].targetIds).toEqual([]);
  });

  it('without a usual screen orders by name', () => {
    const cycle = destinationCycle({ devices, usualIds: [], localId: null });
    expect(cycle.map((c) => c.label)).toEqual(['Living Room TV', 'Office Screen', 'This device']);
  });

  it('drops the local browser and an unknown usual id', () => {
    const cycle = destinationCycle({
      devices: [...devices, { id: 'browser:x', type: 'browser' }],
      usualIds: ['gone-tv'], localId: 'browser:x',
    });
    expect(cycle.map((c) => c.label)).toEqual(['Living Room TV', 'Office Screen', 'This device']);
  });
});

describe('nextDestination', () => {
  const cycle = destinationCycle({ devices, usualIds: ['office-tv'], localId: null });
  it('wraps forward and back', () => {
    expect(nextDestination(cycle, ['livingroom-tv'], 1).label).toBe('This device');
    expect(nextDestination(cycle, [], 1).label).toBe('Office Screen');
    expect(nextDestination(cycle, ['office-tv'], -1).label).toBe('This device');
  });
  it('unknown current goes to the first entry', () => {
    expect(nextDestination(cycle, ['gone'], 1).label).toBe('Office Screen');
  });
});
