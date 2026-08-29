import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';
import { FilesystemLocalMediaRepository } from '#adapters/media/FilesystemLocalMediaRepository.mjs';
import { FilesystemContentMediaRepository } from '#adapters/media/FilesystemContentMediaRepository.mjs';
import { ILocalMediaRepository } from '#apps/media/ports/ILocalMediaRepository.mjs';
import { IContentMediaRepository } from '#apps/media/ports/IContentMediaRepository.mjs';

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe('FilesystemLocalMediaRepository', () => {
  let root;
  let mediaBasePath;
  let cacheBasePath;
  let thumbnailGenerator;
  let repository;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-local-media-'));
    mediaBasePath = path.join(root, 'media');
    cacheBasePath = path.join(root, 'cache');
    fs.mkdirSync(path.join(mediaBasePath, 'audio'), { recursive: true });
    fs.mkdirSync(path.join(mediaBasePath, 'video'), { recursive: true });
    fs.mkdirSync(path.join(mediaBasePath, 'images'), { recursive: true });
    fs.writeFileSync(path.join(mediaBasePath, 'audio', 'song.mp3'), '0123456789');
    fs.writeFileSync(path.join(mediaBasePath, 'video', 'movie.mp4'), 'video');
    fs.writeFileSync(path.join(mediaBasePath, 'images', 'poster.jpg'), 'image');
    fs.writeFileSync(path.join(mediaBasePath, 'notes.txt'), 'notes');
    thumbnailGenerator = { generate: vi.fn() };
    repository = new FilesystemLocalMediaRepository({
      mediaBasePath,
      cacheBasePath,
      thumbnailGenerator,
      logger: { warn: vi.fn() },
    });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('is the flagship implementation of the application-owned port', () => {
    expect(repository).toBeInstanceOf(ILocalMediaRepository);
  });

  test('returns an opaque range-readable resource rather than a path', async () => {
    const result = await repository.getMediaResource('audio/song.mp3');
    expect(result.kind).toBe('found');
    expect(Object.keys(result.resource).sort()).toEqual(['mimeType', 'open', 'size']);
    expect(result.resource).not.toHaveProperty('path');
    expect(result.resource).not.toHaveProperty('fullPath');
    expect(result.resource.size).toBe(10);
    expect(result.resource.mimeType).toBe('audio/mpeg');
    expect((await readStream(result.resource.open({ start: 2, end: 5 }))).toString()).toBe('2345');
  });

  test('distinguishes missing paths and directories', async () => {
    expect(await repository.getMediaResource('missing.mp3')).toEqual({ kind: 'not_found' });
    expect(await repository.getMediaResource('audio')).toEqual({ kind: 'not_file' });
  });

  test('uses an image itself as its thumbnail without invoking ffmpeg', async () => {
    const result = await repository.getThumbnailResource('images/poster.jpg');
    expect(result.kind).toBe('found');
    expect(result.resource.mimeType).toBe('image/jpeg');
    expect((await readStream(result.resource.open())).toString()).toBe('image');
    expect(thumbnailGenerator.generate).not.toHaveBeenCalled();
  });

  test('generates and resolves a cached video thumbnail behind the port', async () => {
    thumbnailGenerator.generate.mockImplementation(async (_sourcePath, outputPath) => {
      fs.writeFileSync(outputPath, 'jpeg');
    });

    const result = await repository.getThumbnailResource('video/movie.mp4');
    expect(result.kind).toBe('found');
    expect(result.resource.mimeType).toBe('image/jpeg');
    expect((await readStream(result.resource.open())).toString()).toBe('jpeg');
    expect(thumbnailGenerator.generate).toHaveBeenCalledOnce();
  });

  test('preserves unsupported and failed-generation outcomes', async () => {
    expect(await repository.getThumbnailResource('notes.txt')).toEqual({ kind: 'unsupported' });
    thumbnailGenerator.generate.mockRejectedValueOnce(new Error('ffmpeg failed'));
    expect(await repository.getThumbnailResource('video/movie.mp4')).toEqual({ kind: 'generation_failed' });
  });
});

describe('FilesystemContentMediaRepository', () => {
  let root;
  let singalongMediaPath;
  let singalongDataPath;
  let readalongAudioPath;
  let readalongVideoPath;
  let repository;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-content-media-'));
    singalongMediaPath = path.join(root, 'singalong-media');
    singalongDataPath = path.join(root, 'singalong-data');
    readalongAudioPath = path.join(root, 'readalong-audio');
    readalongVideoPath = path.join(root, 'readalong-video');

    fs.mkdirSync(path.join(singalongMediaPath, 'hymn', 'preferred'), { recursive: true });
    fs.mkdirSync(path.join(singalongDataPath, 'hymn'), { recursive: true });
    fs.mkdirSync(path.join(readalongAudioPath, 'scripture', 'nt', 'nirv'), { recursive: true });
    fs.mkdirSync(path.join(root, 'ambient'), { recursive: true });
    fs.mkdirSync(readalongVideoPath, { recursive: true });
    fs.writeFileSync(path.join(singalongMediaPath, 'hymn', 'preferred', '0002-song.mp3'), 'hymn');
    fs.writeFileSync(
      path.join(singalongDataPath, 'hymn', 'manifest.yml'),
      'mediaPreference:\n  subdirs:\n    - preferred\n',
    );
    fs.writeFileSync(path.join(readalongAudioPath, 'scripture', 'nt', 'nirv', '26046-chapter.mp3'), 'chapter');
    fs.writeFileSync(path.join(root, 'ambient', '0007-rain.mp3'), 'rain');

    repository = new FilesystemContentMediaRepository({
      singalongMediaPath,
      singalongDataPath,
      readalongAudioPath,
      readalongVideoPath,
    });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('is the flagship implementation of the application-owned port', () => {
    expect(repository).toBeInstanceOf(IContentMediaRepository);
  });

  test('honors singalong manifest subdirectory preference', async () => {
    const result = await repository.findSingalong('hymn', '2');
    expect(result.kind).toBe('found');
    expect(result.resource).not.toHaveProperty('path');
    expect((await readStream(result.resource.open())).toString()).toBe('hymn');
  });

  test('resolves nested readalong and ambient resources', async () => {
    const readalong = await repository.findReadalong('scripture', 'nt/nirv/26046');
    expect(readalong.kind).toBe('found');
    expect((await readStream(readalong.resource.open())).toString()).toBe('chapter');

    const ambient = await repository.findAmbient('7');
    expect(ambient.kind).toBe('found');
    expect((await readStream(ambient.resource.open())).toString()).toBe('rain');
  });

  test('preserves invalid, missing, and traversal outcomes', async () => {
    expect(await repository.findReadalong('scripture', '')).toEqual({ kind: 'invalid_path' });
    expect(await repository.findReadalong('scripture', 'missing')).toEqual({ kind: 'not_found' });
    expect(await repository.findSingalong('hymn', '404')).toEqual({ kind: 'not_found' });
    expect(await repository.findAmbient('404')).toEqual({ kind: 'not_found' });
  });
});
