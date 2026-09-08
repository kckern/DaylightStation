import { describe, it, expect } from 'vitest';
import { equipmentImageMap } from './equipmentImages.mjs';

describe('equipmentImageMap', () => {
  it('maps only equipment that declares a filename', () => {
    expect(equipmentImageMap({
      equipment: [
        { id: 'generic_pedaler', image: 'peddler.jpg' },
        { id: 'niceday' },
      ],
    })).toEqual({ generic_pedaler: 'peddler.jpg' });
  });

  it('skips malformed entries instead of producing junk keys', () => {
    expect(equipmentImageMap({
      equipment: [
        { image: 'orphan.jpg' },
        { id: 'blank', image: '' },
        { id: 'numeric', image: 7 },
        null,
      ],
    })).toEqual({});
  });

  it('returns an empty map for absent or malformed config', () => {
    expect(equipmentImageMap(null)).toEqual({});
    expect(equipmentImageMap({})).toEqual({});
    expect(equipmentImageMap({ equipment: 'not-a-list' })).toEqual({});
  });
});
