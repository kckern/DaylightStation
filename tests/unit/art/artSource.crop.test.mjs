import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Jimp } from 'jimp';
import { createArtSource } from '../../../backend/src/1_adapters/content/art/sources/artSource.mjs';

const noop = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} };
let tmp, imgBasePath;

async function writeWork(folder, metaLines) {
  const dir = path.join(imgBasePath, 'art', 'classic', folder);
  fs.mkdirSync(dir, { recursive: true });
  await new Jimp({ width: 16, height: 12, color: 0x808080ff }).write(path.join(dir, 'art.png'));
  fs.writeFileSync(path.join(dir, 'metadata.yaml'), `title: ${folder}\nwidth: 16\nheight: 12\n${metaLines}`);
}

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artcrop-')); imgBasePath = path.join(tmp, 'img'); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('artSource surfaces crop', () => {
  it('listWorks exposes a crop band', async () => {
    await writeWork('banded', "crop:\n  top: 12.5\n  bottom: 20\n");
    const src = createArtSource({ imgBasePath, logger: noop });
    const [w] = await src.listWorks();
    expect(w.meta.crop).toEqual({ enabled: true, top: 12.5, bottom: 20, left: null, right: null });
  });

  it('listWorks exposes an explicit not-croppable flag', async () => {
    await writeWork('nocrop', "crop:\n  enabled: false\n");
    const src = createArtSource({ imgBasePath, logger: noop });
    const [w] = await src.listWorks();
    expect(w.meta.crop).toMatchObject({ enabled: false });
  });

  it('works without crop expose crop: null', async () => {
    await writeWork('plain', "date: '1875'\n");
    const src = createArtSource({ imgBasePath, logger: noop });
    const [w] = await src.listWorks();
    expect(w.meta.crop).toBeNull();
  });
});
