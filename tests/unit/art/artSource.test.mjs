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
  // Near-square but wider than tall (ratio ~1.27) — must hang single (landscape),
  // not pair into a diptych. Regression for "landscapes appearing side by side".
  await write('art/classic/Bingham - 1846 - Flatboat/flatboat.jpg', 'x');
  await write('art/classic/Bingham - 1846 - Flatboat/metadata.yaml',
    'title: Jolly Flatboatmen\nartist: George Caleb Bingham\ndate: 1846\nwidth: 1270\nheight: 1000\n');
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
    expect(ids).toEqual(['Bingham - 1846 - Flatboat', 'Monet - 1900 - Lilies', 'Rembrandt - 1640 - Portrait']);
    expect(c.find((x) => x.id.startsWith('Monet')).kind).toBe('landscape');
    expect(c.find((x) => x.id.startsWith('Rembrandt')).kind).toBe('portrait');
    // Wider-than-tall near-square hangs single, not as a portrait pair.
    expect(c.find((x) => x.id.startsWith('Bingham')).kind).toBe('landscape');
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

describe('createArtSource nested (sectioned) scopes', () => {
  let nbase;
  const nwrite = async (rel, content) => {
    const p = path.join(nbase, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
  };

  beforeAll(async () => {
    nbase = await fs.mkdtemp(path.join(os.tmpdir(), 'artnest-'));
    // A scope whose works live one level deeper, grouped into section folders
    // (art/americana/<section>/<work>/), matching the curated Americana pool.
    await nwrite('art/americana/military/Doolittle - 1775 - Lexington/a.jpg', 'x');
    await nwrite('art/americana/military/Doolittle - 1775 - Lexington/metadata.yaml',
      'title: Lexington\nartist: Amos Doolittle\ndate: 1775\nwidth: 1600\nheight: 1000\n');
    await nwrite('art/americana/everyday/Homer - 1872 - Snap the Whip/b.jpg', 'x');
    await nwrite('art/americana/everyday/Homer - 1872 - Snap the Whip/metadata.yaml',
      'title: Snap the Whip\nartist: Winslow Homer\ndate: 1872\nwidth: 1600\nheight: 1000\n');
    // A work sitting DIRECTLY under the scope (depth 1) must still be found
    // alongside the nested ones — scopes may be mixed-depth.
    await nwrite('art/americana/Stuart - 1796 - Washington/c.jpg', 'x');
    await nwrite('art/americana/Stuart - 1796 - Washington/metadata.yaml',
      'title: Washington\nartist: Gilbert Stuart\ndate: 1796\nwidth: 900\nheight: 1100\n');
  });
  afterAll(async () => { await fs.rm(nbase, { recursive: true, force: true }); });

  const src = () => createArtSource({ imgBasePath: nbase });

  it('discovers nested works one section level deep, plus depth-1 works', async () => {
    const c = await src().resolveCandidates({ folder: 'americana' });
    expect(c.map((x) => x.id).sort()).toEqual([
      'Stuart - 1796 - Washington',
      'everyday/Homer - 1872 - Snap the Whip',
      'military/Doolittle - 1775 - Lexington',
    ]);
  });

  it('builds a media URL that includes the section path', async () => {
    const c = await src().resolveCandidates({ folder: 'americana' });
    const lex = c.find((x) => x.id.endsWith('Lexington'));
    expect(lex.image).toBe(
      '/media/img/art/americana/military/Doolittle%20-%201775%20-%20Lexington/a.jpg');
  });

  it('exposes the section name on meta for collection filtering', async () => {
    const c = await src().resolveCandidates({ folder: 'americana' });
    const lex = c.find((x) => x.id.endsWith('Lexington'));
    const wash = c.find((x) => x.id.endsWith('Washington'));
    expect(lex.meta.section).toBe('military');
    expect(wash.meta.section).toBe(null);  // depth-1 work has no section
  });

  it('scopes to a single section via the section predicate', async () => {
    const c = await src().resolveCandidates({ folder: 'americana', section: 'military' });
    expect(c.map((x) => x.id)).toEqual(['military/Doolittle - 1775 - Lexington']);
  });

  it('self-heals when a work is added inside an existing section', async () => {
    const s = src();
    await s.resolveCandidates({ folder: 'americana' });        // prime cache
    await nwrite('art/americana/military/Trumbull - 1820 - Declaration/d.jpg', 'x');
    await nwrite('art/americana/military/Trumbull - 1820 - Declaration/metadata.yaml',
      'title: Declaration\nartist: John Trumbull\ndate: 1820\nwidth: 1600\nheight: 1000\n');
    const after = await s.resolveCandidates({ folder: 'americana', section: 'military' });
    expect(after.map((x) => x.id).sort()).toEqual([
      'military/Doolittle - 1775 - Lexington',
      'military/Trumbull - 1820 - Declaration',
    ]);
  });
});

describe('createArtSource scope cache', () => {
  let cbase;
  const cwrite = async (rel, content) => {
    const p = path.join(cbase, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
  };

  beforeAll(async () => {
    cbase = await fs.mkdtemp(path.join(os.tmpdir(), 'artcache-'));
    await cwrite('art/classic/A - 1900 - One/a.jpg', 'x');
    await cwrite('art/classic/A - 1900 - One/metadata.yaml',
      'title: One\nartist: Anon\nwidth: 1600\nheight: 1000\n');
  });
  afterAll(async () => { await fs.rm(cbase, { recursive: true, force: true }); });

  it('serves edits to an existing work from cache (scope mtime unchanged)', async () => {
    const src = createArtSource({ imgBasePath: cbase });
    const first = await src.resolveCandidates({});
    expect(first.map((x) => x.meta.title)).toEqual(['One']);
    // Editing a file *inside* an existing work dir does not bump the scope dir's
    // mtime, so the cached scan is reused — the old title survives.
    await cwrite('art/classic/A - 1900 - One/metadata.yaml',
      'title: Edited\nartist: Anon\nwidth: 1600\nheight: 1000\n');
    const second = await src.resolveCandidates({});
    expect(second.map((x) => x.meta.title)).toEqual(['One']);
  });

  it('self-heals when a work folder is added (scope mtime bumps)', async () => {
    const src = createArtSource({ imgBasePath: cbase });
    await src.resolveCandidates({});                          // prime cache
    await cwrite('art/classic/B - 1910 - Two/b.jpg', 'x');
    await cwrite('art/classic/B - 1910 - Two/metadata.yaml',
      'title: Two\nartist: Anon\nwidth: 1600\nheight: 1000\n');
    const after = await src.resolveCandidates({});
    expect(after.map((x) => x.id).sort()).toEqual(['A - 1900 - One', 'B - 1910 - Two']);
  });
});
