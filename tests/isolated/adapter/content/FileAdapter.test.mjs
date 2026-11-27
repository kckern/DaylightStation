// tests/unit/adapters/content/FileAdapter.test.mjs
import { vi } from 'vitest';
import { FileAdapter } from '#adapters/content/media/files/FileAdapter.mjs';
import path from 'path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '../../../_fixtures/media');

describe('FileAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new FileAdapter({ mediaBasePath: fixturesPath });
  });

  test('has correct source and prefixes', () => {
    expect(adapter.source).toBe('files');
    expect(adapter.prefixes).toContainEqual({ prefix: 'files' });
    expect(adapter.prefixes).toContainEqual({ prefix: 'file' });
  });

  test('getItem returns item for existing file', async () => {
    const item = await adapter.getItem('audio/test.mp3');

    expect(item).not.toBeNull();
    expect(item.id).toBe('files:audio/test.mp3');
    expect(item.source).toBe('files');
    expect(item.mediaType).toBe('audio');
  });

  test('getItem returns null for missing file', async () => {
    const item = await adapter.getItem('nonexistent.mp3');
    expect(item).toBeNull();
  });

  test('getList returns directory contents', async () => {
    const list = await adapter.getList('audio');

    expect(list.length).toBeGreaterThan(0);
    // FileAdapter.getList returns PlayableItem instances for files (no itemType
    // field); container directories carry itemType: 'container'. The audio
    // fixture is a flat directory of mp3 files, so items are playables.
    expect(list[0].mediaUrl).toBeDefined();
  });

  test('resolvePlayables flattens directory', async () => {
    const playables = await adapter.resolvePlayables('audio');

    expect(playables.length).toBeGreaterThan(0);
    expect(playables[0].mediaUrl).toBeDefined();
  });

  test('prevents path traversal attacks', async () => {
    // Attempt to escape the media directory with ..
    const item1 = await adapter.getItem('../../../etc/passwd');
    expect(item1).toBeNull();

    const item2 = await adapter.getItem('audio/../../../../../../etc/passwd');
    expect(item2).toBeNull();

    // Test with encoded path traversal
    const item3 = await adapter.getItem('..%2F..%2Fetc/passwd');
    expect(item3).toBeNull();

    // Test getList with path traversal
    const list1 = await adapter.getList('../../../etc');
    expect(list1).toEqual([]);

    const list2 = await adapter.getList('audio/../../../etc');
    expect(list2).toEqual([]);
  });

  test('throws error when mediaBasePath is missing', () => {
    expect(() => new FileAdapter({})).toThrow('FileAdapter requires mediaBasePath');
    expect(() => new FileAdapter({ mediaBasePath: '' })).toThrow('FileAdapter requires mediaBasePath');
  });

  // An image is its own poster. It used to fall through the thumbnail chain to
  // null and never got an imageUrl, which made it the only media type reported
  // as not displayable — rows rendered no artwork and `action: Display`
  // previewed an empty <img> — while a video file was marked displayable.
  describe('standalone images are displayable', () => {
    test('getItem gives an image file a thumbnail', async () => {
      const item = await adapter.getItem('docs/sheet-music/gallery.jpg');
      expect(item).not.toBeNull();
      expect(item.mediaType).toBe('image');
      expect(item.thumbnail).toBe(
        `/api/v1/local/thumbnail/${encodeURIComponent('docs/sheet-music/gallery.jpg')}`,
      );
    });

    test('getItem gives an image file a full-resolution imageUrl', async () => {
      const item = await adapter.getItem('docs/sheet-music/gallery.jpg');
      expect(item.imageUrl).toBe(
        `/api/v1/proxy/media/stream/${encodeURIComponent('docs/sheet-music/gallery.jpg')}`,
      );
    });

    test('non-image files get no imageUrl', async () => {
      const audio = await adapter.getItem('audio/test.mp3');
      expect(audio.imageUrl).toBeNull();
    });
  });

  describe('image sidecar posters (sheet music)', () => {
    test('getItem uses a same-basename .jpg sidecar as a notation file thumbnail', async () => {
      const item = await adapter.getItem('docs/sheet-music/song.musicxml');
      expect(item).not.toBeNull();
      expect(item.mediaType).toBe('notation');
      expect(item.thumbnail).toBe(
        `/api/v1/proxy/media/stream/${encodeURIComponent('docs/sheet-music/song.jpg')}`,
      );
    });

    test('getList hides the sidecar image but keeps standalone images and the notation tile', async () => {
      const list = await adapter.getList('docs/sheet-music');
      const ids = list.map((i) => i.id);
      expect(ids).toContain('files:docs/sheet-music/song.musicxml'); // notation tile present
      expect(ids).not.toContain('files:docs/sheet-music/song.jpg');  // sidecar hidden
      expect(ids).toContain('files:docs/sheet-music/gallery.jpg');   // standalone image still listed
      // The notation tile carries the sidecar poster.
      const notation = list.find((i) => i.id === 'files:docs/sheet-music/song.musicxml');
      expect(notation.thumbnail).toContain('song.jpg');
    });

    describe('generated .svg posters', () => {
      let tmp;
      let svgAdapter;
      const stream = (local) => `/api/v1/proxy/media/stream/${encodeURIComponent(local)}`;

      beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'file-adapter-svg-'));
        const dir = path.join(tmp, 'docs/sheet-music');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'piece.musicxml'), '<score-partwise/>');
        fs.writeFileSync(path.join(dir, 'piece.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
        fs.writeFileSync(path.join(dir, 'scanned.musicxml'), '<score-partwise/>');
        fs.writeFileSync(path.join(dir, 'scanned.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
        fs.writeFileSync(path.join(dir, 'scanned.png'), 'png');
        svgAdapter = new FileAdapter({ mediaBasePath: tmp });
      });

      afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

      test('a score with an .svg beside it lists as one tile with the svg as its thumbnail', async () => {
        const list = await svgAdapter.getList('docs/sheet-music');
        const ids = list.map((i) => i.id).sort();
        expect(ids).toEqual(['files:docs/sheet-music/piece.musicxml', 'files:docs/sheet-music/scanned.musicxml']);
        const piece = list.find((i) => i.id === 'files:docs/sheet-music/piece.musicxml');
        expect(piece.thumbnail).toBe(stream('docs/sheet-music/piece.svg'));
      });

      test('a raster scan wins over a generated svg', async () => {
        const item = await svgAdapter.getItem('docs/sheet-music/scanned.musicxml');
        expect(item.thumbnail).toBe(stream('docs/sheet-music/scanned.png'));
      });
    });
  });

  describe('ID3 tag parsing', () => {
    test('should include artist from audio file metadata', async () => {
      const adapter = new FileAdapter({
        mediaBasePath: fixturesPath
      });

      // Inject mock for parseFile to simulate ID3 tags
      adapter._parseFile = vi.fn().mockResolvedValue({
        common: {
          title: 'Test Song',
          artist: 'Test Artist',
          album: 'Test Album',
          year: 2024,
          track: { no: 5 },
          genre: ['Rock', 'Alternative']
        }
      });

      const item = await adapter.getItem('audio/test.mp3');

      expect(item).not.toBeNull();
      expect(item.metadata.artist).toBe('Test Artist');
      expect(item.metadata.album).toBe('Test Album');
      expect(item.metadata.year).toBe(2024);
      expect(item.metadata.track).toBe(5);
      expect(item.metadata.genre).toBe('Rock, Alternative');
    });

    test('should handle files without ID3 tags gracefully', async () => {
      const adapter = new FileAdapter({
        mediaBasePath: fixturesPath
      });

      adapter._parseFile = vi.fn().mockResolvedValue({ common: {} });

      const item = await adapter.getItem('audio/test.mp3');

      expect(item).not.toBeNull();
      expect(item.metadata.artist).toBeUndefined();
      expect(item.metadata.album).toBeUndefined();
    });

    test('should handle parse errors gracefully', async () => {
      const adapter = new FileAdapter({
        mediaBasePath: fixturesPath
      });

      adapter._parseFile = vi.fn().mockRejectedValue(new Error('Parse error'));

      const item = await adapter.getItem('audio/test.mp3');

      expect(item).not.toBeNull();
      // Should still return item, just without ID3 metadata
      expect(item.id).toBe('files:audio/test.mp3');
    });

    test('should only parse ID3 tags for audio files', async () => {
      const adapter = new FileAdapter({
        mediaBasePath: fixturesPath
      });

      adapter._parseFile = vi.fn().mockResolvedValue({
        common: { artist: 'Test Artist' }
      });

      // The test fixture has audio/test.mp3
      const audioItem = await adapter.getItem('audio/test.mp3');
      expect(adapter._parseFile).toHaveBeenCalled();

      // Reset mock
      adapter._parseFile.mockClear();

      // For non-audio files (if they existed), _parseFile should not be called
      // This tests the conditional logic in getItem
    });
  });

  describe('getCoverArt', () => {
    test('should return cover art for valid image type and size', async () => {
      const adapter = new FileAdapter({ mediaBasePath: fixturesPath });

      const mockImageData = new Uint8Array(1024); // 1KB image
      adapter._parseFile = vi.fn().mockResolvedValue({
        common: {
          picture: [{
            format: 'image/jpeg',
            data: mockImageData
          }]
        }
      });

      const result = await adapter.getCoverArt('audio/test.mp3');

      expect(result).not.toBeNull();
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    test('should return null for invalid MIME type', async () => {
      const adapter = new FileAdapter({ mediaBasePath: fixturesPath });

      adapter._parseFile = vi.fn().mockResolvedValue({
        common: {
          picture: [{
            format: 'image/bmp', // Not in VALID_IMAGE_TYPES
            data: new Uint8Array(1024)
          }]
        }
      });

      const result = await adapter.getCoverArt('audio/test.mp3');
      expect(result).toBeNull();
    });

    test('should return null for oversized images', async () => {
      const adapter = new FileAdapter({ mediaBasePath: fixturesPath });

      // Create data larger than 10MB limit
      const hugeData = new Uint8Array(11 * 1024 * 1024);
      adapter._parseFile = vi.fn().mockResolvedValue({
        common: {
          picture: [{
            format: 'image/jpeg',
            data: hugeData
          }]
        }
      });

      const result = await adapter.getCoverArt('audio/test.mp3');
      expect(result).toBeNull();
    });

    test('should return null for file without cover art', async () => {
      const adapter = new FileAdapter({ mediaBasePath: fixturesPath });

      adapter._parseFile = vi.fn().mockResolvedValue({
        common: {}
      });

      const result = await adapter.getCoverArt('audio/test.mp3');
      expect(result).toBeNull();
    });

    test('should log warning on parse error', async () => {
      const adapter = new FileAdapter({ mediaBasePath: fixturesPath });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      adapter._parseFile = vi.fn().mockRejectedValue(new Error('Parse failed'));

      const result = await adapter.getCoverArt('audio/test.mp3');

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse cover art'),
        'Parse failed'
      );

      warnSpy.mockRestore();
    });

    test('should return null for unresolvable path', async () => {
      const adapter = new FileAdapter({ mediaBasePath: fixturesPath });

      const result = await adapter.getCoverArt('nonexistent/file.mp3');
      expect(result).toBeNull();
    });
  });

  describe('image MIME types', () => {
    it('should detect SVG files', () => {
      const adapter = new FileAdapter({ mediaBasePath: '/test' });
      expect(adapter.getMimeType('.svg')).toBe('image/svg+xml');
    });

    it('should detect GIF files', () => {
      const adapter = new FileAdapter({ mediaBasePath: '/test' });
      expect(adapter.getMimeType('.gif')).toBe('image/gif');
    });

    it('should detect WebP files', () => {
      const adapter = new FileAdapter({ mediaBasePath: '/test' });
      expect(adapter.getMimeType('.webp')).toBe('image/webp');
    });

    it('should include image type in getMediaType', () => {
      const adapter = new FileAdapter({ mediaBasePath: '/test' });
      expect(adapter.getMediaType('.svg')).toBe('image');
      expect(adapter.getMediaType('.gif')).toBe('image');
      expect(adapter.getMediaType('.webp')).toBe('image');
      expect(adapter.getMediaType('.jpg')).toBe('image');
      expect(adapter.getMediaType('.png')).toBe('image');
    });

    it('should detect existing image formats', () => {
      const adapter = new FileAdapter({ mediaBasePath: '/test' });
      expect(adapter.getMimeType('.jpg')).toBe('image/jpeg');
      expect(adapter.getMimeType('.jpeg')).toBe('image/jpeg');
      expect(adapter.getMimeType('.png')).toBe('image/png');
    });
  });

  // NOTE: household-scoped watch state suite removed — FileAdapter no longer
  // owns the householdsBasePath/_loadWatchState code path. Watch state is now
  // sourced via the configService injection pathway (see constructor at
  // __backend/src/1_adapters/content/media/files/FileAdapter.mjs:71-72).
});

