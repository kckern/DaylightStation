/**
 * Tests for short ID utilities
 */

import { shortId, shortIdFromUuid, isShortId, isUuid } from '../../../_lib/shortId.mjs';

const BASE62_REGEX = /^[A-Za-z0-9]+$/;

describe('shortId', () => {
  it('should generate base62 IDs of default length', () => {
    const id = shortId();
    expect(isShortId(id)).toBe(true);
    expect(id).toHaveLength(10);
    expect(BASE62_REGEX.test(id)).toBe(true);
  });

  it('should generate unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => shortId()));
    expect(ids.size).toBe(100);
  });

  it('shortIdFromUuid should be deterministic', () => {
    const uuid = '18835f8e-2fa6-4d1a-ba74-e09720cebfaa';
    const first = shortIdFromUuid(uuid);
    const second = shortIdFromUuid(uuid);
    expect(first).toBe(second);
    expect(isShortId(first)).toBe(true);
  });

  it('isUuid should validate UUIDs', () => {
    expect(isUuid('18835f8e-2fa6-4d1a-ba74-e09720cebfaa')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});
