import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FilesystemCanvasImageRepository } from '#adapters/persistence/files/FilesystemCanvasImageRepository.mjs';

describe('FilesystemCanvasImageRepository', () => {
  let root;
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  it('returns an opaque image resource without leaking a path', async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'canvas-images-'));
    mkdirSync(path.join(root, 'gallery'));
    writeFileSync(path.join(root, 'gallery', 'work.jpg'), Buffer.from('image'));
    const repository = new FilesystemCanvasImageRepository({ rootDir: root });
    const resource = await repository.getImageResource('gallery/work.jpg');
    expect(resource).not.toHaveProperty('path');
    expect(resource).not.toHaveProperty('buffer');
    expect(resource).toMatchObject({ size: 5, mimeType: 'image/jpeg' });
  });

  it('rejects traversal and returns null for absence', async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'canvas-images-'));
    const repository = new FilesystemCanvasImageRepository({ rootDir: root });
    await expect(repository.getImageResource('../secret.jpg')).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    await expect(repository.getImageResource('missing.jpg')).resolves.toBeNull();
  });
});
