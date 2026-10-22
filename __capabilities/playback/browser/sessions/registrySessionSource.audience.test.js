import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../../frontend/src/lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ debug() {}, info() {}, warn() {} }) }) }));
import { createRegistrySessionSource } from './registrySessionSource.js';
import { createAudienceStore } from './deviceAudience.js';

const registry = () => {
  const subs = new Set();
  return { getCurrent: () => null, subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); } };
};
const A = { activity: 'story', people: [{ id: 'learner-a', name: 'Learner A', role: 'learner', guest: false }] };

describe('registrySessionSource audience', () => {
  it('idle snapshots carry the declared audience, and only while declared', () => {
    const audience = createAudienceStore();
    const src = createRegistrySessionSource({ registry: registry(), ownerId: 'livingroom-tv', audience });
    expect(src.getSnapshot().audience).toBeUndefined();
    audience.declare('t', A);
    expect(src.getSnapshot().audience).toEqual(A);
    expect(src.getSnapshot().state).toBe('idle');
    audience.withdraw('t');
    expect(src.getSnapshot().audience).toBeUndefined();
  });

  it('a declaration change re-publishes', () => {
    const audience = createAudienceStore();
    const src = createRegistrySessionSource({ registry: registry(), ownerId: 'garage-tv', audience });
    const onChange = vi.fn();
    const unsub = src.subscribe({ onChange });
    audience.declare('t', A);
    expect(onChange).toHaveBeenCalledTimes(1);
    unsub();
    audience.withdraw('t');
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
