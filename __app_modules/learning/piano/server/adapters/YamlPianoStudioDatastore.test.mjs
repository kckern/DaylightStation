// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory YAML "filesystem" keyed by path, mirroring the simple loadYaml/saveYaml
// contract the datastore relies on (mirrors the mocking style used by the piano
// router tests, e.g. piano.history.test.mjs — there's no prior dedicated
// datastore test file for YamlPianoStudioDatastore to clone from).
let files = {};
vi.mock('../../../../../__backend/src/0_system/utils/FileIO.mjs', () => ({
  loadYaml: (p) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null),
  saveYaml: (p, data) => { files[p] = data; },
  // The real atomic writer takes the full file path; loadYaml takes it without
  // the extension, so store under the extension-less key to keep both in step.
  saveYamlToPathAtomic: vi.fn((p, data) => { files[p.replace(/\.ya?ml$/, '')] = data; }),
  getStats: (p) => (Object.prototype.hasOwnProperty.call(files, p) ? { isFile: () => true } : null),
  listYamlFiles: () => [],
  deleteYaml: () => false,
  ensureDir: vi.fn(),
  writeBinary: vi.fn(),
}));

import { YamlPianoStudioDatastore } from './YamlPianoStudioDatastore.mjs';
import { saveYamlToPathAtomic } from '../../../../../__backend/src/0_system/utils/FileIO.mjs';
import { practiceKeyOfScore } from '../../portable/music/practiceKey.mjs';

const configService = {
  getUserDir: (id) => `/data/users/${id}`,
  getUserProfile: (id) => (['kc'].includes(id) ? { id } : null),
  getHouseholdPath: (rel) => `/data/household/${rel}`,
  getHouseholdAppConfig: () => ({}),
  getMediaDir: () => '/data/media',
};

beforeEach(() => { files = {}; vi.clearAllMocks(); });

describe('YamlPianoStudioDatastore — preset', () => {
  it('save→get round-trips a { default, favorites } blob for a known user', () => {
    const ds = new YamlPianoStudioDatastore({ configService });
    const blob = {
      default: { voice: { pc: 0, bank: 0 }, reverb: 'hall', chorus: null, volume: 0.7 },
      favorites: [{ voice: { pc: 4, bank: 0 }, reverb: null, chorus: null, volume: 0.5 }],
    };
    const saved = ds.savePreset('kc', blob);
    expect(saved).toBe(true);
    expect(ds.getPreset('kc')).toEqual(blob);
    expect(files['/data/users/kc/apps/piano/preset']).toEqual(blob);
  });

  it('returns null for an unknown user on get and save', () => {
    const ds = new YamlPianoStudioDatastore({ configService });
    expect(ds.getPreset('nobody')).toBeNull();
    expect(ds.savePreset('nobody', { default: {} })).toBe(false);
  });

  it('returns {} for a known user with no preset saved yet', () => {
    const ds = new YamlPianoStudioDatastore({ configService });
    expect(ds.getPreset('kc')).toEqual({});
  });
});

