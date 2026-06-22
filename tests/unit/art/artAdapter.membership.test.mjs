import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Jimp } from 'jimp';
import { createArtAdapter } from '../../../backend/src/1_adapters/content/art/ArtAdapter.mjs';

const noop = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} };
let tmp, imgBasePath;

async function writeWork(folder, metaLines) {
  const dir = path.join(imgBasePath, 'art', 'classic', folder);
  fs.mkdirSync(dir, { recursive: true });
  await new Jimp({ width: 16, height: 12, color: 0x808080ff }).write(path.join(dir, 'art.png'));
  fs.writeFileSync(path.join(dir, 'metadata.yaml'), `title: ${folder}\nwidth: 16\nheight: 12\n${metaLines}`);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artad-'));
  imgBasePath = path.join(tmp, 'img');
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('ArtAdapter honors curation', () => {
  it('never selects a hidden work', async () => {
    await writeWork('shown', "date: '1875'\n");
    await writeWork('hidden', "date: '1875'\nhidden: true\n");
    const adapter = createArtAdapter({ imgBasePath, collections: { all: {} }, logger: noop });
    const featured = await adapter.selectFeatured({ collection: 'all', pick: (arr) => arr[0] });
    expect(featured.panels[0].meta.title).toBe('shown');
  });

  it('selects a rule-miss that was tagged into the collection', async () => {
    await writeWork('odd', "date: '1500'\ntags:\n  - impressionism\n");
    const adapter = createArtAdapter({
      imgBasePath, collections: { impressionism: { dateMin: 1860, dateMax: 1900 } }, logger: noop,
    });
    const featured = await adapter.selectFeatured({ collection: 'impressionism', pick: (arr) => arr[0] });
    expect(featured.panels[0].meta.title).toBe('odd');
  });
});
