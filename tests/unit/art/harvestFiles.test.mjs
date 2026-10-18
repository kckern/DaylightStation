import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { importHarvest, downloadHarvest } from '../../../__app_modules/media/art/cli/harvestFiles.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=', 'base64');
const item = { productId: '101', status: 'download', artist: 'Example Artist', title: 'Quiet Light', sourceUrl: 'https://example.test/products/quiet-light', image: { src: 'https://example.test/EA123.png' } };
const fixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'art-import-'));
  const cacheDir = path.join(root, 'cache'); const destination = path.join(root, 'religious', 'christ');
  await mkdir(cacheDir); await mkdir(destination, { recursive: true });
  await writeFile(path.join(cacheDir, '101.image'), png);
  return { destination, cacheDir, existingRoot: path.join(root, 'religious'), manifest: { items: [item] } };
};

describe('foundation import', () => {
  it('downloads only requested artwork bytes and reports failures without partial cache files', async () => {
    const f = await fixture();
    const result = await downloadHarvest({ cacheDir: f.cacheDir, allowWrite: true, manifest: { items: [
      { ...item, productId: '201' },
      { ...item, productId: '202', image: { src: 'https://example.test/bad.png' } },
      { ...item, productId: '203', status: 'existing' },
    ] }, fetch: async (url) => url.endsWith('bad.png') ? new Response('not found', { status: 404 }) : new Response(png), concurrency: 2 });
    expect(result.downloaded).toBe(1); expect(result.errors).toHaveLength(1);
    expect(await readFile(path.join(f.cacheDir, '201.image'))).toEqual(png);
    expect(await readdir(f.cacheDir)).not.toContain('202.image');
    expect(await readdir(f.cacheDir)).not.toContain('203.image');
  });
  it('requires explicit write authorization', async () => {
    const f = await fixture(); await expect(importHarvest(f)).rejects.toThrow('allow-write');
    expect(await readdir(f.destination)).toEqual([]);
  });
  it('imports actual dimensions and provenance while keeping content unreviewed', async () => {
    const f = await fixture(); const result = await importHarvest({ ...f, allowWrite: true });
    expect(result.imported).toBe(1);
    const directory = path.join(f.destination, 'Example Artist - n.d. - Quiet Light');
    const meta = yaml.load(await readFile(path.join(directory, 'metadata.yaml'), 'utf8'));
    expect(meta).toMatchObject({ title: 'Quiet Light', artist: 'Example Artist', width: 1, height: 1,
      source_url: item.sourceUrl, image_url: item.image.src, curation_status: 'unreviewed' });
    expect(await readFile(path.join(directory, 'Quiet Light.png'))).toEqual(png);
    const repeat = await importHarvest({ ...f, allowWrite: true });
    expect(repeat.imported).toBe(0);
  });
  it('does not create an empty work folder for a missing download', async () => {
    const f = await fixture(); f.manifest.items = [{ ...item, productId: 'missing' }];
    const result = await importHarvest({ ...f, allowWrite: true });
    expect(result.errors).toHaveLength(1); expect(await readdir(f.destination)).toEqual([]);
  });
  it('skips identical image content already filed under another section', async () => {
    const f = await fixture(); const prior = path.join(f.existingRoot, 'bible', 'Other Artist - n.d. - Same Picture');
    await mkdir(prior, { recursive: true });
    await writeFile(path.join(prior, 'metadata.yaml'), 'title: Same Picture\nartist: Other Artist\n');
    await writeFile(path.join(prior, 'Same Picture.png'), png);
    const result = await importHarvest({ ...f, allowWrite: true });
    expect(result.imported).toBe(0); expect(result.duplicates).toBe(1);
  });
});
