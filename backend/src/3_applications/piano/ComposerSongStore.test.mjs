// backend/src/3_applications/piano/ComposerSongStore.test.mjs
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

let files = {};      // yaml store: path -> object
let blobs = {};      // binary store: fullpath -> string
vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYaml: (p) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null),
  saveYaml: (p, data) => { files[p] = data; },
  listYamlFiles: (dir) => Object.keys(files).filter(p => p.startsWith(dir + '/')).map(p => p.slice(dir.length + 1)),
  deleteYaml: (p) => { const had = p in files; delete files[p]; return had; },
  deleteFile: (p) => { const had = p in blobs; delete blobs[p]; return had; },
  ensureDir: vi.fn(),
  writeBinary: (p, buf) => { blobs[p] = String(buf); },
  readFile: (p) => (p in blobs ? blobs[p] : null),
  listFiles: (dir) => Object.keys(blobs).filter(p => p.startsWith(dir + '/')).map(p => p.slice(dir.length + 1)),
}));
import { ComposerSongStore } from './ComposerSongStore.mjs';

const configService = {
  getUserDir: (id) => `/data/users/${id}`,
  getUserProfile: (id) => (['kc', 'soren'].includes(id) ? { id } : null),
  getHouseholdAppConfig: () => ({ composer: { versions_keep: 5, share_tag: 'family' } }),
};
const store = () => new ComposerSongStore({ configService, logger: { info() {}, warn() {}, debug() {} } });
const XML = '<score-partwise><part id="P1"><measure number="1"/></part></score-partwise>';

beforeEach(() => { files = {}; blobs = {}; });

describe('ComposerSongStore', () => {
  it('returns null list for an unknown user', () => {
    expect(store().list('nobody')).toBeNull();
  });
  it('creates then reads back meta + musicxml', () => {
    const s = store();
    const { id } = s.create('kc', { title: 'My Tune', musicxml: XML, meta: { tags: ['wip'] } });
    expect(id).toMatch(/^[a-z0-9-]{1,64}$/);
    const got = s.get('kc', id);
    expect(got.musicxml).toBe(XML);
    expect(got.meta.title).toBe('My Tune');
    expect(got.meta.revision).toBe(1);
    expect(s.list('kc').map(x => x.id)).toContain(id);
  });
  it('save bumps revision and rotates the prior xml into the versions ring', () => {
    const s = store();
    const { id } = s.create('kc', { title: 'T', musicxml: XML });
    const r = s.save('kc', id, { musicxml: XML + '<!--v2-->', meta: { title: 'T2' }, revision: 1 });
    expect(r.ok).toBe(true);
    expect(r.revision).toBe(2);
    expect(s.get('kc', id).meta.title).toBe('T2');
    // versions ring holds the prior xml
    const versions = s.listVersions('kc', id);
    expect(versions.length).toBe(1);
  });
  it('rejects a stale-revision save as a conflict without writing', () => {
    const s = store();
    const { id } = s.create('kc', { title: 'T', musicxml: XML });
    s.save('kc', id, { musicxml: XML + '<!--v2-->', meta: {}, revision: 1 }); // now rev 2
    const r = s.save('kc', id, { musicxml: XML + '<!--stale-->', meta: {}, revision: 1 });
    expect(r.conflict).toBe(true);
    expect(s.get('kc', id).meta.revision).toBe(2); // unchanged
  });
  it('lists shared songs across users when meta.share is true', () => {
    const s = store();
    const a = s.create('kc', { title: 'Shared', musicxml: XML, meta: { share: true } });
    s.create('soren', { title: 'Private', musicxml: XML });
    const shared = s.listShared();
    expect(shared.map(x => x.id)).toEqual([a.id]);
  });
  it('rejects a path-traversal id in listVersions (does not leak files outside the composer dir)', () => {
    const s = store();
    // Seed a blob at the exact path a '../../../etc' id would resolve to
    // (path.join('/data/users/kc/apps/piano/composer', '../../../etc.versions')
    // === '/data/users/kc/etc.versions') — outside the composer sandbox.
    blobs['/data/users/kc/etc.versions/1.musicxml'] = 'leaked';
    expect(s.listVersions('kc', '../../../etc')).toEqual([]);
  });
  it('remove deletes both meta and blob', () => {
    const s = store();
    const { id } = s.create('kc', { title: 'T', musicxml: XML });
    expect(s.get('kc', id)).not.toBeNull();
    expect(s.remove('kc', id)).toBe(true);
    expect(s.get('kc', id)).toBeNull();
  });
});
