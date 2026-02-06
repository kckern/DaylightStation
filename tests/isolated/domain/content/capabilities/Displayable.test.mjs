// tests/isolated/domain/content/capabilities/Displayable.test.mjs
import { describe, it, expect } from 'vitest';
import { DisplayableItem } from '#domains/content/capabilities/Displayable.mjs';

describe('DisplayableItem', () => {
  const validProps = {
    id: 'canvas:test-123',
    source: 'files',
    title: 'Starry Night',
    imageUrl: '/api/v1/canvas/image/test-123',
    category: 'impressionist',
    artist: 'Vincent van Gogh',
    year: 1889,
    tags: ['night', 'calm'],
    frameStyle: 'ornate',
  };

  it('creates item with all properties', () => {
    const item = new DisplayableItem(validProps);
    expect(item.id).toBe('canvas:test-123');
    expect(item.category).toBe('impressionist');
    expect(item.artist).toBe('Vincent van Gogh');
    expect(item.year).toBe(1889);
    expect(item.tags).toEqual(['night', 'calm']);
    expect(item.frameStyle).toBe('ornate');
  });

  it('has imageUrl and isDisplayable capability', () => {
    const item = new DisplayableItem(validProps);
    expect(item.imageUrl).toBe('/api/v1/canvas/image/test-123');
    expect(item.isDisplayable()).toBe(true);
  });

  it('defaults tags to empty array', () => {
    const props = { ...validProps, tags: undefined };
    const item = new DisplayableItem(props);
    expect(item.tags).toEqual([]);
  });

  it('defaults frameStyle to classic', () => {
    const props = { ...validProps, frameStyle: undefined };
    const item = new DisplayableItem(props);
    expect(item.frameStyle).toBe('classic');
  });

  it('requires imageUrl (inherited)', () => {
    const props = { ...validProps, imageUrl: undefined };
    expect(() => new DisplayableItem(props)).toThrow(/imageUrl/);
  });
});