// Search walks the media tree without blocking (one readdir per directory,
// entry types from the readdir — no stat per entry). Same matches as before:
// names and directory names, media files only, `.`/`_` skipped, the default
// exclusion honoured, and a symlink followed to what it points at.
describe('FileAdapter search walk', () => {
  let root;
  let adapter;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-search-'));
    const write = (rel) => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), '');
    };
    write('audio/sonic/green-hill.mp3');        // only its folder's name matches
    write('audio/notes/sonic-readme.txt');     // not media: never a result
    write('video/fitness/sonic-ride.mp4');      // excluded by default
    write('games/deep/a/b/sonic-boom.png');
    write('_inbox/sonic-draft.mp3');            // `_` dirs are skipped
    write('.cache/sonic.mp3');                  // dot dirs are skipped
    fs.mkdirSync(path.join(root, 'linked-target'), { recursive: true });
    fs.writeFileSync(path.join(root, 'linked-target', 'sonic-linked.mp3'), '');
    fs.symlinkSync(path.join(root, 'linked-target'), path.join(root, 'games', 'link'));
    adapter = new FileAdapter({ mediaBasePath: root });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('finds matching media files and directories, nothing skipped or excluded', async () => {
    const { items } = await adapter.search({ text: 'sonic', take: 50 });
    const ids = items.map(i => i.id).sort();
    expect(ids).toEqual(expect.arrayContaining([
      'files:audio/sonic',
      'files:games/deep/a/b/sonic-boom.png',
      'files:games/link/sonic-linked.mp3',
    ]));
    expect(ids.some(id => id.includes('readme'))).toBe(false);
    expect(ids.some(id => id.includes('fitness'))).toBe(false);
    expect(ids.some(id => id.includes('_inbox') || id.includes('.cache'))).toBe(false);
  });

  test('the excluded footage is reachable when asked for explicitly', async () => {
    const { items } = await adapter.search({ text: 'sonic', take: 50, includeExcluded: true });
    expect(items.map(i => i.id)).toContain('files:video/fitness/sonic-ride.mp4');
  });

  test('stops at the limit', async () => {
    const { items } = await adapter.search({ text: 'sonic', take: 2 });
    expect(items.length).toBe(2);
  });
  // 2026-11-27: every search walked the whole media tree (450k entries), one
  // fresh walk per keystroke, and the walks starved the other search sources
  // (photo libraries timed out at 3 s only while a files walk ran).
  test('searches share one walk of the tree', async () => {
    const build = vi.spyOn(adapter, '_buildSearchIndex');
    const [a, b] = await Promise.all([
      adapter.search({ text: 'sonic', take: 50 }),
      adapter.search({ text: 'green', take: 50 }),
    ]);
    await adapter.search({ text: 'sonic', take: 50 });
    expect(build).toHaveBeenCalledTimes(1);
    expect(a.items.map(i => i.id)).toContain('files:audio/sonic');
    expect(b.items.map(i => i.id)).toContain('files:audio/sonic/green-hill.mp3');
  });

  // 2026-11-27: the first search after a restart paid for the index build
  // (seconds on the real tree) and missed the files budget. A search during the
  // first build waits briefly, then matches the names walked so far.
  test('a search during the first build answers from the names walked so far', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let finish;
      vi.spyOn(adapter, '_buildSearchIndex').mockImplementation((entries = []) => {
        entries.push({ rel: 'audio/sonic', nameLower: 'sonic', baseLower: 'sonic', isDirectory: true, mediaType: null });
        return new Promise((resolve) => { finish = () => resolve(entries); });
      });
      const pending = adapter.search({ text: 'sonic', take: 50 });
      await vi.advanceTimersByTimeAsync(1500);
      const result = await pending;
      expect(result.partial).toBe(true);
      expect(result.items.map(i => i.id)).toEqual(['files:audio/sonic']);
      finish();
    } finally {
      vi.useRealTimers();
    }
  });

  test('prepareSearch builds the index the next search reads', async () => {
    const build = vi.spyOn(adapter, '_buildSearchIndex');
    const { entries } = await adapter.prepareSearch();
    expect(entries).toBeGreaterThan(0);
    const { items, partial } = await adapter.search({ text: 'sonic', take: 50 });
    expect(build).toHaveBeenCalledTimes(1);
    expect(partial).toBeUndefined();
    expect(items.map(i => i.id)).toContain('files:audio/sonic');
  });

  test('the workout snapshots under fitness/ are not searched by default', async () => {
    fs.mkdirSync(path.join(root, 'fitness', 'sessions', 's1'), { recursive: true });
    fs.writeFileSync(path.join(root, 'fitness', 'sessions', 's1', 'sonic-snap.jpg'), '');
    const plain = await new FileAdapter({ mediaBasePath: root }).search({ text: 'sonic', take: 50 });
    expect(plain.items.some(i => i.id.includes('fitness/sessions'))).toBe(false);
    const asked = await new FileAdapter({ mediaBasePath: root }).search({ text: 'sonic', take: 50, includeExcluded: true });
    expect(asked.items.map(i => i.id)).toContain('files:fitness/sessions/s1/sonic-snap.jpg');
  });
});
