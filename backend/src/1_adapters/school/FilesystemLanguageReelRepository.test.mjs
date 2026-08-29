// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LanguageReelService } from '#apps/school/LanguageReelService.mjs';
import { YamlDocumentFileStore } from './YamlDocumentFileStore.mjs';
import { FilesystemLanguageReelRepository } from './FilesystemLanguageReelRepository.mjs';

describe('FilesystemLanguageReelRepository', () => {
  let root;
  afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });

  it('keeps reel, learner-session, and media layout out of the service', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'language-reel-repository-'));
    const dataDir = path.join(root, 'data');
    const mediaDir = path.join(root, 'media');
    const userDir = path.join(root, 'users', 'learner');
    const store = new YamlDocumentFileStore();
    const reel = {
      reviewState: 'approved',
      title: 'A short conversation',
      media: { assetId: 'school:language/korean-language-reels/dialogue/123' },
      transcript: [{ id: 'cue-1', startMs: 0, endMs: 1000, text: '안녕하세요' }],
      vocabulary: [],
    };
    store.write(path.join(dataDir, 'content', 'school', 'language', 'korean-language-reels', 'reels', 'dialogue', '123.reel.yml'), reel);
    const mediaFile = path.join(mediaDir, 'school', 'language', 'korean-language-reels', 'dialogue', '123.mp4');
    fs.mkdirSync(path.dirname(mediaFile), { recursive: true });
    fs.writeFileSync(mediaFile, 'video');

    const repository = new FilesystemLanguageReelRepository({
      configService: {
        getDataDir: () => dataDir,
        getMediaDir: () => mediaDir,
        getUserProfile: (id) => id === 'learner' ? { id } : null,
        getUserDir: () => userDir,
      },
      store,
    });
    const service = new LanguageReelService({ repository, idFactory: randomUUID, clock: () => new Date('2026-08-28T12:00:00Z') });

    expect(service.getReel('123').revision).toMatch(/^[a-f0-9]{16}$/);
    expect(service.open({ userId: 'learner', reelId: '123' })).toMatchObject({ learnerId: 'learner', reelId: '123' });
    expect(service.status({ userId: 'learner', reelId: '123' }).progressLabel).toBe('Reel in progress');
    const media = service.mediaResource('123');
    expect(media).toMatchObject({ size: 5, mimeType: 'video/mp4' });
    expect(media).not.toHaveProperty('path');
    expect(media).not.toHaveProperty('filePath');
  });
});
