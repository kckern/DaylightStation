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

  it('preserves an item-level shader', () => {
    const qi = toQueueItem({
      id: 'immich:video',
      source: 'immich',
      mediaType: 'video',
      shader: 'focused',
      metadata: {},
    });

    expect(qi.shader).toBe('focused');
  });

  it('preserves capture-place wall clock and timezone for player overlays', () => {
    const qi = toQueueItem({
      id: 'immich:korea-photo',
      source: 'immich',
      title: '2018-10-08 16.30.33.jpg',
      mediaType: 'image',
      mediaUrl: '/photo.jpg',
      metadata: {
        capturedAt: '2018-10-08T07:30:33.095Z',
        localDateTime: '2018-10-08T16:30:33.095Z',
        captureTimeZone: 'Asia/Seoul',
      },
    });

    expect(qi.metadata).toMatchObject({
      capturedAt: '2018-10-08T07:30:33.095Z',
      localDateTime: '2018-10-08T16:30:33.095Z',
      captureTimeZone: 'Asia/Seoul',
    });
  });
});
