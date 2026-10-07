import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import express from 'express';
import request from 'supertest';
import {
  createMediaHouseholdFixture, createAllowlistedCatalog, expandSeedTokens, seedAllowlist, HOUSEHOLD_SEED_IDS as ID,
} from './media-household-fixture.mjs';
import { createMediaHouseFixture } from './media-house-fixture.mjs';

const SEASON = [ID.HOSPITAL, ID.KEEPY];
const ITEMS = {
  [ID.ARRIVAL]: { title: 'Arrival', type: 'movie' },
  [ID.DISCLOSURE]: { title: 'Disclosure Day', type: 'movie' },
  [ID.FAITH]: { title: 'Faith', type: 'track' },
  [ID.HOSPITAL]: { title: 'Hospital', type: 'episode', parentId: '59494', grandparentId: '59493', grandparentTitle: 'Bluey (2018)' },
  [ID.KEEPY]: { title: 'Keepy Uppy', type: 'episode', parentId: '59494', grandparentId: '59493', grandparentTitle: 'Bluey (2018)' },
  [ID.COUNTDOWN]: { title: 'Countdown', type: 'episode' },
  [ID.RED_COAST]: { title: 'Red Coast', type: 'episode' },
  [ID.ANATOMY]: { title: 'Anatomy of a Fall', type: 'movie' },
  [ID.MARIO_KART]: { title: 'Mario Kart Arcade GP', type: 'episode' },
  [ID.BLUEY]: { title: 'Bluey (2018)', type: 'show' },
};
const asked = [];
// A stand-in for the real catalog gateway (the live server passes the real one).
const stubGateway = {
  resolveSource: (source, localId) => ({ source, localId }),
  progressNamespace: async () => 'plex/seed',
  getItem: async (_r, ref) => {
    asked.push(ref);
    const item = ITEMS[ref.includes(':') ? ref : `plex:${ref}`];
    return item ? { id: ref, title: item.title, thumbnail: `/thumb/${ref}`, metadata: { ...item } } : null;
  },
  getList: async (_r, ref) => (String(ref) === '59494' ? SEASON.map((id) => ({ id })) : []),
};
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const fixtures = [];
function make(over = {}) {
  const f = createMediaHouseholdFixture({ catalog: createAllowlistedCatalog(stubGateway, seedAllowlist()), logger: quiet, ...over });
  fixtures.push(f);
  return f;
}
afterEach(() => { while (fixtures.length) fixtures.pop().cleanup(); });
const get = (f, p) => request(f.app).get(p);

describe('seed tokens', () => {
  it('expands local and ISO relative instants against now', () => {
    const now = Date.parse('2026-10-07T12:00:00Z');
    expect(expandSeedTokens('${iso:1,-5}', now)).toBe('2026-10-06T11:55:00.000Z');
    expect(expandSeedTokens('x ${local:0,0} y', now)).toMatch(/^x \d{4}-\d\d-\d\d \d\d:\d\d:\d\d y$/);
  });
});

