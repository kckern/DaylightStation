import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createArtRecencyStore } from './artRecencyStore.mjs';

let filePath;

beforeEach(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'art-recency-'));
  filePath = path.join(dir, 'media/memory/art.yml');
});

describe('createArtRecencyStore', () => {
  it('persists art ids as art-prefixed records and restores their recency', async () => {
    const store = createArtRecencyStore({ filePath, now: () => '2026-08-28T12:00:00.000Z' });

    await store.record(['monet-water-lilies', 'hokusai-wave']);

    await expect(store.load()).resolves.toEqual(new Map([
      ['monet-water-lilies', '2026-08-28T12:00:00.000Z'],
      ['hokusai-wave', '2026-08-28T12:00:00.000Z'],
    ]));
    await expect(fs.readFile(filePath, 'utf8')).resolves.toMatch(/art:monet-water-lilies/);
  });

  it('treats a missing history as empty', async () => {
    const store = createArtRecencyStore({ filePath });

    await expect(store.load()).resolves.toEqual(new Map());
  });

  it('warns and treats malformed history as empty', async () => {
    const logger = { warn: vi.fn() };
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'art: { broken', 'utf8');
    const store = createArtRecencyStore({ filePath, logger });

    await expect(store.load()).resolves.toEqual(new Map());
    expect(logger.warn).toHaveBeenCalledWith('art.recency.read_failed', expect.any(Object));
  });
});
