// ContentAlternatesService.test.mjs
//
// Two sources can be rooted at overlapping directories, so the SAME file is
// addressable under more than one content id — and those ids do not carry the
// same capabilities. `files:art/fhe/esther.jpg` is playable-only; the identical
// bytes as `canvas:fhe/esther.jpg` are displayable. A list row asking to
// Display the first one renders nothing.
//
// This service answers "what else addresses this exact file, and what can those
// ids do?", so the admin can offer the swap instead of leaving you to guess.
import { describe, test, expect, beforeEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { FileAdapter } from '#adapters/content/media/files/FileAdapter.mjs';
import { FilesystemCanvasAdapter } from '#adapters/content/canvas/filesystem/FilesystemCanvasAdapter.mjs';
import { ContentSourceRegistry } from '#adapters/content/ContentSourceRegistry.mjs';
import { ContentAlternatesService } from '#apps/content/ContentAlternatesService.mjs';
import { RegistryContentCatalogGateway } from '#adapters/content/RegistryContentCatalogGateway.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mediaPath = path.resolve(__dirname, '../../../_fixtures/media');
// Canvas is rooted INSIDE the media tree — the same overlap production has
// (canvas basePath defaults to `<media>/img/art`). Here: <media>/docs.
const canvasPath = path.join(mediaPath, 'docs');

describe('ContentAlternatesService', () => {
  let service;

  beforeEach(() => {
    const registry = new ContentSourceRegistry();
    registry.register(new FileAdapter({ mediaBasePath: mediaPath }));
    registry.register(new FilesystemCanvasAdapter({ basePath: canvasPath }));
    service = new ContentAlternatesService({
      contentCatalog: new RegistryContentCatalogGateway({ registry }),
    });
  });

  test('finds the canvas id addressing the same file as a files id', async () => {
    const alternates = await service.findAlternates('files:docs/sheet-music/song.jpg');

    expect(alternates).toEqual([
      expect.objectContaining({
        contentId: 'canvas:sheet-music/song.jpg',
        source: 'canvas',
        capabilities: expect.arrayContaining(['displayable']),
      }),
    ]);
  });

  test('finds the files id addressing the same file as a canvas id', async () => {
    const alternates = await service.findAlternates('canvas:sheet-music/song.jpg');

    expect(alternates).toEqual([
      expect.objectContaining({
        contentId: 'files:docs/sheet-music/song.jpg',
        source: 'files',
      }),
    ]);
  });

  test('never lists the id it was asked about', async () => {
    const alternates = await service.findAlternates('files:docs/sheet-music/song.jpg');
    expect(alternates.map(a => a.contentId)).not.toContain('files:docs/sheet-music/song.jpg');
  });

  test('returns nothing for a file only one source can reach', async () => {
    // audio/test.mp3 lives outside the canvas root.
    const alternates = await service.findAlternates('files:audio/test.mp3');
    expect(alternates).toEqual([]);
  });

  test('returns nothing for a source with no filesystem path', async () => {
    const alternates = await service.findAlternates('plex:12345');
    expect(alternates).toEqual([]);
  });

  test('returns nothing for a file that does not exist', async () => {
    const alternates = await service.findAlternates('files:docs/nope.jpg');
    expect(alternates).toEqual([]);
  });
});

describe('filesystem adapters expose path <-> id mapping', () => {
  test('FileAdapter maps an id to a path and back', () => {
    const adapter = new FileAdapter({ mediaBasePath: mediaPath });
    const abs = adapter.resolveFilePath('docs/sheet-music/song.jpg');

    expect(abs).toBe(path.join(mediaPath, 'docs/sheet-music/song.jpg'));
    expect(adapter.localIdForFilePath(abs)).toBe('docs/sheet-music/song.jpg');
  });

  test('FileAdapter drops the media prefix it probes, so the id round-trips', () => {
    // resolvePath probes '', 'audio', 'video', 'img'. A file found under the
    // `img` prefix must come back as `art/x.jpg`, not `img/art/x.jpg` — the
    // latter is what the list rows actually contain.
    const adapter = new FileAdapter({ mediaBasePath: mediaPath });
    const abs = path.join(mediaPath, 'video/test.mp4');

    expect(adapter.localIdForFilePath(abs)).toBe('test.mp4');
    expect(adapter.resolveFilePath('test.mp4')).toBe(abs);
  });

  test('FileAdapter refuses a path outside its root', () => {
    const adapter = new FileAdapter({ mediaBasePath: mediaPath });
    expect(adapter.localIdForFilePath('/etc/passwd')).toBeNull();
  });

  test('FilesystemCanvasAdapter maps an id to a path and back', () => {
    const adapter = new FilesystemCanvasAdapter({ basePath: canvasPath });
    const abs = adapter.resolveFilePath('sheet-music/song.jpg');

    expect(abs).toBe(path.join(canvasPath, 'sheet-music/song.jpg'));
    expect(adapter.localIdForFilePath(abs)).toBe('sheet-music/song.jpg');
  });

  test('FilesystemCanvasAdapter refuses a path outside its root', () => {
    const adapter = new FilesystemCanvasAdapter({ basePath: canvasPath });
    expect(adapter.localIdForFilePath(path.join(mediaPath, 'audio/test.mp3'))).toBeNull();
  });
});
