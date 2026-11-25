import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { YamlSurroundSegmentReader, flattenWorkSegments, pairSidecar } from './YamlSurroundSegmentReader.mjs';

let root;
const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() });
function write(relPath, body) {
  const full = path.join(root, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
}

const WORK = [
  'title: Winter Concert',
  'year: 2001',
  'groups:',
  '  - kind: piece',
  '    title: Opening',
  '    segments:',
  '      - { n: 1, name: Opening Carol, kind: song, song: opening-carol }',
  '  - kind: piece',
  '    title: Second',
  '    segments:',
  '      - { n: 2, name: Introduction, kind: introduction }',
  '      - { n: 3, name: Second Carol, kind: song, song: second-carol }',
  '',
].join('\n');

const SIDECAR = [
  'work: choir/2001-winter-concert',
  'surround: test-hall',
  'match: { contentId: "plex:1001", title: Winter Concert }',
  'spans:',
  '  - [10, 200]',
  '  - [210, 260]',
  '  - [270, 500]',
  'confidence: [derived, verified, guessed]',
  '',
].join('\n');

beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'surround-segments-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('flattenWorkSegments', () => {
  it('flattens nested groups in order', () => {
    const work = {
      groups: [
        { segments: [{ n: 1 }], groups: [{ segments: [{ n: 2 }] }] },
        { segments: [{ n: 3 }] },
      ],
    };
    expect(flattenWorkSegments(work).map((s) => s.n)).toEqual([1, 2, 3]);
  });

  it('reads a flat segments list', () => {
    expect(flattenWorkSegments({ segments: [{ n: 1 }, { n: 2 }] }).map((s) => s.n)).toEqual([1, 2]);
  });

  it('returns nothing for a work without segments', () => {
    expect(flattenWorkSegments({})).toEqual([]);
    expect(flattenWorkSegments(null)).toEqual([]);
  });
});

describe('pairSidecar', () => {
  it('pairs spans and confidence positionally with the work segments', () => {
    const paired = pairSidecar({
      doc: { match: { contentId: 'plex:1' }, spans: [[1, 2], null, [5, 9]], confidence: ['derived'] },
      work: { title: 'T', year: 1999, segments: [{ n: 1, name: 'a' }, { n: 2, name: 'b' }, { n: 3, name: 'c' }] },
    });
    expect(paired).toEqual({
      contentId: 'plex:1', title: 'T', year: 1999,
      segments: [
        { n: 1, name: 'a', start: 1, end: 2, confidence: 'derived' },
        { n: 2, name: 'b', start: undefined, end: undefined, confidence: undefined },
        { n: 3, name: 'c', start: 5, end: 9, confidence: undefined },
      ],
    });
  });

  it('lets the sidecar piece override title and year', () => {
    const paired = pairSidecar({
      doc: { match: { contentId: 'plex:1' }, piece: { title: 'Broadcast', year: 2004 } },
      work: { title: 'T', year: 1999, segments: [] },
    });
    expect(paired).toMatchObject({ title: 'Broadcast', year: 2004 });
  });
});

describe('YamlSurroundSegmentReader', () => {
  it('reads every sidecar of a works folder with its work', () => {
    write('surround/season/choir/2001-winter-concert.yml', SIDECAR);
    write('library/season/choir/2001-winter-concert.yml', WORK);
    const reader = new YamlSurroundSegmentReader({
      rootDir: path.join(root, 'surround'), libraryDir: path.join(root, 'library'), logger: makeLogger(),
    });
    const [sidecar, ...rest] = reader.read('season/choir');
    expect(rest).toEqual([]);
    expect(sidecar).toMatchObject({ contentId: 'plex:1001', title: 'Winter Concert', year: 2001 });
    expect(sidecar.segments.map((s) => [s.n, s.kind, s.song, s.start, s.end, s.confidence])).toEqual([
      [1, 'song', 'opening-carol', 10, 200, 'derived'],
      [2, 'introduction', undefined, 210, 260, 'verified'],
      [3, 'song', 'second-carol', 270, 500, 'guessed'],
    ]);
  });

  it('finds a work filed under a deeper grouping folder', () => {
    write('surround/season/choir/2001-winter-concert.yml', SIDECAR);
    write('library/season/archive/choir/2001-winter-concert.yml', WORK);
    const reader = new YamlSurroundSegmentReader({
      rootDir: path.join(root, 'surround'), libraryDir: path.join(root, 'library'), logger: makeLogger(),
    });
    expect(reader.read('season/choir')).toHaveLength(1);
  });

  it('skips sidecars whose work is missing, and says so', () => {
    write('surround/season/choir/2001-winter-concert.yml', SIDECAR);
    const logger = makeLogger();
    const reader = new YamlSurroundSegmentReader({
      rootDir: path.join(root, 'surround'), libraryDir: path.join(root, 'library'), logger,
    });
    expect(reader.read('season/choir')).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('surround-segments.work.missing', expect.objectContaining({ work: 'choir/2001-winter-concert' }));
  });

  it('skips reserved and unusable files', () => {
    write('surround/season/choir/_notes.yml', SIDECAR);
    write('surround/season/choir/no-match.yml', 'work: choir/x\n');
    write('surround/season/choir/broken.yml', ': : :\n  - [');
    const reader = new YamlSurroundSegmentReader({
      rootDir: path.join(root, 'surround'), libraryDir: path.join(root, 'library'), logger: makeLogger(),
    });
    expect(reader.read('season/choir')).toEqual([]);
  });

  it('refuses a works path that leaves the tree', () => {
    const reader = new YamlSurroundSegmentReader({
      rootDir: path.join(root, 'surround'), libraryDir: path.join(root, 'library'), logger: makeLogger(),
    });
    expect(reader.read('../../etc')).toEqual([]);
    expect(reader.read('')).toEqual([]);
    expect(reader.read(undefined)).toEqual([]);
  });
});
