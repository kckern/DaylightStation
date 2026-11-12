import { describe, expect, it } from 'vitest';
import { chooseVideoSource, parsePathMap } from './videoSource.mjs';

const T2 = '/data/media/video/movies/Terminator 2 - Judgment Day (1991)/Terminator 2 - Judgment Day (1991).mkv';
const part = { id: 765703, key: '/library/parts/765703/1604088276/file.mkv', file: T2 };
const base = { rk: '699056', part, host: 'http://plex:32400', token: 'tok' };

describe('parsePathMap', () => {
  it('reads from=to pairs, longest prefix first', () => {
    expect(parsePathMap(' /data=/x ; /data/media/video/movies=/mnt/m ')).toEqual([
      { from: '/data/media/video/movies', to: '/mnt/m' },
      { from: '/data', to: '/x' },
    ]);
  });
  it('is empty for nothing set', () => {
    expect(parsePathMap('')).toEqual([]);
    expect(parsePathMap(undefined)).toEqual([]);
  });
});

describe('chooseVideoSource', () => {
  const pathMap = parsePathMap('/data/media/video/movies=/mnt/movies');

  it('a --src flag wins', () => {
    expect(chooseVideoSource({ ...base, flagSrc: '/tmp/x.mkv', pathMap, exists: () => true })).toMatchObject({ kind: 'flag', src: '/tmp/x.mkv' });
  });

  it('reads the local file through the path map when it exists', () => {
    const r = chooseVideoSource({ ...base, pathMap, exists: () => true });
    expect(r).toEqual({ kind: 'local', src: '/mnt/movies/Terminator 2 - Judgment Day (1991)/Terminator 2 - Judgment Day (1991).mkv' });
  });

  it('a missing local file falls back to the 240p stream when low res is on', () => {
    const r = chooseVideoSource({ ...base, pathMap, exists: () => false, lowRes: true });
    expect(r.kind).toBe('plex-240p');
    expect(r.reason).toBe('missing-file');
    expect(r.src).toContain('/video/:/transcode/universal/start');
    expect(r.src).toContain('videoResolution=426x240');
    expect(r.src).toContain('path=%2Flibrary%2Fmetadata%2F699056');
  });

  it('with low res off, a missing file streams the part directly', () => {
    const r = chooseVideoSource({ ...base, pathMap, exists: () => false });
    expect(r).toEqual({ kind: 'plex-direct', src: 'http://plex:32400/library/parts/765703/1604088276/file.mkv?X-Plex-Token=tok', reason: 'missing-file' });
  });

  it('no path map says so', () => {
    expect(chooseVideoSource({ ...base, pathMap: [], exists: () => true }).reason).toBe('no-map');
  });

  it('a part with no file path streams', () => {
    expect(chooseVideoSource({ ...base, part: { ...part, file: undefined }, pathMap, exists: () => true }).kind).toBe('plex-direct');
  });
});
