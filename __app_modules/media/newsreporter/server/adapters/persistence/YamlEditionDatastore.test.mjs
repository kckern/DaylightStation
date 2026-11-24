import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { YamlEditionDatastore } from './YamlEditionDatastore.mjs';
import { saveYaml, loadYaml } from '#system/utils/FileIO.mjs';

/** A DataService double whose household scope is a real YAML tree. */
function fileDataService(root) {
  const resolve = (rel) => path.join(root, rel);
  return {
    household: {
      read: (rel) => loadYaml(resolve(rel)),
      write: (rel, data) => saveYaml(resolve(rel), data),
      resolveDir: (rel) => resolve(rel),
    },
  };
}

describe('YamlEditionDatastore', () => {
  let tmp;
  let store;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edition-store-'));
    store = new YamlEditionDatastore({
      dataService: fileDataService(path.join(tmp, 'data')),
      mediaDir: path.join(tmp, 'media'),
      logger: { debug() {} },
    });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('round-trips a record and lists newest first', async () => {
    const layout = { masthead: { title: 'T', dateLabel: 'MONDAY', number: 3 }, blocks: [{ type: 'footer', text: 'f' }] };
    await store.save('office-paper', '2026-11-22', { number: 2, status: 'composed', layout, deliveries: [] });
    await store.save('office-paper', '2026-11-23', { number: 3, status: 'composed', layout, deliveries: [{ at: 'x', printer: 'office', trigger: 'api' }] });

    const got = await store.get('office-paper', '2026-11-23');
    expect(got).toMatchObject({ date: '2026-11-23', number: 3, status: 'composed', layout });
    expect(got.deliveries).toHaveLength(1);
    expect(fs.existsSync(path.join(tmp, 'data', 'newsreporter/editions/office-paper/2026-11-23.yml'))).toBe(true);

    const list = await store.list('office-paper', { limit: 5 });
    expect(list.map((r) => r.date)).toEqual(['2026-11-23', '2026-11-22']);
    const before = await store.list('office-paper', { before: '2026-11-23' });
    expect(before.map((r) => r.date)).toEqual(['2026-11-22']);
    expect(await store.get('office-paper', '2026-01-01')).toBeNull();
  });

  it('stores the PNG on the media volume and hands back its path', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    expect(await store.pngPath('office-paper', '2026-11-23')).toBeNull();
    await store.savePng('office-paper', '2026-11-23', png);
    const file = await store.pngPath('office-paper', '2026-11-23');
    expect(file).toBe(path.join(tmp, 'media', 'newsreporter', 'office-paper', '2026-11-23.png'));
    expect(Buffer.compare(await store.readPng('office-paper', '2026-11-23'), png)).toBe(0);
  });

  it('refuses ids and dates that would escape the tree', async () => {
    await expect(store.get('../x', '2026-11-23')).rejects.toThrow(/bad reporter id/);
    await expect(store.savePng('office-paper', '../../etc', Buffer.alloc(1))).rejects.toThrow(/bad edition date/);
  });

  it('lists nothing for a reporter with no editions', async () => {
    expect(await store.list('office-paper')).toEqual([]);
  });
});
