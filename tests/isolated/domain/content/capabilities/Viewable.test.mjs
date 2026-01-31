// tests/isolated/domain/content/capabilities/Viewable.test.mjs
import { ViewableItem } from '#domains/content/capabilities/Viewable.mjs';

describe('ViewableItem', () => {
  describe('constructor', () => {
    test('creates viewable with required properties', () => {
      const viewable = new ViewableItem({
        id: 'immich:abc-123',
        source: 'immich',
        title: 'Beach Photo.jpg',
        imageUrl: '/api/v1/proxy/immich/assets/abc-123/original'
      });

      expect(viewable.id).toBe('immich:abc-123');
      expect(viewable.source).toBe('immich');
      expect(viewable.title).toBe('Beach Photo.jpg');
      expect(viewable.imageUrl).toBe('/api/v1/proxy/immich/assets/abc-123/original');
    });

    test('sets optional properties with defaults', () => {
      const viewable = new ViewableItem({
        id: 'immich:abc-123',
        source: 'immich',
        title: 'Photo.jpg',
        imageUrl: '/image.jpg'
      });

      expect(viewable.thumbnail).toBeNull();
      expect(viewable.width).toBeNull();
      expect(viewable.height).toBeNull();
      expect(viewable.mimeType).toBeNull();
    });

    test('accepts all optional properties', () => {
      const viewable = new ViewableItem({
        id: 'immich:abc-123',
        source: 'immich',
        title: 'Photo.jpg',
        imageUrl: '/original.jpg',
        thumbnail: '/thumb.jpg',
        width: 1920,
        height: 1080,
        mimeType: 'image/jpeg',
        metadata: { exif: { iso: 200 } }
      });

      expect(viewable.thumbnail).toBe('/thumb.jpg');
      expect(viewable.width).toBe(1920);
      expect(viewable.height).toBe(1080);
      expect(viewable.mimeType).toBe('image/jpeg');
      expect(viewable.metadata.exif.iso).toBe(200);
    });
  });

  describe('aspectRatio', () => {
    test('calculates aspect ratio from dimensions', () => {
      const viewable = new ViewableItem({
        id: 'immich:abc-123',
        source: 'immich',
        title: 'Photo.jpg',
        imageUrl: '/image.jpg',
        width: 1920,
        height: 1080
      });

      expect(viewable.aspectRatio).toBeCloseTo(1.777, 2);
    });

    test('returns null when dimensions missing', () => {
      const viewable = new ViewableItem({
        id: 'immich:abc-123',
        source: 'immich',
        title: 'Photo.jpg',
        imageUrl: '/image.jpg'
      });

      expect(viewable.aspectRatio).toBeNull();
    });

    test('returns null when only width provided', () => {
      const viewable = new ViewableItem({
        id: 'immich:abc-123',
        source: 'immich',
        title: 'Photo.jpg',
        imageUrl: '/image.jpg',
        width: 1920
      });

      expect(viewable.aspectRatio).toBeNull();
    });
  });

  describe('isViewable', () => {
    test('returns true', () => {
      const viewable = new ViewableItem({
        id: 'immich:abc-123',
        source: 'immich',
        title: 'Photo.jpg',
        imageUrl: '/image.jpg'
      });

      expect(viewable.isViewable()).toBe(true);
    });
  });
});
