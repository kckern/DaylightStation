import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlCharadesClueHistory } from './YamlCharadesClueHistory.mjs';

const roots = [];

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'charades-history-'));
  roots.push(root);
  return { root, store: new YamlCharadesClueHistory({ file: path.join(root, 'charades.yml') }) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('YamlCharadesClueHistory', () => {
  it('appends in order and deduplicates an idempotency key', async () => {
    const { store } = await fixture();
    await store.append('charades:fhe', { key: 's:0:0', clue_id: 'rabbit' });
    await store.append('charades:fhe', { key: 's:1:0', clue_id: 'duck' });
    await store.append('charades:fhe', { key: 's:0:0', clue_id: 'wrong' });
    await expect(store.list('charades:fhe')).resolves.toEqual([
      { key: 's:0:0', clue_id: 'rabbit' },
      { key: 's:1:0', clue_id: 'duck' },
    ]);
  });

  it('does not lose overlapping appends', async () => {
    const { store } = await fixture();
    await Promise.all([
      store.append('charades:fhe', { key: 's:0:0', clue_id: 'rabbit' }),
      store.append('charades:fhe', { key: 's:1:0', clue_id: 'duck' }),
    ]);
    await expect(store.list('charades:fhe')).resolves.toEqual([
      { key: 's:0:0', clue_id: 'rabbit' },
      { key: 's:1:0', clue_id: 'duck' },
    ]);
  });

  it('isolates definitions and replaces only the requested definition', async () => {
    const { store } = await fixture();
    await store.append('charades:other', { key: 'other:0', clue_id: 'camel' });
    await store.append('charades:fhe', { key: 'old:0', clue_id: 'old' });
    await store.replace('charades:fhe', [{ key: 'real:0', clue_id: 'rabbit' }]);
    await expect(store.list('charades:fhe')).resolves.toEqual([{ key: 'real:0', clue_id: 'rabbit' }]);
    await expect(store.list('charades:other')).resolves.toEqual([{ key: 'other:0', clue_id: 'camel' }]);
  });

  it('fails closed on malformed stored YAML', async () => {
    const { root, store } = await fixture();
    await fs.writeFile(path.join(root, 'charades.yml'), 'version: 1\ndefinitions:\n  charades:fhe: nope\n');
    await expect(store.list('charades:fhe')).rejects.toThrow('invalid charades clue history');
  });

  it('rejects empty definition, key, and clue identifiers', async () => {
    const { store } = await fixture();
    await expect(store.append('', { key: 'x', clue_id: 'rabbit' })).rejects.toThrow('definition id');
    await expect(store.append('charades:fhe', { key: '', clue_id: 'rabbit' })).rejects.toThrow('entry');
    await expect(store.append('charades:fhe', { key: 'x', clue_id: '' })).rejects.toThrow('entry');
  });
});
