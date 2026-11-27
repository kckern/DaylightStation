// ScriptureResolver.search — book names in every volume, and a text version
// that never drops a volume that lacks it.
//
// 2026-11-27: the Media "Books › Scripture" scope searched "Nephi" with
// `readalong.version=nirv` and got nothing. Bare book names never resolved
// (scripture-guide only answers a reference with a chapter), and the version
// was applied to every volume, so the Book of Mormon, D&C and Pearl of Great
// Price (which have no nirv) were skipped outright.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ScriptureResolver } from '../../../../../../__capabilities/content-catalog/server/adapters/providers/readalong/resolvers/scripture.mjs';

// <volume>/<version>/<firstVerseId>-<book-slug>-<chapter>.yml, real verse ids.
const FIXTURE = {
  'ot/kjvf': ['00001-genesis-1', '00032-genesis-2'],
  'ot/nirv': ['00001-genesis-1', '00032-genesis-2'],
  'nt/nirv': ['23146-matthew-1', '26122-john-3'],
  'bom/sebom': [
    '31103-1-nephi-1', '31123-1-nephi-2', '31721-2-nephi-1',
    '33578-alma-1', '34541-alma-32', '36050-3-nephi-1', '36835-4-nephi-1'
  ],
  'dc/readers': ['37707-doctrine-and-covenants-1', '37769-doctrine-and-covenants-4'],
  'pgp/lds': ['41361-moses-1', '41717-abraham-1']
};

const DEFAULTS = {
  ot: { text: 'kjvf' },
  nt: { text: 'kjvf' },
  bom: { text: 'sebom' },
  dc: { text: 'readers' },
  pgp: { text: 'lds' }
};

let dataPath;

beforeAll(() => {
  dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'scripture-search-'));
  for (const [dir, files] of Object.entries(FIXTURE)) {
    fs.mkdirSync(path.join(dataPath, dir), { recursive: true });
    for (const name of files) {
      const verseId = parseInt(name, 10);
      fs.writeFileSync(
        path.join(dataPath, dir, `${name}.yml`),
        `- verse_id: ${verseId}\n  headings:\n    title: ${name.replace(/^\d+-/, '')} heading\n  text: x\n`
      );
    }
  }
});

afterAll(() => {
  fs.rmSync(dataPath, { recursive: true, force: true });
});

const ids = (results) => results.map(r => r.localId);
const search = (q, version = 'nirv') =>
  ScriptureResolver.search(q, dataPath, { version, defaults: DEFAULTS, take: 20 });

describe('ScriptureResolver.search — book names in every volume', () => {
  it('"Nephi" finds every Nephi book, each book first chapter leading', () => {
    expect(ids(search('Nephi'))).toEqual([
      'scripture/bom/sebom/31103', // 1 Nephi 1
      'scripture/bom/sebom/31721', // 2 Nephi 1
      'scripture/bom/sebom/36050', // 3 Nephi 1
      'scripture/bom/sebom/36835', // 4 Nephi 1
      'scripture/bom/sebom/31123'  // 1 Nephi 2
    ]);
  });

  it('"1 Nephi" is that book only', () => {
    expect(ids(search('1 Nephi'))).toEqual(['scripture/bom/sebom/31103', 'scripture/bom/sebom/31123']);
  });

  it('"Alma" and "Alma 32"', () => {
    expect(ids(search('Alma'))).toEqual(['scripture/bom/sebom/33578', 'scripture/bom/sebom/34541']);
    expect(ids(search('Alma 32'))).toEqual(['scripture/bom/sebom/34541']);
  });

  it('"D&C 4" and "Doctrine and Covenants" reach the D&C despite a Bible-only version', () => {
    expect(ids(search('D&C 4'))).toEqual(['scripture/dc/readers/37769']);
    expect(ids(search('Doctrine and Covenants'))).toEqual([
      'scripture/dc/readers/37707', 'scripture/dc/readers/37769'
    ]);
    expect(ids(search('D&C'))).toEqual(['scripture/dc/readers/37707', 'scripture/dc/readers/37769']);
  });

  it('"Moses" finds the Pearl of Great Price', () => {
    expect(ids(search('Moses'))).toEqual(['scripture/pgp/lds/41361']);
  });

  it('a word prefix matches books in several volumes', () => {
    expect(ids(search('mos'))).toEqual(['scripture/pgp/lds/41361']);
    expect(ids(search('abr'))).toEqual(['scripture/pgp/lds/41717']);
  });
});

describe('ScriptureResolver.search — the Bible still works, and the version applies where it exists', () => {
  it('"Genesis" lists Genesis chapters in the requested version', () => {
    expect(ids(search('Genesis'))).toEqual(['scripture/ot/nirv/1', 'scripture/ot/nirv/32']);
  });

  it('"Genesis" without a version uses the volume default', () => {
    expect(ids(search('Genesis', null))).toEqual(['scripture/ot/kjvf/1', 'scripture/ot/kjvf/32']);
  });

  it('"John 3" is John 3, not every chapter before it', () => {
    expect(ids(search('John 3'))).toEqual(['scripture/nt/nirv/26122']);
  });

  it('a version no volume has falls back to each volume default instead of finding nothing', () => {
    expect(ids(search('Genesis', 'nope'))).toEqual(['scripture/ot/kjvf/1', 'scripture/ot/kjvf/32']);
    expect(ids(search('Moses', 'nope'))).toEqual(['scripture/pgp/lds/41361']);
  });

  it('text that is no book and no heading finds nothing', () => {
    expect(search('zzzq')).toEqual([]);
  });

  it('falls back to chapter headings', () => {
    // Fixture heading titles read "<slug> heading"; no book slug holds "heading".
    expect(ids(search('abraham-1 heading'))).toEqual(['scripture/pgp/lds/41717']);
  });
});