describe('seeded household (real services over a temp data dir)', () => {
  it('cleans its temporary directory up and never uses the household data volume', () => {
    const f = make();
    expect(f.dataDir).toMatch(/daylight-media-household-/);
    expect(fs.existsSync(f.dataDir)).toBe(true);
    f.cleanup();
    expect(fs.existsSync(f.dataDir)).toBe(false);
  });

  it('carry on: unfinished thresholds fall on the right side, two spots differ, legacy is hidden by removal', async () => {
    const f = make();
    const { body } = await get(f, '/household/carry-on').expect(200);
    const byId = Object.fromEntries(body.items.map((i) => [i.contentId, i]));
    expect(byId[ID.ARRIVAL]).toMatchObject({ reason: 'unfinished', percent: 26 });
    expect(byId[ID.COUNTDOWN]).toBeTruthy();            // 200 s but 6 %  -> open by percent
    expect(byId[ID.RED_COAST]).toBeUndefined();         // 170 s and 4 %  -> not unfinished
    expect(byId[ID.ANATOMY]).toBeUndefined();           // open by seconds, but removed
    expect(byId[ID.FAITH]).toBeUndefined();             // finished
    expect(byId[ID.HOSPITAL]).toBeUndefined();          // finished (91 %)
    const disclosure = byId[ID.DISCLOSURE];
    expect(disclosure.spots.map((s) => [s.deviceId, s.percent]).sort()).toEqual([['browser:kidtablet', 8], ['fleet:acceptance-media', 54]]);
    expect(byId[ID.KEEPY]).toMatchObject({ reason: 'next-episode', after: ID.HOSPITAL, grandparentId: '59493' });
  });

  it('restoring the removed item reveals its legacy spot; removing it again hides it', async () => {
    const f = make();
    await request(f.app).delete(`/household/removed?id=${encodeURIComponent(ID.ANATOMY)}`).expect(200);
    const { body } = await get(f, '/household/carry-on').expect(200);
    const item = body.items.find((i) => i.contentId === ID.ANATOMY);
    expect(item).toBeTruthy();
    expect(item.spots.map((s) => s.deviceId)).toEqual(['legacy']);
    await request(f.app).post('/household/removed').send({ id: ID.ANATOMY }).expect(200);
    expect((await get(f, '/household/carry-on')).body.items.map((i) => i.contentId)).not.toContain(ID.ANATOMY);
  });

  it('favourites hold a collection and an item; writes land in the temp dir and reset restores the seed', async () => {
    const f = make();
    expect((await get(f, '/household/favourites')).body.items.map((i) => [i.id, i.kind])).toEqual([[ID.BLUEY, 'collection'], [ID.RED_COAST, 'item']]);
    await request(f.app).post('/household/favourites').send({ id: ID.ARRIVAL, kind: 'item', title: 'Arrival', type: 'movie' }).expect(200);
    expect(fs.readFileSync(`${f.dataDir}/household/media/favourites.yml`, 'utf8')).toContain(ID.ARRIVAL);
    f.reset();
    expect((await get(f, '/household/favourites')).body.items.map((i) => i.id)).toEqual([ID.BLUEY, ID.RED_COAST]);
  });

  it('mark watched writes the watched state to the temp progress file only', async () => {
    const f = make();
    await request(f.app).post('/household/watched').send({ contentId: ID.ARRIVAL, watched: true }).expect(200);
    const carry = (await get(f, '/household/carry-on')).body.items.map((i) => i.contentId);
    expect(carry).not.toContain(ID.ARRIVAL);
    expect(fs.readFileSync(`${f.dataDir}/household/history/media_memory/plex/seed.yml`, 'utf8')).toMatch(/percent: 100/);
  });

  it('recent lists plays from every screen, each with where it played', async () => {
    const f = make();
    const { body } = await get(f, '/household/recent?limit=20').expect(200);
    const byId = Object.fromEntries(body.items.map((i) => [i.contentId, i]));
    expect(byId[ID.FAITH].playedOn.deviceId).toBe('fleet:acceptance-media');
    expect(byId[ID.DISCLOSURE].playedOn.deviceId).toBe('browser:kidtablet');
    expect(body.items.map((i) => i.contentId)).not.toContain(ID.ANATOMY);
  });

  it('suggests rows in order for the screen: favourites, carry on, time of day (3+ days), new', async () => {
    const f = make();
    const house = createMediaHouseFixture({ deviceId: 'acceptance-media', name: 'Acceptance receiver', room: 'Virtual browser',
      deviceLiveness: { getLastSnapshot: () => null }, logger: quiet, household: f, registrySeed: f.seeded.registry, routineSnapshot: f.seeded.routines });
    const { body } = await request(house.app).get('/suggestions?deviceId=fleet:acceptance-media').expect(200);
    expect(body.rows.map((r) => r.id)).toEqual(['favourites', 'carry-on', 'time-of-day', 'new']);
    const tod = body.rows.find((r) => r.id === 'time-of-day').items;
    expect(tod.map((i) => i.id)).toEqual([ID.FAITH]);
    expect(tod[0].days).toBeGreaterThanOrEqual(3);
    expect(body.rows.find((r) => r.id === 'new').items.map((i) => i.id)).toEqual([ID.MARIO_KART]);
    const fav = body.rows.find((r) => r.id === 'favourites').items.find((i) => i.id === ID.BLUEY);
    expect(fav.continue).toMatchObject({ contentId: ID.KEEPY });
    // The removed item never appears anywhere.
    expect(JSON.stringify(body)).not.toContain(ID.ANATOMY);
  });

  it('played earlier names each start, newest first, with how it started', async () => {
    const f = make();
    const house = createMediaHouseFixture({ deviceId: 'acceptance-media', name: 'Acceptance receiver', room: 'Virtual browser',
      deviceLiveness: { getLastSnapshot: () => null }, logger: quiet, household: f, registrySeed: f.seeded.registry, routineSnapshot: f.seeded.routines });
    const { body } = await request(house.app).get('/screens/fleet%3Aacceptance-media/played-earlier').expect(200);
    expect(body.items[0]).toMatchObject({ contentId: ID.FAITH, title: 'Faith' });
    const hospital = body.items.find((i) => i.contentId === ID.HOSPITAL);
    expect(hospital.origin).toMatchObject({ kind: 'device', id: 'browser:kidtablet' });
  });

  it('keeps catalog lookups inside the allowlist', async () => {
    const f = make();
    asked.length = 0;
    const catalog = createAllowlistedCatalog(stubGateway, seedAllowlist());
    expect(await catalog.getItem({}, 'plex:999999')).toBeNull();
    expect(await catalog.getList({}, '12345')).toEqual([]);
    expect(asked).toEqual([]);
    expect(await catalog.getItem({}, ID.ARRIVAL)).toMatchObject({ title: 'Arrival' });
    f.cleanup();
  });
});

