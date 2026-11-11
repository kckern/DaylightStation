import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { readEdlHeads, householdKeysIn, collectWorks, runMap, applyPlan, formatMapReport, guardMap, politeResolver } from './mapCommand.mjs';

let root; let media; let data;
const edl = (rk, workId, title, year, runtime = 6000) => writeFileSync(path.join(media, 'edl', `${rk}.edl.yml`),
  yaml.dump({ contentId: `plex:${rk}`, title, year, source: 'vidangel', sourceRef: { workId, slug: `s-${workId}`, tagSetId: 9 }, runtimeUnalteredSec: runtime, cues: [{ id: 'va1', type: 'skip' }] }));
const plexMovies = [
  { ratingKey: '702772', title: '12 Strong', year: 2018, runtimeSec: 7790 },
  { ratingKey: '54656', title: 'Godzilla', year: 1998, runtimeSec: 7980 },
  { ratingKey: '54657', title: 'Godzilla', year: 2014, runtimeSec: 7380 },
  { ratingKey: '55301', title: 'Cinderella', year: 1950, runtimeSec: 4440 },
  { ratingKey: '600', title: 'Vivo', year: 2021, runtimeSec: 6000 },
];
const catalog = [
  { id: 1, title: '12 Strong', type: 'movie', slug: 's-1', tagCount: 40 },
  { id: 2, title: 'Godzilla', type: 'movie', slug: 's-2', tagCount: 40 },
  { id: 3, title: 'Cinderella', type: 'movie', slug: 's-3', tagCount: 40 },
  { id: 4, title: 'Vivo', type: 'movie', slug: 's-4', tagCount: 10 },
  { id: 5, title: 'Unrelated', type: 'movie', slug: 's-5', tagCount: 10 },
];
const oldIndex = { map: {
  'plex:658287': { title: '12 Strong', plexType: 'movie', vidangel: { id: 1, slug: 's-1', tagCount: 40 } },
  'plex:54656': { title: 'Godzilla', plexType: 'movie', vidangel: { id: 2, slug: 's-2', tagCount: 40 } },
  'plex:54657': { title: 'Godzilla', plexType: 'movie', vidangel: { id: 2, slug: 's-2', tagCount: 40 } },
  'plex:55301': { title: 'Cinderella', plexType: 'movie', vidangel: { id: 3, slug: 's-3', tagCount: 40 } },
  'plex:77': { title: 'A Show', plexType: 'show', vidangel: { id: 9, slug: 'show', tagCount: 0 } },
} };

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'cfmap-'));
  media = path.join(root, 'media'); data = path.join(root, 'data');
  mkdirSync(path.join(media, 'edl'), { recursive: true });
  mkdirSync(path.join(data, 'overrides'), { recursive: true });
  edl('658287', 1, '12 Strong', 2018, 7793);
  edl('54656', 2, 'Godzilla', 1998);
  edl('54657', 2, 'Godzilla', 1998);
  edl('55301', 3, 'Cinderella', 2021);
  writeFileSync(path.join(media, 'plex-vidangel-map.yml'), yaml.dump(oldIndex));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const inputs = async (extra = {}) => ({
  catalog, edlHeads: readEdlHeads(path.join(media, 'edl')), oldIndex: yaml.load(readFileSync(path.join(media, 'plex-vidangel-map.yml'), 'utf8')),
  plexMovies, householdKeys: householdKeysIn(data, media), resolveYear: async (slug) => (slug === 's-4' ? 2021 : null), ...extra,
});

