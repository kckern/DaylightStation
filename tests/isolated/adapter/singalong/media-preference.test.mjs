// tests/isolated/adapter/singalong/media-preference.test.mjs
//
// TDD: Verifies that SingalongAdapter searches media subdirectories in the
// order specified by manifest.mediaPreference.subdirs before falling back
// to the collection root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

// ── Mocks ──────────────────────────────────────────────────────────────────
// We mock the FileIO module so no real filesystem access is needed.
// We also mock music-metadata so parseFile doesn't hit real files.

vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYamlByPrefix: vi.fn(),
  loadContainedYaml: vi.fn(),
  findMediaFileByPrefix: vi.fn(),
  fileExists: vi.fn(() => false),
  dirExists: vi.fn(() => true),
  listDirs: vi.fn(() => []),
  listYamlFiles: vi.fn(() => []),
}));

vi.mock('music-metadata', () => ({
  parseFile: vi.fn(() => Promise.resolve({ format: { duration: 180 } })),
}));

// Import mocked modules so we can control return values per test
const FileIO = await import('#system/utils/FileIO.mjs');
const { SingalongAdapter } = await import('#adapters/content/singalong/SingalongAdapter.mjs');

// ── Helpers ────────────────────────────────────────────────────────────────

const DATA_PATH = '/fake/data/singalong';
const MEDIA_PATH = '/fake/media/audio/singalong';

function createAdapter() {
  return new SingalongAdapter({ dataPath: DATA_PATH, mediaPath: MEDIA_PATH });
}

/** Stub the manifest for a collection */
function stubManifest(collection, manifest) {
  FileIO.loadContainedYaml.mockImplementation((baseDir, relativePath) => {
    if (baseDir === path.join(DATA_PATH, collection) && relativePath === 'manifest') {
      return manifest;
    }
    return null;
  });
}

