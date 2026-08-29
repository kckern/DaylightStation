import { describe, expect, it } from 'vitest';
import path from 'node:path';
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
});