describe('readEdlHeads / householdKeysIn', () => {
  it('reads each EDL\'s work, title, year and runtime', () => {
    const heads = readEdlHeads(path.join(media, 'edl'));
    expect(heads.find((h) => h.ratingKey === '658287')).toMatchObject({ workId: 1, title: '12 Strong', year: 2018, runtimeSec: 7793, slug: 's-1' });
  });
  it('lists keys with household data, with what each holds (overrides, runs, reviews, history, transcripts)', () => {
    writeFileSync(path.join(data, 'overrides', '42.yml'), 'x: 1');
    writeFileSync(path.join(data, 'overrides', '42.yml.pre-rules'), 'x: 1');
    for (const d of ['jobs', 'review', 'review-history']) mkdirSync(path.join(data, d), { recursive: true });
    writeFileSync(path.join(data, 'jobs', '42.yml'), 'x: 1');
    writeFileSync(path.join(data, 'review', '43.refine.yml'), 'x: 1');
    writeFileSync(path.join(data, 'review-history', '44.yml'), 'x: 1');
    mkdirSync(path.join(media, 'refine', '45'), { recursive: true });
    const keys = householdKeysIn(data, media);
    expect(Object.fromEntries(keys)).toEqual({ 42: ['override', 'job'], 43: ['review'], 44: ['review history'], 45: ['transcripts'] });
  });
});

describe('collectWorks', () => {
  it('years come from EDLs, else the old index, else the resolver (only for works with a Plex title)', async () => {
    const asked = [];
    const works = await collectWorks({ ...(await inputs()), resolveYear: async (slug) => { asked.push(slug); return 2021; } });
    expect(works.find((w) => w.workId === 2)).toMatchObject({ year: 1998, edlKeys: ['54656', '54657'] });
    expect(works.find((w) => w.workId === 4)).toMatchObject({ year: 2021, edlKeys: [] });
    expect(asked).toEqual(['s-4']);
    expect(works.find((w) => w.workId === 5)).toBeUndefined();
  });
});

