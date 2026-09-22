import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { SchoolFlashcardAssetRepository } from './SchoolFlashcardAssetRepository.mjs';

describe('SchoolFlashcardAssetRepository', () => {
  it('resolves only existing supported files below the configured root', () => {
    const root = path.resolve('tests/_fixtures/media');
    const repo = new SchoolFlashcardAssetRepository({ rootDir: root });
    expect(repo.get('../package.json')).toBeNull();
    expect(repo.get('missing.mp3')).toBeNull();
    const asset = repo.get('audio/test.mp3');
    expect(asset).toMatchObject({ contentType: 'audio/mpeg' });
    expect(asset).not.toHaveProperty('file');
    expect(asset.resource).not.toHaveProperty('path');
    expect(asset.resource).not.toHaveProperty('filePath');
  });

  it('resolves media: ids against the media root, refuses traversal, and treats 0-byte files as missing', async () => {
    const media = await mkdtemp(path.join(tmpdir(), 'flashcard-media-'));
    try {
      await mkdir(path.join(media, 'language/korean-vocab/words/gawi'), { recursive: true });
      await writeFile(path.join(media, 'language/korean-vocab/words/gawi/ko.mp3'), Buffer.from('ID3fake'));
      await writeFile(path.join(media, 'language/korean-vocab/words/gawi/image.jpg'), Buffer.alloc(0));
      const repo = new SchoolFlashcardAssetRepository({ rootDir: path.resolve('tests/_fixtures/media'), mediaRootDir: media });
      expect(repo.get('media:language/korean-vocab/words/gawi/ko.mp3')).toMatchObject({ contentType: 'audio/mpeg' });
      expect(repo.exists('media:language/korean-vocab/words/gawi/ko.mp3')).toBe(true);
      expect(repo.get('media:language/korean-vocab/words/gawi/image.jpg')).toBeNull();
      expect(repo.exists('media:language/korean-vocab/words/gawi/image.jpg')).toBe(false);
      expect(repo.get('media:../../etc/passwd')).toBeNull();
      expect(repo.get('media:')).toBeNull();
      expect(new SchoolFlashcardAssetRepository({ rootDir: media }).get('media:language/korean-vocab/words/gawi/ko.mp3')).toBeNull();
    } finally { await rm(media, { recursive: true, force: true }); }
  });
});
