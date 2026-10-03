import { describe, it, expect, vi } from 'vitest';
import { createRegistrySessionSource } from './registrySessionSource.js';
import { createPlayerSessionRegistry } from './playerSessionRegistry.js';
import { createScreenSessionControls } from '../session/screenSessionControls.js';
import { validateSessionSnapshot } from '@shared-contracts/media/shapes.mjs';

describe('registrySessionSource — screen session controls', () => {
  it('publishes controls and the latest command origin on every snapshot', () => {
    const controls = createScreenSessionControls({ ownerId: 'tv', ports: { getSnapshot: () => null } });
    const source = createRegistrySessionSource({ registry: createPlayerSessionRegistry(), ownerId: 'tv', controls });
    let snap = source.getSnapshot();
    expect(snap.controls).toMatchObject({ addOnly: false, endOfQueue: 'stop' });
    expect(snap.meta).not.toHaveProperty('origin');
    controls.applyConfig('addOnly', true);
    controls.stampOrigin({ kind: 'routine', name: 'Bedtime' });
    snap = source.getSnapshot();
    expect(snap.controls.addOnly).toBe(true);
    expect(snap.meta.origin).toEqual({ kind: 'routine', name: 'Bedtime' });
    expect(validateSessionSnapshot(snap).valid).toBe(true);
  });

  it('re-publishes when the controls change', () => {
    const controls = createScreenSessionControls({ ownerId: 'tv', ports: { getSnapshot: () => null } });
    const source = createRegistrySessionSource({ registry: createPlayerSessionRegistry(), ownerId: 'tv', controls });
    const onChange = vi.fn();
    const unsubscribe = source.subscribe({ onChange });
    controls.applyConfig('endOfQueue', 'similar');
    expect(onChange).toHaveBeenCalled();
    unsubscribe();
    onChange.mockClear();
    controls.applyConfig('endOfQueue', 'repeat');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is unchanged without controls', () => {
    const source = createRegistrySessionSource({ registry: createPlayerSessionRegistry(), ownerId: 'tv' });
    expect(source.getSnapshot()).not.toHaveProperty('controls');
  });
});
