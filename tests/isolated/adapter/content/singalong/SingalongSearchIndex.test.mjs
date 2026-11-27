// tests/isolated/adapter/content/singalong/SingalongSearchIndex.test.mjs
//
// 2026-11-27: search built every song (getItem: YAML scan, manifest, audio
// file scan, MP3 header read) for each of ~650 songs per search — ~1 s alone,
// 8 s (its budget) beside the other sources, so "hymn" timed out. Search now
// matches titles in an index and builds only the matches.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SingalongAdapter } from '../../../../../__capabilities/content-catalog/server/adapters/providers/singalong/SingalongAdapter.mjs';

describe('SingalongAdapter search index', () => {
  let root;
  let adapter;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'singalong-search-'));
    const song = (coll, file, title) => {
      fs.mkdirSync(path.join(root, 'data', coll), { recursive: true });
      fs.writeFileSync(path.join(root, 'data', coll, file), `title: ${title}\n`);
    };
    song('hymn', '0001-the-morning-breaks.yml', 'The Morning Breaks');
    song('hymn', '0002-the-spirit-of-god.yml', 'The Spirit of God');
    song('hymn', '0003-now-let-us-rejoice.yml', 'Now Let Us Rejoice');
    song('primary', '0001-i-am-a-child-of-god.yml', 'I Am a Child of God');
    fs.writeFileSync(path.join(root, 'data', 'hymn', 'manifest.yml'), 'contentType: stanzas\n');
    fs.mkdirSync(path.join(root, 'media'), { recursive: true });
    adapter = new SingalongAdapter({ dataPath: path.join(root, 'data'), mediaPath: path.join(root, 'media') });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('builds only the matching songs, and each once', async () => {
    const getItem = vi.spyOn(adapter, 'getItem');
    const first = await adapter.search({ text: 'god' });
    expect(first.items.map((i) => i.id)).toEqual(['singalong:hymn/2', 'singalong:primary/1']);
    expect(getItem.mock.calls.map(([id]) => id)).toEqual(['hymn/2', 'primary/1']);

    await adapter.search({ text: 'god' });
    expect(getItem).toHaveBeenCalledTimes(2);
  });

  it('matches numbers, narrows to a collection, and lists all for empty text', async () => {
    expect((await adapter.search({ text: '3' })).items.map((i) => i.id)).toEqual(['singalong:hymn/3']);
    expect((await adapter.search({ text: 'god', collection: 'primary' })).items.map((i) => i.id)).toEqual(['singalong:primary/1']);
    expect((await adapter.search({ text: '', take: 2 })).items).toHaveLength(2);
  });

  it('prepareSearch builds the index the next search reads', async () => {
    const build = vi.spyOn(adapter, '_buildSearchIndex');
    expect(await adapter.prepareSearch()).toEqual({ entries: 4 });
    await adapter.search({ text: 'morning' });
    expect(build).toHaveBeenCalledTimes(1);
  });
});
