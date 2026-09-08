import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FilesystemStaticImageRepository } from './FilesystemStaticImageRepository.mjs';

// Equipment pictures were found by equipment id alone. The pedaler's id is
// `generic_pedaler` and its picture is `peddler.jpg`, so the id found nothing
// and every surface fell back to the generic icon. Fitness config may now name
// the file; the id convention stays the default for everything else.
let root;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'equip-img-'));
  fs.mkdirSync(path.join(root, 'equipment'));
  fs.writeFileSync(path.join(root, 'equipment', 'peddler.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
  fs.writeFileSync(path.join(root, 'equipment', 'niceday.jpg'), Buffer.from([0xff, 0xd8, 0xfe]));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const repo = (equipmentImages) =>
  new FilesystemStaticImageRepository({ imgBasePath: root, equipmentImages });

describe('equipment image resolution', () => {
  it('serves the filename the config declares, not the equipment id', async () => {
    const image = await repo({ generic_pedaler: 'peddler.jpg' }).getImage('equipment', 'generic_pedaler');
    expect(image?.identity).toBe('equipment/peddler.jpg');
    expect(image.contentType).toBe('image/jpeg');
  });

  it('still finds equipment whose id names its file, with no declaration', async () => {
    const image = await repo({ generic_pedaler: 'peddler.jpg' }).getImage('equipment', 'niceday');
    expect(image?.identity).toBe('equipment/niceday.jpg');
  });

  it('behaves as before when no map is supplied at all', async () => {
    const bare = new FilesystemStaticImageRepository({ imgBasePath: root });
    expect((await bare.getImage('equipment', 'niceday'))?.identity).toBe('equipment/niceday.jpg');
    expect(await bare.getImage('equipment', 'generic_pedaler')).toBeNull();
  });

  it('does not silently fall back to the id when a declared filename is missing', async () => {
    // A typo in config must surface as the generic icon, not as a lucky
    // id-derived hit that hides the typo forever.
    const image = await repo({ niceday: 'nicedya.jpg' }).getImage('equipment', 'niceday');
    expect(image).toBeNull();
  });

  it('ignores inherited Object properties as declared filenames', async () => {
    const image = await repo({}).getImage('equipment', 'constructor');
    expect(image).toBeNull();
  });
});
