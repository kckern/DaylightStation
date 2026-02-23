import { describe, it, expect } from '@jest/globals';
import { ISyncSource, isSyncSource } from '#apps/content/ports/ISyncSource.mjs';

describe('ISyncSource', () => {
  it('throws on direct method calls', async () => {
    const port = new ISyncSource();
    await expect(port.sync()).rejects.toThrow('ISyncSource.sync must be implemented');
    await expect(port.getStatus()).rejects.toThrow('ISyncSource.getStatus must be implemented');
  });

  describe('isSyncSource', () => {
    it('returns true for valid implementation', () => {
      const impl = { sync: async () => {}, getStatus: async () => {} };
      expect(isSyncSource(impl)).toBe(true);
    });

    it('returns false for incomplete implementation', () => {
      expect(isSyncSource({})).toBe(false);
      expect(isSyncSource({ sync: async () => {} })).toBe(false);
      expect(isSyncSource(null)).toBe(false);
    });
  });
});
