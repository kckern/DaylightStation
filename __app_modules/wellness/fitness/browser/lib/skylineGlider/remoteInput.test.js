import { describe, expect, it } from 'vitest';
import { normalizeRemoteMapping, remoteAction } from './remoteInput.js';

const MAPPING = { up: 'missile', down: 'bomb', front: 'boost', center: 'laser', rear: 'pause' };

describe('Glider remote mapping', () => {
  it('keeps known directions and actions, reports the rest', () => {
    const { mapping, dropped } = normalizeRemoteMapping({ ...MAPPING, left: 'jump', sideways: 'laser' });
    expect(mapping).toEqual(MAPPING);
    expect(dropped).toEqual([{ direction: 'left', action: 'jump' }, { direction: 'sideways', action: 'laser' }]);
    expect(normalizeRemoteMapping(null).mapping).toEqual({});
  });
  it('a direction is its action; an unmapped one is nothing', () => {
    expect(remoteAction(MAPPING, 'rear')).toBe('pause');
    expect(remoteAction(MAPPING, 'left')).toBeNull();
    expect(remoteAction({}, 'up')).toBeNull();
  });
});
