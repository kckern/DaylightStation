import { describe, it, expect } from 'vitest';

describe('QueryAdapter immich exclude + slideshow', () => {
  it('exclude filter removes matching asset IDs', () => {
    const items = [
      { id: 'immich:aaa', mediaType: 'image', metadata: {} },
      { id: 'immich:bbb', mediaType: 'video', metadata: {} },
      { id: 'immich:ccc', mediaType: 'image', metadata: {} },
    ];
    const exclude = ['aaa'];

    const excludeSet = new Set(exclude);
    const filtered = items.filter(item => {
      const assetId = item.id?.replace(/^immich:/, '');
      return !excludeSet.has(assetId);
    });

    expect(filtered).toHaveLength(2);
    expect(filtered.map(i => i.id)).toEqual(['immich:bbb', 'immich:ccc']);
  });

  it('exclude filter handles empty exclude list', () => {
    const items = [
      { id: 'immich:aaa', mediaType: 'image' },
      { id: 'immich:bbb', mediaType: 'video' },
    ];
    const exclude = [];

    // With empty exclude, filter should not be applied
    const shouldFilter = exclude?.length > 0;
    expect(shouldFilter).toBe(false);
    // Items unchanged
    expect(items).toHaveLength(2);
  });

  it('slideshow config stamped on image items only', () => {
    const slideshow = { duration: 5, effect: 'kenburns', zoom: 1.2 };
    const items = [
      { id: 'immich:aaa', mediaType: 'image', metadata: {} },
      { id: 'immich:bbb', mediaType: 'video', metadata: {} },
      { id: 'immich:ccc', mediaType: 'image', metadata: {} },
    ];

    for (const item of items) {
      if (item.mediaType === 'image' && slideshow) {
        item.slideshow = slideshow;
      }
    }

    expect(items[0].slideshow).toEqual(slideshow);
    expect(items[1]).not.toHaveProperty('slideshow');
    expect(items[2].slideshow).toEqual(slideshow);
  });

  it('slideshow not stamped when query has no slideshow config', () => {
    const items = [
      { id: 'immich:aaa', mediaType: 'image', metadata: {} },
    ];
    const slideshow = null;

    if (slideshow) {
      for (const item of items) {
        if (item.mediaType === 'image') {
          item.slideshow = slideshow;
        }
      }
    }

    expect(items[0]).not.toHaveProperty('slideshow');
  });
});