describe('runMap --dry-run', () => {
  it('plans without writing anything, and reports the library films\' fate', async () => {
    const before = readdirSync(path.join(media, 'edl')).sort();
    const mtime = statSync(path.join(media, 'plex-vidangel-map.yml')).mtimeMs;
    const r = await runMap(await inputs());
    expect(readdirSync(path.join(media, 'edl')).sort()).toEqual(before);
    expect(statSync(path.join(media, 'plex-vidangel-map.yml')).mtimeMs).toBe(mtime);
    expect(r.plan.rekeys).toEqual([{ workId: 1, title: '12 Strong', from: '658287', to: '702772' }]);
    expect(Object.keys(r.doc.map).sort()).toEqual(['plex:54656', 'plex:600', 'plex:702772', 'plex:77']);
    expect(r.doc.unmatched['plex:55301']).toMatchObject({ reason: 'year-mismatch', plexYears: [1950] });
    expect(r.library.before).toBe(4);
    expect(r.library.fate).toMatchObject({ verified: 1, rekeyed: 1, duplicate: 1, unmatched: 1 });
    expect(r.library.after).toMatchObject({ total: 3, verified: 2, unmatched: 1 }); // Vivo is mapped but has no EDL: not a library film
    const text = formatMapReport(r);
    expect(text).toMatch(/re-key 658287 -> 702772  12 Strong/);
    expect(text).toMatch(/55301 Cinderella \(2021\): Plex has the 1950 film/);
    expect(r.plan.park.map((x) => [x.ratingKey, x.why])).toEqual([['54657', 'wrong-film'], ['55301', 'wrong-film']]);
    expect(text).toMatch(/park 54657 Godzilla: another film's live key/);
  });
  it('labels keys with household data that end up duplicate or unmatched, and never parks them', async () => {
    writeFileSync(path.join(data, 'overrides', '54657.yml'), 'x: 1');
    const r = await runMap(await inputs());
    expect(r.plan.park.map((x) => x.ratingKey)).toEqual(['55301']);
    expect(formatMapReport(r)).toMatch(/54657 Godzilla .*has household data: override/);
  });
});

describe('applyPlan', () => {
  it('moves the stale EDL to its new key (old file kept aside), writes the index, and a second run changes nothing', async () => {
    const mapPath = path.join(media, 'plex-vidangel-map.yml');
    const r = await runMap(await inputs());
    const out = applyPlan({ ...r, edlDir: path.join(media, 'edl'), mapPath });
    expect(out).toMatchObject({ wroteIndex: true, moved: 1, parked: 2 });
    expect(existsSync(path.join(media, 'edl', '54657.edl.yml'))).toBe(false);
    expect(existsSync(path.join(media, 'edl', '_rekeyed', '54657.edl.yml'))).toBe(true);
    const moved = yaml.load(readFileSync(path.join(media, 'edl', '702772.edl.yml'), 'utf8'));
    expect(moved.contentId).toBe('plex:702772');
    expect(moved.cues).toHaveLength(1);
    expect(existsSync(path.join(media, 'edl', '658287.edl.yml'))).toBe(false);
    expect(existsSync(path.join(media, 'edl', '_rekeyed', '658287.edl.yml'))).toBe(true);
    const written = yaml.load(readFileSync(mapPath, 'utf8'));
    expect(written.map['plex:702772']).toMatchObject({ year: 2018, runtimeSec: 7790, vidangel: { year: 2018, runtimeSec: 7793 } });

    const again = await runMap(await inputs());
    expect(again.plan.rekeys).toEqual([]);
    expect(again.plan.park).toEqual([]);
    expect(again.doc.unmatched['plex:55301']).toMatchObject({ reason: 'year-mismatch' }); // still listed from its parked EDL
    expect(applyPlan({ ...again, edlDir: path.join(media, 'edl'), mapPath })).toMatchObject({ wroteIndex: false, moved: 0, parked: 0 });
  });
  it('an interrupted re-key (new file written, old one still there) is finished by a re-run, never overwriting what was set aside', async () => {
    const mapPath = path.join(media, 'plex-vidangel-map.yml');
    applyPlan({ ...(await runMap(await inputs())), edlDir: path.join(media, 'edl'), mapPath });
    edl('658287', 1, '12 Strong', 2018, 7793); // the leftover source
    const r = await runMap(await inputs());
    expect(r.plan.park).toEqual([{ ratingKey: '658287', workId: 1, title: '12 Strong', why: 'stale-duplicate' }]);
    expect(applyPlan({ ...r, edlDir: path.join(media, 'edl'), mapPath })).toMatchObject({ moved: 0, parked: 1 });
    expect(existsSync(path.join(media, 'edl', '658287.edl.yml'))).toBe(false);
    expect(readdirSync(path.join(media, 'edl', '_rekeyed')).filter((n) => n.startsWith('658287')).sort()).toEqual(['658287.edl.yml', '658287.edl.yml.1']);
  });
  it('refuses to overwrite an existing EDL at the new key', async () => {
    const r = await runMap(await inputs());
    edl('702772', 99, 'Squatter', 2000);
    expect(() => applyPlan({ ...r, edlDir: path.join(media, 'edl'), mapPath: path.join(media, 'plex-vidangel-map.yml') })).toThrow(/already exists/);
  });
});

describe('guardMap', () => {
  const oldIndex = { map: Object.fromEntries([...Array(10)].map((_, i) => [`plex:${i}`, { plexType: 'movie', vidangel: { tagCount: 5 } }])) };
  it('refuses a Plex read with no movies, or one that would drop verified films by more than 20%', () => {
    expect(guardMap({ plexCount: 0, oldIndex, plan: { counts: { verified: 10 } } })).toMatch(/0 movies/);
    expect(guardMap({ plexCount: 50, oldIndex, plan: { counts: { verified: 7 } } })).toMatch(/7 .* 10/);
    expect(guardMap({ plexCount: 50, oldIndex, plan: { counts: { verified: 8 } } })).toBeNull();
    expect(guardMap({ plexCount: 0, oldIndex, plan: { counts: { verified: 0 } }, force: true })).toBeNull();
  });
});

describe('politeResolver', () => {
  it('pauses after every call, backs off after a failure and gives up after 3 tries', async () => {
    const waits = []; let calls = 0;
    const r = politeResolver(async () => { calls++; throw new Error('429'); }, { pauseMs: 400, tries: 3, sleep: async (ms) => { waits.push(ms); } });
    expect(await r('s')).toBeNull();
    expect(calls).toBe(3);
    expect(waits).toEqual([1000, 2000, 4000]);
    const ok = politeResolver(async () => 1999, { pauseMs: 400, sleep: async (ms) => { waits.push(ms); } });
    expect(await ok('s')).toBe(1999);
    expect(waits.at(-1)).toBe(400);
  });
});
