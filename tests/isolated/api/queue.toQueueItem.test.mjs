import { describe, it, expect } from 'vitest';
import { toQueueItem } from '../../../backend/src/4_api/v1/routers/queue.mjs';

describe('toQueueItem', () => {
  it('passes through titlecard payload', () => {
    const item = {
      id: 'titlecard:test:0',
      source: 'titlecard',
      title: 'Hello',
      mediaType: 'image',
      mediaUrl: null,
      duration: 6,
      metadata: { contentFormat: 'titlecard' },
      slideshow: { duration: 6, effect: 'kenburns' },
      titlecard: {
        template: 'centered',
        text: { title: 'Hello', subtitle: 'World' },
        theme: 'warm-gold',
        css: { title: { fontSize: '4rem' } },
        imageUrl: '/api/v1/proxy/immich/assets/abc/original',
      },
    };

    const qi = toQueueItem(item);

    expect(qi.format).toBe('titlecard');
    expect(qi.titlecard).toEqual(item.titlecard);
    expect(qi.slideshow).toEqual(item.slideshow);
    expect(qi.mediaType).toBe('image');
  });

  it('omits titlecard field when not present', () => {
    const item = {
      id: 'immich:photo1',
      source: 'immich',
      title: 'Photo',
      mediaType: 'image',
      mediaUrl: '/api/v1/proxy/immich/assets/abc/original',
      duration: 0,
      metadata: {},
    };

    const qi = toQueueItem(item);

    expect(qi.titlecard).toBeUndefined();
  });
});