/** Stub item metadata for loadYamlByPrefix */
function stubItemMetadata(collection, itemId, metadata) {
  FileIO.loadYamlByPrefix.mockImplementation((dirPath, prefix) => {
    if (dirPath === path.join(DATA_PATH, collection) && String(prefix) === String(itemId)) {
      return metadata;
    }
    return null;
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SingalongAdapter media preference', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Subdirectory preference ────────────────────────────────────────────

  describe('when manifest has mediaPreference.subdirs', () => {

    it('searches preferred subdirectory first and returns its media file', async () => {
      const adapter = createAdapter();
      const preferredFile = path.join(MEDIA_PATH, 'hymn', '_ldsgc', '0002-the-spirit-of-god.mp3');

      stubManifest('hymn', {
        mediaPreference: { subdirs: ['_ldsgc', ''] },
      });
      stubItemMetadata('hymn', '2', { title: 'The Spirit of God', number: 2 });

      // _ldsgc subdir has the file
      FileIO.findMediaFileByPrefix.mockImplementation((dirPath, prefix) => {
        if (dirPath === path.join(MEDIA_PATH, 'hymn', '_ldsgc') && String(prefix) === '2') {
          return preferredFile;
        }
        return null;
      });

      const item = await adapter.getItem('singalong:hymn/2');

      expect(item).not.toBeNull();
      // findMediaFileByPrefix should have been called with the preferred subdir first
      expect(FileIO.findMediaFileByPrefix).toHaveBeenCalledWith(
        path.join(MEDIA_PATH, 'hymn', '_ldsgc'),
        2
      );
      // Since the preferred subdir returned a file, the root should NOT have been searched
      expect(FileIO.findMediaFileByPrefix).toHaveBeenCalledTimes(1);
    });

    it('falls back to root when preferred subdirectory has no match', async () => {
      const adapter = createAdapter();
      const rootFile = path.join(MEDIA_PATH, 'hymn', '0002-the-spirit-of-god.mp3');

      stubManifest('hymn', {
        mediaPreference: { subdirs: ['_ldsgc', ''] },
      });
      stubItemMetadata('hymn', '2', { title: 'The Spirit of God', number: 2 });

      // _ldsgc has nothing; root has the file
      FileIO.findMediaFileByPrefix.mockImplementation((dirPath, prefix) => {
        if (dirPath === path.join(MEDIA_PATH, 'hymn') && String(prefix) === '2') {
          return rootFile;
        }
        return null;
      });

      const item = await adapter.getItem('singalong:hymn/2');

      expect(item).not.toBeNull();
      // Should have tried _ldsgc first, then root
      expect(FileIO.findMediaFileByPrefix).toHaveBeenCalledTimes(2);
      expect(FileIO.findMediaFileByPrefix).toHaveBeenNthCalledWith(
        1,
        path.join(MEDIA_PATH, 'hymn', '_ldsgc'),
        2
      );
      expect(FileIO.findMediaFileByPrefix).toHaveBeenNthCalledWith(
        2,
        path.join(MEDIA_PATH, 'hymn'),
        2
      );
    });

    it('returns null mediaUrl path when no subdirectory has a match', async () => {
      const adapter = createAdapter();

      stubManifest('hymn', {
        mediaPreference: { subdirs: ['_ldsgc', ''] },
      });
      stubItemMetadata('hymn', '999', { title: 'Unknown Hymn', number: 999 });

      FileIO.findMediaFileByPrefix.mockReturnValue(null);

      const item = await adapter.getItem('singalong:hymn/999');

      expect(item).not.toBeNull();
      // Both subdirs should have been searched
      expect(FileIO.findMediaFileByPrefix).toHaveBeenCalledTimes(2);
      // Duration should be 0 since no media file found
      expect(item.duration).toBe(0);
    });

    it('handles single-element subdirs array', async () => {
      const adapter = createAdapter();
      const preferredFile = path.join(MEDIA_PATH, 'primary', '_ldsgc', '0002-i-am-a-child-of-god.mp3');

      stubManifest('primary', {
        mediaPreference: { subdirs: ['_ldsgc'] },
      });
      stubItemMetadata('primary', '2', { title: 'I Am a Child of God', number: 2 });

      FileIO.findMediaFileByPrefix.mockImplementation((dirPath, prefix) => {
        if (dirPath === path.join(MEDIA_PATH, 'primary', '_ldsgc') && String(prefix) === '2') {
          return preferredFile;
        }
        return null;
      });

      const item = await adapter.getItem('singalong:primary/2');

      expect(item).not.toBeNull();
      expect(FileIO.findMediaFileByPrefix).toHaveBeenCalledTimes(1);
      expect(FileIO.findMediaFileByPrefix).toHaveBeenCalledWith(
        path.join(MEDIA_PATH, 'primary', '_ldsgc'),
        2
      );
    });
  });

  // ── No preference (backward compatibility) ─────────────────────────────

  describe('when manifest has NO mediaPreference', () => {

    it('searches only the collection root directory', async () => {
      const adapter = createAdapter();
      const rootFile = path.join(MEDIA_PATH, 'hymn', '0019-we-thank-thee.mp3');

      stubManifest('hymn', { style: { fontSize: '1.6rem' } });
      stubItemMetadata('hymn', '19', { title: 'We Thank Thee, O God', number: 19 });

      FileIO.findMediaFileByPrefix.mockImplementation((dirPath, prefix) => {
        if (dirPath === path.join(MEDIA_PATH, 'hymn') && String(prefix) === '19') {
          return rootFile;
        }
        return null;
      });

      const item = await adapter.getItem('singalong:hymn/19');

      expect(item).not.toBeNull();
      expect(FileIO.findMediaFileByPrefix).toHaveBeenCalledTimes(1);
      expect(FileIO.findMediaFileByPrefix).toHaveBeenCalledWith(
        path.join(MEDIA_PATH, 'hymn'),
        19
      );
    });

    it('searches only root when manifest is null', async () => {
      const adapter = createAdapter();

      // No manifest at all
      FileIO.loadContainedYaml.mockReturnValue(null);
      stubItemMetadata('hymn', '5', { title: 'High on the Mountain Top', number: 5 });

      FileIO.findMediaFileByPrefix.mockReturnValue(null);

      const item = await adapter.getItem('singalong:hymn/5');

      expect(item).not.toBeNull();
      expect(FileIO.findMediaFileByPrefix).toHaveBeenCalledTimes(1);
      expect(FileIO.findMediaFileByPrefix).toHaveBeenCalledWith(
        path.join(MEDIA_PATH, 'hymn'),
        5
      );
    });
  });

  // ── Empty string subdir means collection root ──────────────────────────

  describe('empty string in subdirs array', () => {

    it('treats empty string as the collection root directory', async () => {
      const adapter = createAdapter();
      const rootFile = path.join(MEDIA_PATH, 'hymn', '0003-now-let-us-rejoice.mp3');

      stubManifest('hymn', {
        mediaPreference: { subdirs: [''] },
      });
      stubItemMetadata('hymn', '3', { title: 'Now Let Us Rejoice', number: 3 });

      FileIO.findMediaFileByPrefix.mockImplementation((dirPath, prefix) => {
        if (dirPath === path.join(MEDIA_PATH, 'hymn') && String(prefix) === '3') {
          return rootFile;
        }
        return null;
      });

      const item = await adapter.getItem('singalong:hymn/3');

      expect(item).not.toBeNull();
      expect(FileIO.findMediaFileByPrefix).toHaveBeenCalledWith(
        path.join(MEDIA_PATH, 'hymn'),
        3
      );
    });
  });
});
