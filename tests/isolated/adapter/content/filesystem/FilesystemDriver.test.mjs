// tests/isolated/adapter/content/filesystem/FilesystemDriver.test.mjs
import { FilesystemDriver } from '#adapters/content/filesystem/FilesystemDriver.mjs';

describe('FilesystemDriver', () => {
  describe('source identification', () => {
    test('uses instance name as source', () => {
      const driver = new FilesystemDriver({
        instanceName: 'hymns',
        content_format: 'singalong',
        data_path: '/data/content/singalong/hymn',
        media_path: '/media/audio/singalong/hymn',
      });
      expect(driver.source).toBe('hymns');
    });
  });

  describe('content_format detection', () => {
    test('reports singalong format', () => {
      const driver = new FilesystemDriver({
        instanceName: 'hymns',
        content_format: 'singalong',
        data_path: '/data',
        media_path: '/media',
      });
      expect(driver.contentFormat).toBe('singalong');
    });

    test('reports readalong format', () => {
      const driver = new FilesystemDriver({
        instanceName: 'scripture',
        content_format: 'readalong',
        data_path: '/data',
        media_path: '/media',
      });
      expect(driver.contentFormat).toBe('readalong');
    });

    test('reports null format for generic filesystem', () => {
      const driver = new FilesystemDriver({
        instanceName: 'media',
        path: '/media',
      });
      expect(driver.contentFormat).toBeNull();
    });
  });

  describe('path construction', () => {
    test('constructs paths from data_path + localId', () => {
      const driver = new FilesystemDriver({
        instanceName: 'hymns',
        content_format: 'singalong',
        data_path: '/data/content/singalong/hymn',
        media_path: '/media/audio/singalong/hymn',
      });
      const paths = driver.buildPaths('0166-abide-with-me');
      expect(paths.dataPath).toBe('/data/content/singalong/hymn/0166-abide-with-me');
      expect(paths.mediaDir).toBe('/media/audio/singalong/hymn');
    });

    test('uses generic path when no data_path', () => {
      const driver = new FilesystemDriver({
        instanceName: 'media',
        path: '/media/files',
      });
      const paths = driver.buildPaths('sfx/intro');
      expect(paths.dataPath).toBe('/media/files/sfx/intro');
      expect(paths.mediaDir).toBe('/media/files');
    });

    test('uses media_path_map for collection-specific overrides', () => {
      const driver = new FilesystemDriver({
        instanceName: 'readalong',
        content_format: 'readalong',
        data_path: '/data/content/readalong',
        media_path: '/media/audio/readalong',
        media_path_map: {
          scripture: '/media/audio/scripture',
          talks: '/media/audio/talks',
        },
      });
      const scriptPaths = driver.buildPaths('scripture/bom/sebom/31103');
      expect(scriptPaths.mediaDir).toBe('/media/audio/scripture');

      const talkPaths = driver.buildPaths('talks/ldsgc');
      expect(talkPaths.mediaDir).toBe('/media/audio/talks');

      const poetryPaths = driver.buildPaths('poetry/remedy/01');
      expect(poetryPaths.mediaDir).toBe('/media/audio/readalong');
    });
  });

  describe('accessors', () => {
    test('exposes dataPath and mediaPath', () => {
      const driver = new FilesystemDriver({
        instanceName: 'test',
        data_path: '/data',
        media_path: '/media',
      });
      expect(driver.dataPath).toBe('/data');
      expect(driver.mediaPath).toBe('/media');
    });
  });
});
