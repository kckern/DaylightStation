import fs from 'fs';
import os from 'os';
import path from 'path';
import { createArtAdapter } from '../../../../backend/src/1_adapters/content/art/ArtAdapter.mjs';

const noopLogger = { warn: () => {}, error: () => {}, debug: () => {}, info: () => {} };

let tmp;
let imgBasePath;

const writeArt = (folder, imageName, metaYaml) => {
  const dir = path.join(imgBasePath, 'art', 'classic', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, imageName), 'fake-image-bytes');
  if (metaYaml != null) fs.writeFileSync(path.join(dir, 'metadata.yaml'), metaYaml);
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'art-'));
  imgBasePath = path.join(tmp, 'img');
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('ArtAdapter', () => {
  it('returns image path + metadata for the picked folder', async () => {
    writeArt(
      'Adriaen van Ostade - 1674 - Merrymakers in an Inn',
      'Merrymakers in an Inn.jpg',
      "title: Merrymakers in an Inn\nartist: Adriaen van Ostade\ndate: '1674'\norigin: Holland\nmedium: Oil on panel\n"
    );
    const adapter = createArtAdapter({ imgBasePath });
    const result = await adapter.selectFeatured({ pick: (arr) => arr[0] });

    expect(result.image).toBe(
      '/media/img/art/classic/Adriaen%20van%20Ostade%20-%201674%20-%20Merrymakers%20in%20an%20Inn/Merrymakers%20in%20an%20Inn.jpg'
    );
    expect(result.meta).toEqual({
      title: 'Merrymakers in an Inn',
      artist: 'Adriaen van Ostade',
      date: '1674',
      origin: 'Holland',
      medium: 'Oil on panel',
    });
  });

  it('returns null metadata fields when metadata.yaml is missing', async () => {
    writeArt('Unknown - 0000 - Untitled', 'art.png', null);
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    const result = await adapter.selectFeatured({ pick: (arr) => arr[0] });
    expect(result.image).toBe('/media/img/art/classic/Unknown%20-%200000%20-%20Untitled/art.png');
    expect(result.meta).toEqual({ title: null, artist: null, date: null, origin: null, medium: null });
  });

  it('throws when no artwork folders exist', async () => {
    fs.mkdirSync(path.join(imgBasePath, 'art', 'classic'), { recursive: true });
    const adapter = createArtAdapter({ imgBasePath });
    await expect(adapter.selectFeatured({ pick: (arr) => arr[0] })).rejects.toThrow('No artwork available');
  });

  it('falls back to null metadata fields when metadata.yaml is unparseable', async () => {
    writeArt('Bad - 0000 - Corrupt', 'art.jpg', ':\n  - unbalanced: [oops');
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    const result = await adapter.selectFeatured({ pick: (arr) => arr[0] });
    expect(result.image).toBe('/media/img/art/classic/Bad%20-%200000%20-%20Corrupt/art.jpg');
    expect(result.meta).toEqual({ title: null, artist: null, date: null, origin: null, medium: null });
  });
});
