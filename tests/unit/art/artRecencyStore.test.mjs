import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { createArtRecencyStore } from '../../../backend/src/1_adapters/content/art/artRecencyStore.mjs';

let dir;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artrec-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

const file = () => path.join(dir, 'history', 'media_memory', 'art.yml');

describe('artRecencyStore', () => {
  it('starts empty when no file exists (missing file is not an error)', async () => {
    const store = createArtRecencyStore({ filePath: file() });
    expect((await store.load()).size).toBe(0);
  });

  it('records ids, bumps showCount, and persists in the art:<id> shape', async () => {
    const store = createArtRecencyStore({ filePath: file(), now: () => '2026-06-17T12:00:00Z' });
    await store.record(['flag', 'eagle']);
    await store.record(['flag']);                 // second show of flag

    const doc = yaml.load(await fs.readFile(file(), 'utf-8'));
    expect(doc['art:flag']).toEqual({ lastShown: '2026-06-17T12:00:00Z', showCount: 2 });
    expect(doc['art:eagle']).toEqual({ lastShown: '2026-06-17T12:00:00Z', showCount: 1 });
  });

  it('reloads persisted history into a fresh store instance', async () => {
    const a = createArtRecencyStore({ filePath: file(), now: () => '2026-06-17T09:00:00Z' });
    await a.record(['x']);

    const b = createArtRecencyStore({ filePath: file() });
    const map = await b.load();
    expect(map.get('x')).toBe('2026-06-17T09:00:00Z');
  });

  it('skips null ids', async () => {
    const store = createArtRecencyStore({ filePath: file(), now: () => 't' });
    await store.record([null, 'real', undefined]);
    const map = await store.load();
    expect([...map.keys()]).toEqual(['real']);
  });
});
