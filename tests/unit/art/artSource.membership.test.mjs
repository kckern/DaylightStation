import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Jimp } from 'jimp';
import { createArtSource } from '../../../backend/src/1_adapters/content/art/sources/artSource.mjs';

const noop = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} };
let tmp, imgBasePath;

// Landscape work (16x12 → ratio 1.33, not panoramic) so it survives the scan.
async function writeWork(folder, metaLines) {
  const dir = path.join(imgBasePath, 'art', 'classic', folder);
  fs.mkdirSync(dir, { recursive: true });
  await new Jimp({ width: 16, height: 12, color: 0x808080ff }).write(path.join(dir, 'art.png'));
  fs.writeFileSync(path.join(dir, 'metadata.yaml'),
    `title: ${folder}\nwidth: 16\nheight: 12\n${metaLines}`);
}

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artsrc-')); imgBasePath = path.join(tmp, 'img'); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('artSource membership + listWorks', () => {
  it('resolveCandidates(def, key) drops hidden works', async () => {
    await writeWork('visible', "date: '1875'\n");
    await writeWork('gone', "date: '1875'\nhidden: true\n");
    const src = createArtSource({ imgBasePath, logger: noop });
    const cands = await src.resolveCandidates({ dateMin: 1860, dateMax: 1900 }, 'impressionism');
    expect(cands.map((c) => c.id).sort()).toEqual(['visible']);
  });

  it('resolveCandidates includes a rule-miss tagged with the collection name', async () => {
    await writeWork('odd', "date: '1500'\ntags:\n  - impressionism\n");
    const src = createArtSource({ imgBasePath, logger: noop });
    const cands = await src.resolveCandidates({ dateMin: 1860, dateMax: 1900 }, 'impressionism');
    expect(cands.map((c) => c.id)).toContain('odd');
    expect(cands[0].meta.tags).toEqual(['impressionism']);
  });

  it('listWorks returns ALL works incl. hidden/flagged with curation fields', async () => {
    await writeWork('a', "date: '1875'\n");
    await writeWork('b', "date: '1875'\nhidden: true\nflagged: true\ntags:\n  - baroque\ncrop_anchor: top\n");
    const src = createArtSource({ imgBasePath, logger: noop });
    const works = await src.listWorks();
    const byId = Object.fromEntries(works.map((w) => [w.id, w]));
    expect(Object.keys(byId).sort()).toEqual(['a', 'b']);
    expect(byId.b.meta).toMatchObject({ hidden: true, flagged: true, tags: ['baroque'], crop_anchor: 'top' });
    expect(byId.a.meta).toMatchObject({ hidden: false, flagged: false, tags: [], exclude: [] });
  });
});