describe('sheet music Learn file', () => {
  const ID = 'files:docs/sheet-music/classical/fur-elise.musicxml';
  it('round-trips under household piano/sheetmusic keyed by practice key', () => {
    const ds = new YamlPianoStudioDatastore({ configService });
    ds.saveSheetMusicLearn(ID, { version: 1, scoreId: ID, segments: [{ id: 'a', start: 0, end: 3 }] });
    const key = Object.keys(files).find((p) => p.includes('piano/sheetmusic/'));
    expect(key.endsWith('files-docs-sheet-music-classical-fur-elise-musicxml')).toBe(true);
    expect(key.startsWith('/data/household/piano/sheetmusic/')).toBe(true);
    expect(ds.getSheetMusicLearn(ID).segments).toEqual([{ id: 'a', start: 0, end: 3 }]);
  });
  it('writes atomically and durably', () => {
    const ds = new YamlPianoStudioDatastore({ configService });
    ds.saveSheetMusicLearn(ID, { version: 1, scoreId: ID, segments: [] });
    expect(saveYamlToPathAtomic).toHaveBeenCalledWith(
      expect.stringMatching(/\/piano\/sheetmusic\/files-docs-sheet-music-classical-fur-elise-musicxml\.yml$/),
      expect.any(Object),
      { durable: true },
    );
  });
  it('does not overwrite a colliding Learn file owned by another score', () => {
    const colliding = ID.replace('fur-elise', 'fur_elise');
    expect(practiceKeyOfScore(colliding)).toBe(practiceKeyOfScore(ID));
    const ds = new YamlPianoStudioDatastore({ configService });
    const owned = { version: 1, scoreId: ID, segments: [{ id: 'a', start: 0, end: 3 }] };
    ds.saveSheetMusicLearn(ID, owned);

    let error;
    try { ds.saveSheetMusicLearn(colliding, { version: 1, scoreId: colliding, segments: [] }); } catch (cause) { error = cause; }
    expect(error).toMatchObject({ code: 'learn-record-conflict' });
    expect(ds.getSheetMusicLearn(ID)).toEqual(owned);
    expect(saveYamlToPathAtomic).toHaveBeenCalledTimes(1);
  });
  it('returns null when a library score has no Learn file yet', () => {
    const ds = new YamlPianoStudioDatastore({ configService });
    expect(ds.getSheetMusicLearn(ID)).toBeNull();
  });
  it('returns null for an id outside the sheet music tree', () => {
    const ds = new YamlPianoStudioDatastore({ configService });
    expect(ds.getSheetMusicLearn('files:docs/other/x.mxl')).toBeNull();
    expect(() => ds.saveSheetMusicLearn('files:../x.mxl', {})).toThrow();
    expect(() => ds.saveSheetMusicLearn('files:docs/sheet-music/../x.mxl', {})).toThrow();
    expect(() => ds.saveSheetMusicLearn('files:docs/other/x.mxl', {})).toThrow();
  });
  it('refuses a look-alike folder, a bare id, and dot or empty segments', () => {
    const ds = new YamlPianoStudioDatastore({ configService });
    for (const bad of [
      'files:docs/sheet-music-evil/x.mxl',
      'docs/sheet-music/a.mxl',
      'files:docs/sheet-music/./a.mxl',
      'files:docs/sheet-music//a.mxl',
    ]) {
      expect(ds.getSheetMusicLearn(bad)).toBeNull();
      expect(() => ds.saveSheetMusicLearn(bad, {})).toThrow();
    }
    expect(saveYamlToPathAtomic).not.toHaveBeenCalled();
  });
});

describe('sheetMusicCover', () => {
  const ID = 'files:docs/sheet-music/classical/fur-elise.musicxml';
  const STEM = '/data/media/docs/sheet-music/classical/fur-elise';
  const url = (rel) => `/api/v1/proxy/media/stream/${encodeURIComponent(rel)}`;
  it('serves an svg poster when it is the only picture', () => {
    files[`${STEM}.svg`] = true;
    const ds = new YamlPianoStudioDatastore({ configService });
    expect(ds.sheetMusicCover(ID)).toBe(url('docs/sheet-music/classical/fur-elise.svg'));
  });
  it('prefers a raster scan over the svg', () => {
    files[`${STEM}.svg`] = true;
    files[`${STEM}.jpg`] = true;
    const ds = new YamlPianoStudioDatastore({ configService });
    expect(ds.sheetMusicCover(ID)).toBe(url('docs/sheet-music/classical/fur-elise.jpg'));
  });
  it('refuses a bare id and dot segments even when a picture exists', () => {
    files['/data/media/docs/sheet-music/a.jpg'] = true;
    const ds = new YamlPianoStudioDatastore({ configService });
    expect(ds.sheetMusicCover('files:docs/sheet-music/a.mxl')).toBe(url('docs/sheet-music/a.jpg'));
    expect(ds.sheetMusicCover('docs/sheet-music/a.mxl')).toBeNull();
    expect(ds.sheetMusicCover('files:docs/sheet-music/./a.mxl')).toBeNull();
  });
  it('returns null with no picture', () => {
    const ds = new YamlPianoStudioDatastore({ configService });
    expect(ds.sheetMusicCover(ID)).toBeNull();
  });
});
