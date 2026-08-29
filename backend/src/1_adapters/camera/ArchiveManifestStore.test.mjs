import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArchiveManifestStore, MANIFEST_VERSION } from './ArchiveManifestStore.mjs';

const roots = [];

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-manifest-'));
  roots.push(root);
  const logger = { warn: vi.fn() };
  return { root, logger, store: new ArchiveManifestStore({ root, logger }) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('ArchiveManifestStore', () => {
  it('writes and reads a resumable manifest at the camera/day path', async () => {
    const { store } = await fixture();
    const manifest = { version: MANIFEST_VERSION, status: 'complete', camera: 'front', day: '2026-08-28' };

    await store.write('front', '2026-08-28', manifest);

    await expect(store.read('front', '2026-08-28')).resolves.toEqual(manifest);
    expect(store.isComplete(manifest)).toBe(true);
  });

  it('warns and treats malformed manifests as absent', async () => {
    const { logger, store } = await fixture();
    const file = store.pathFor('front', '2026-08-28');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ broken', 'utf8');

    await expect(store.read('front', '2026-08-28')).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('camera.manifest.unreadable', expect.any(Object));
  });
});
