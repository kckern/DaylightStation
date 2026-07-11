// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory YAML "filesystem" keyed by path, mirroring the simple loadYaml/saveYaml
// contract the datastore relies on (mirrors the mocking style used by the piano
// router tests, e.g. piano.history.test.mjs — there's no prior dedicated
// datastore test file for YamlPianoStudioDatastore to clone from).
let files = {};
vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYaml: (p) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null),
  saveYaml: (p, data) => { files[p] = data; },
  listYamlFiles: () => [],
  deleteYaml: () => false,
  ensureDir: vi.fn(),
  writeBinary: vi.fn(),
}));

import { YamlPianoStudioDatastore } from './YamlPianoStudioDatastore.mjs';

const configService = {
  getUserDir: (id) => `/data/users/${id}`,
  getUserProfile: (id) => (['kc'].includes(id) ? { id } : null),
  getHouseholdPath: (rel) => `/data/household/${rel}`,
  getHouseholdAppConfig: () => ({}),
  getMediaDir: () => '/data/media',
};

beforeEach(() => { files = {}; });

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