describe('empty household', () => {
  it('reset({ empty: true }) is a household that has played nothing: no recent, carry on, favourites, new; a normal reset brings the seed back', async () => {
    const f = make();
    f.reset({ empty: true });
    expect((await get(f, '/household/recent')).body.items).toEqual([]);
    expect((await get(f, '/household/carry-on')).body.items).toEqual([]);
    expect((await get(f, '/household/favourites')).body.items).toEqual([]);
    expect(f.seeded.recentAdditions).toEqual([]);
    f.reset();
    expect((await get(f, '/household/favourites')).body.items.length).toBe(2);
    expect((await get(f, '/household/recent?limit=20')).body.items.length).toBeGreaterThan(3);
  });
});

describe('now on another screen', () => {
  const playing = (lastSeenAt) => ({
    knownDeviceIds: () => ['acceptance-media'],
    getLastSnapshot: () => ({ online: true, lastSeenAt: new Date(lastSeenAt).toISOString(), snapshot: { state: 'playing', currentItem: { contentId: ID.ARRIVAL }, position: 12 } }),
  });

  it('reports an item playing on a screen as nowOn, and leaves it out of carry on', async () => {
    const f = make({ livenessService: playing(Date.now() + 60_000) });
    const { body } = await get(f, '/household/carry-on').expect(200);
    expect(body.nowOn.map((n) => n.contentId)).toEqual([ID.ARRIVAL]);
    expect(body.items.map((i) => i.contentId)).not.toContain(ID.ARRIVAL);
  });

  it('ignores what a previous journey left playing before the last reset', async () => {
    const f = make({ livenessService: playing(Date.now() - 30_000) });
    expect((await get(f, '/household/carry-on')).body.nowOn).toEqual([]);
    expect((await get(f, '/household/carry-on')).body.items.map((i) => i.contentId)).toContain(ID.ARRIVAL);
  });
});

describe('seeded screens and routines', () => {
  it('lists the kid tablet as a screen and the 45-day-silent one under not seen lately', async () => {
    const f = make();
    const house = createMediaHouseFixture({ deviceId: 'acceptance-media', name: 'Acceptance receiver', room: 'Virtual browser',
      deviceLiveness: { getLastSnapshot: () => null }, logger: quiet, household: f, registrySeed: f.seeded.registry, routineSnapshot: f.seeded.routines });
    const { body } = await request(house.app).get('/screens').expect(200);
    expect(body.screens.map((s) => s.id)).toEqual(expect.arrayContaining(['fleet:acceptance-media', 'browser:kidtablet']));
    expect(body.notSeenLately.map((s) => [s.id, s.name])).toEqual([['browser:oldtablet', 'Old tablet']]);
  });
});
