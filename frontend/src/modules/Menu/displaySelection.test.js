import { describe, it, expect } from 'vitest';
import { artSceneIdFromDisplay } from './displaySelection.js';

describe('artSceneIdFromDisplay', () => {
  it('returns the id for an art: contentId', () => {
    expect(artSceneIdFromDisplay({ contentId: 'art:baroque' })).toBe('art:baroque');
  });
  it('accepts an id field too', () => {
    expect(artSceneIdFromDisplay({ id: 'art:modern' })).toBe('art:modern');
  });
  it('returns null for non-art display content', () => {
    expect(artSceneIdFromDisplay({ contentId: 'immich:abc' })).toBeNull();
    expect(artSceneIdFromDisplay({ contentId: 'canvas:photos' })).toBeNull();
  });
  it('returns null for empty/missing', () => {
    expect(artSceneIdFromDisplay(null)).toBeNull();
    expect(artSceneIdFromDisplay({})).toBeNull();
  });
});
