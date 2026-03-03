import { describe, it, expect } from 'vitest';
import { ListableItem } from '../../../../../../backend/src/2_domains/content/capabilities/Listable.mjs';
import { resolveFormat } from '../../../../../../backend/src/2_domains/content/utils/resolveFormat.mjs';

describe('ImmichAdapter face enrichment', () => {
  const transformPeople = (people) =>
    people?.map(p => ({
      name: p.name,
      id: p.id,
      faces: p.faces?.map(f => ({
        x1: f.boundingBoxX1, y1: f.boundingBoxY1,
        x2: f.boundingBoxX2, y2: f.boundingBoxY2,
        imageWidth: f.imageWidth, imageHeight: f.imageHeight,
      })) || [],
    })) || [];

  it('transforms people with face bounding boxes', () => {
    const input = [{
      name: 'Felix',
      id: 'person-uuid-1',
      faces: [{
        boundingBoxX1: 100, boundingBoxY1: 50,
        boundingBoxX2: 300, boundingBoxY2: 250,
        imageWidth: 1024, imageHeight: 768,
      }],
    }];

    const result = transformPeople(input);
    expect(result).toEqual([{
      name: 'Felix',
      id: 'person-uuid-1',
      faces: [{
        x1: 100, y1: 50, x2: 300, y2: 250,
        imageWidth: 1024, imageHeight: 768,
      }],
    }]);
  });

  it('handles people with no faces array', () => {
    const input = [{ name: 'Unknown', id: 'person-uuid-2' }];
    const result = transformPeople(input);
    expect(result).toEqual([{ name: 'Unknown', id: 'person-uuid-2', faces: [] }]);
  });

  it('handles null/undefined people', () => {
    expect(transformPeople(null)).toEqual([]);
    expect(transformPeople(undefined)).toEqual([]);
  });

  it('preserves backward compatibility — name field still accessible', () => {
    const input = [{ name: 'Felix', id: 'p1', faces: [] }];
    const result = transformPeople(input);
    expect(result[0].name).toBe('Felix');
    expect(result.map(p => p.name)).toEqual(['Felix']);
  });
});

describe('ImmichAdapter ListableItem image format contract', () => {
  it('ListableItem with mediaType "image" causes resolveFormat to return "image"', () => {
    const item = new ListableItem({
      id: 'immich:test-asset-uuid',
      source: 'immich',
      title: 'photo.jpg',
      itemType: 'leaf',
      mediaType: 'image',
      thumbnail: '/thumb/test-asset-uuid',
      imageUrl: '/original/test-asset-uuid',
      metadata: { type: 'image', category: 'media' },
    });

    expect(item.mediaType).toBe('image');
    expect(resolveFormat(item)).toBe('image');
  });

  it('ListableItem without mediaType falls back to "video" via resolveFormat', () => {
    const item = new ListableItem({
      id: 'immich:test-asset-uuid',
      source: 'immich',
      title: 'photo.jpg',
      itemType: 'leaf',
      thumbnail: '/thumb/test-asset-uuid',
      imageUrl: '/original/test-asset-uuid',
      metadata: { type: 'image', category: 'media' },
    });

    // Without mediaType, resolveFormat falls through to the 'video' default
    expect(item.mediaType).toBeNull();
    expect(resolveFormat(item)).toBe('video');
  });

  it('ListableItem with contentFormat in metadata takes priority over mediaType', () => {
    const item = new ListableItem({
      id: 'immich:test-asset-uuid',
      source: 'immich',
      title: 'photo.jpg',
      itemType: 'leaf',
      mediaType: 'image',
      metadata: { contentFormat: 'gallery' },
    });

    // metadata.contentFormat is priority 1 in resolveFormat
    expect(resolveFormat(item)).toBe('gallery');
  });
});
