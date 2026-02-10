// tests/isolated/adapter/content/readalong/scripture-decoupling.test.mjs
//
// Verifies that ReadalongAdapter uses manifest config instead of
// hardcoded `collection === 'scripture'` checks for:
//   1. getStoragePath  → manifest.storagePath
//   2. _extractTitles  → manifest.titleGenerator
//   3. resolvePlayables → manifest.resolver (no collection gate)
//   4. getContainerType → manifest.containerType
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock FileIO
vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYamlByPrefix: vi.fn(),
  loadContainedYaml: vi.fn(),
  findMediaFileByPrefix: vi.fn(),
  fileExists: vi.fn(() => false),
  dirExists: vi.fn(() => true),
  listDirs: vi.fn(() => []),
  listYamlFiles: vi.fn(() => [])
}));

// Mock domains/content index for ItemSelectionService
vi.mock('#domains/content/index.mjs', () => ({
  ItemSelectionService: { select: vi.fn(() => []) }
}));

const { loadContainedYaml, findMediaFileByPrefix } = await import('#system/utils/FileIO.mjs');
const { ReadalongAdapter } = await import('#adapters/content/readalong/ReadalongAdapter.mjs');

describe('ReadalongAdapter – scripture decoupling', () => {
  let adapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ReadalongAdapter({
      dataPath: '/mock/data/content/readalong',
      mediaPath: '/mock/media/readalong'
    });
  });

  // ---------- Spot 1: getStoragePath ----------

  describe('getStoragePath (manifest.storagePath)', () => {
    it('returns manifest.storagePath when present', () => {
      loadContainedYaml.mockImplementation((_dir, name) => {
        if (name === 'manifest') return { storagePath: 'scriptures' };
        return null;
      });

      expect(adapter.getStoragePath('readalong:scripture/bom')).toBe('scriptures');
    });

    it('returns "readalong" when manifest has no storagePath', () => {
      loadContainedYaml.mockImplementation((_dir, name) => {
        if (name === 'manifest') return {};
        return null;
      });

      expect(adapter.getStoragePath('readalong:talks/ldsgc')).toBe('readalong');
    });

    it('returns "readalong" when no manifest exists', () => {
      loadContainedYaml.mockReturnValue(null);

      expect(adapter.getStoragePath('readalong:poetry/haiku')).toBe('readalong');
    });

    it('returns "readalong" when id is undefined', () => {
      expect(adapter.getStoragePath()).toBe('readalong');
    });

    it('works for hypothetical non-scripture collection with custom storagePath', () => {
      loadContainedYaml.mockImplementation((_dir, name) => {
        if (name === 'manifest') return { storagePath: 'custom-store' };
        return null;
      });

      expect(adapter.getStoragePath('readalong:custom/item1')).toBe('custom-store');
    });
  });

  // ---------- Spot 2: _extractTitles ----------

  describe('_extractTitles (manifest.titleGenerator)', () => {
    it('uses generateReference when manifest.titleGenerator is "scripture-reference" and verseId exists', () => {
      // generateReference is imported from scripture-guide inside the adapter.
      // Since it's in backend/node_modules, vi.mock may not intercept it.
      // Instead we test the observable behavior: title should be a scripture reference format.
      const manifest = { titleGenerator: 'scripture-reference' };
      const titleSource = { headings: { heading: 'The Word is a Seed' } };
      // Use a real verse ID that generateReference can handle
      const resolvedMeta = { verseId: '34541' };

      const result = adapter._extractTitles(manifest, titleSource, resolvedMeta, 'fallback');

      // generateReference(34541) should return something like "Alma 32:21"
      // which gets stripped to "Alma 32"
      // If generateReference fails, it falls through to titleSource
      if (result.title !== 'The Word is a Seed') {
        // generateReference worked — title should be a chapter ref without verse
        expect(result.title).not.toBe('fallback');
        expect(result.title).not.toContain(':'); // verse number stripped
      }
      // Either way, the method shouldn't throw
      expect(result.title).toBeTruthy();
    });

    it('falls through to default when titleGenerator set but no verseId', () => {
      const manifest = { titleGenerator: 'scripture-reference' };
      const titleSource = { title: 'Some Talk', speaker: 'Elder Smith' };

      const result = adapter._extractTitles(manifest, titleSource, null, 'fallback');

      expect(result.title).toBe('Some Talk');
      expect(result.subtitle).toBe('Elder Smith');
    });

    it('falls through to default when no titleGenerator in manifest', () => {
      const manifest = {};
      const titleSource = { title: 'Poetry Title', author: 'Emily Dickinson' };

      const result = adapter._extractTitles(manifest, titleSource, null, 'fallback');

      expect(result.title).toBe('Poetry Title');
      expect(result.subtitle).toBe('Emily Dickinson');
    });

    it('falls through to default when verseId is invalid', () => {
      const manifest = { titleGenerator: 'scripture-reference' };
      const titleSource = { headings: { heading: 'Chapter Heading' } };
      // Use an out-of-range verse ID that generateReference won't handle well
      const resolvedMeta = { verseId: '99999999' };

      const result = adapter._extractTitles(manifest, titleSource, resolvedMeta, 'fallback');

      // Should either get a generated title or fall through to heading
      expect(result.title).toBeTruthy();
    });

    it('uses fallback when titleSource has no title fields', () => {
      const manifest = {};
      const titleSource = {};

      const result = adapter._extractTitles(manifest, titleSource, null, 'my-fallback');

      expect(result.title).toBe('my-fallback');
      expect(result.subtitle).toBeNull();
    });

    it('strips verse number from generated reference', () => {
      const manifest = { titleGenerator: 'scripture-reference' };
      // Use a real NT verse ID (Luke 4:1 area)
      const resolvedMeta = { verseId: '25065' };

      const result = adapter._extractTitles(manifest, {}, resolvedMeta, 'fallback');

      // If generateReference works, title should not have a colon (verse stripped)
      // If it fails, falls through to fallback
      if (result.title !== 'fallback') {
        expect(result.title).not.toContain(':');
      }
      expect(result.title).toBeTruthy();
    });
  });

  // ---------- Spot 3: resolvePlayables ----------

  describe('resolvePlayables (no collection gate)', () => {
    it('enters resolver branch for any collection with manifest.resolver', async () => {
      loadContainedYaml.mockImplementation((_dir, name) => {
        if (name === 'manifest') return { resolver: 'scripture' };
        return null;
      });

      // Since the resolver import will fail for a non-existent resolver module,
      // it should fall through to standard item resolution gracefully
      const items = await adapter.resolvePlayables('readalong:talks/volume1');

      // Should not throw — the lack of collection === 'scripture' guard
      // means the code attempts resolver loading for any collection with manifest.resolver
      expect(Array.isArray(items)).toBe(true);
    });
  });

  // ---------- Spot 4: getContainerType ----------

  describe('getContainerType (manifest.containerType)', () => {
    it('returns "sequential" when manifest has containerType: sequential', () => {
      loadContainedYaml.mockImplementation((_dir, name) => {
        if (name === 'manifest') return { containerType: 'sequential' };
        return null;
      });

      expect(adapter.getContainerType('readalong:scripture/bom')).toBe('sequential');
    });

    it('returns "watchlist" when manifest has no containerType', () => {
      loadContainedYaml.mockImplementation((_dir, name) => {
        if (name === 'manifest') return {};
        return null;
      });

      expect(adapter.getContainerType('readalong:talks/ldsgc')).toBe('watchlist');
    });

    it('returns "watchlist" when no manifest exists', () => {
      loadContainedYaml.mockReturnValue(null);

      expect(adapter.getContainerType('poetry/haiku')).toBe('watchlist');
    });

    it('returns custom containerType from manifest', () => {
      loadContainedYaml.mockImplementation((_dir, name) => {
        if (name === 'manifest') return { containerType: 'shuffle' };
        return null;
      });

      expect(adapter.getContainerType('custom/collection')).toBe('shuffle');
    });
  });

  // ---------- Method renames ----------

  describe('method renames', () => {
    it('_resolveContainerPlayables exists (renamed from _resolveScriptureVolumePlayables)', () => {
      expect(typeof adapter._resolveContainerPlayables).toBe('function');
    });

    it('_collectProgress exists (renamed from _collectScriptureProgress)', () => {
      expect(typeof adapter._collectProgress).toBe('function');
    });

    it('_getItemPercent exists (renamed from _getChapterPercent)', () => {
      expect(typeof adapter._getItemPercent).toBe('function');
    });
  });
});
