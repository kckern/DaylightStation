import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createArtSource } from '../../../backend/src/1_adapters/content/art/sources/artSource.mjs';

let base;
const write = async (rel, content) => {
  const p = path.join(base, rel);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content);
};

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'artsrc-'));
  await write('art/classic/Monet - 1900 - Lilies/lilies.jpg', 'x');
  await write('art/classic/Monet - 1900 - Lilies/metadata.yaml',
    'title: Lilies\nartist: Claude Monet\ndate: c. 1900\norigin: France\nwidth: 1600\nheight: 1000\n');
  await write('art/classic/Rembrandt - 1640 - Portrait/p.jpg', 'x');
  await write('art/classic/Rembrandt - 1640 - Portrait/metadata.yaml',
    'title: Portrait\nartist: Rembrandt\ndate: 1640\norigin: Netherlands\nwidth: 800\nheight: 1200\n');
  await write('art/classic/Wide - 1900 - Pano/pano.jpg', 'x');
  await write('art/classic/Wide - 1900 - Pano/metadata.yaml',
    'title: Pano\ndate: 1900\nwidth: 4000\nheight: 1000\n');
  await write('art/themed/americana/Flag - 1950 - Stars/flag.jpg', 'x');
  await write('art/themed/americana/Flag - 1950 - Stars/metadata.yaml',
    'title: Stars\ndate: 1950\nwidth: 1600\nheight: 1000\n');
});
afterAll(async () => { await fs.rm(base, { recursive: true, force: true }); });

describe('createArtSource.resolveCandidates', () => {
  const src = () => createArtSource({ imgBasePath: base });

  it('all → whole classic pool, excludes panoramic, classifies kind', async () => {
    const c = await src().resolveCandidates({});
    const ids = c.map((x) => x.id).sort();
    expect(ids).toEqual(['Monet - 1900 - Lilies', 'Rembrandt - 1640 - Portrait']);
    expect(c.find((x) => x.id.startsWith('Monet')).kind).toBe('landscape');
    expect(c.find((x) => x.id.startsWith('Rembrandt')).kind).toBe('portrait');
  });

  it('builds a media image URL', async () => {
    const [m] = (await src().resolveCandidates({})).filter((x) => x.id.startsWith('Monet'));
    expect(m.image).toBe('/media/img/art/classic/Monet%20-%201900%20-%20Lilies/lilies.jpg');
    expect(m.meta.artist).toBe('Claude Monet');
  });

  it('date filter scopes the pool', async () => {
    const c = await src().resolveCandidates({ dateMin: 1600, dateMax: 1700 });
    expect(c.map((x) => x.id)).toEqual(['Rembrandt - 1640 - Portrait']);
  });

  it('folder selector scopes to a curated subdir', async () => {
    const c = await src().resolveCandidates({ folder: 'themed/americana' });
    expect(c.map((x) => x.id)).toEqual(['Flag - 1950 - Stars']);
    expect(c[0].image).toBe('/media/img/art/themed/americana/Flag%20-%201950%20-%20Stars/flag.jpg');
  });

  it('exposes loadImage as a function on each candidate', async () => {
    const c = await src().resolveCandidates({});
    expect(typeof c[0].loadImage).toBe('function');
  });
});
