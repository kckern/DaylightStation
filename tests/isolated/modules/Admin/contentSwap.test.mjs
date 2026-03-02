import { describe, it, expect } from 'vitest';
import {
  CONTENT_PAYLOAD_FIELDS,
  IDENTITY_FIELDS,
  swapContentPayloads,
  ITEM_DEFAULTS
} from '#frontend/modules/Admin/ContentLists/listConstants.js';

describe('CONTENT_PAYLOAD_FIELDS', () => {
  it('should not overlap with IDENTITY_FIELDS', () => {
    const overlap = CONTENT_PAYLOAD_FIELDS.filter(f => IDENTITY_FIELDS.includes(f));
    expect(overlap).toEqual([]);
  });

  it('should include input and action', () => {
    expect(CONTENT_PAYLOAD_FIELDS).toContain('input');
    expect(CONTENT_PAYLOAD_FIELDS).toContain('action');
  });

  it('should include all playback fields', () => {
    for (const field of ['shuffle', 'continuous', 'loop', 'fixedOrder', 'volume', 'playbackRate']) {
      expect(CONTENT_PAYLOAD_FIELDS).toContain(field);
    }
  });
});

describe('swapContentPayloads', () => {
  it('should swap content fields between two items', () => {
    const itemA = { label: 'Morning', image: '/img/a.jpg', uid: 'uid-a', active: true, input: 'plex:123', action: 'Play', shuffle: true, volume: 80 };
    const itemB = { label: 'Evening', image: '/img/b.jpg', uid: 'uid-b', active: false, input: 'abs:456', action: 'Queue', shuffle: false, volume: 100 };

    const { updatesForA, updatesForB } = swapContentPayloads(itemA, itemB);

    // A gets B's content
    expect(updatesForA.input).toBe('abs:456');
    expect(updatesForA.action).toBe('Queue');
    expect(updatesForA.shuffle).toBe(false);
    expect(updatesForA.volume).toBe(100);

    // B gets A's content
    expect(updatesForB.input).toBe('plex:123');
    expect(updatesForB.action).toBe('Play');
    expect(updatesForB.shuffle).toBe(true);
    expect(updatesForB.volume).toBe(80);
  });

  it('should not include identity fields in swap', () => {
    const itemA = { label: 'A', image: '/a.jpg', uid: 'a', active: true, input: 'plex:1', action: 'Play' };
    const itemB = { label: 'B', image: '/b.jpg', uid: 'b', active: false, input: 'plex:2', action: 'List' };

    const { updatesForA, updatesForB } = swapContentPayloads(itemA, itemB);

    expect(updatesForA.label).toBeUndefined();
    expect(updatesForA.image).toBeUndefined();
    expect(updatesForA.uid).toBeUndefined();
    expect(updatesForA.active).toBeUndefined();
    expect(updatesForB.label).toBeUndefined();
    expect(updatesForB.image).toBeUndefined();
  });

  it('should handle undefined fields by using ITEM_DEFAULTS', () => {
    const itemA = { label: 'A', input: 'plex:1', action: 'Play' };
    const itemB = { label: 'B', input: 'plex:2', action: 'List', shuffle: true };

    const { updatesForA } = swapContentPayloads(itemA, itemB);
    expect(updatesForA.shuffle).toBe(true);

    const { updatesForB } = swapContentPayloads(itemA, itemB);
    expect(updatesForB.shuffle).toBe(ITEM_DEFAULTS.shuffle);
  });
});
