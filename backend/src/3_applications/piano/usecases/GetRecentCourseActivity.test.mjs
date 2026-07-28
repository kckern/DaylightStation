import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetRecentCourseActivity } from './GetRecentCourseActivity.mjs';

let PIANO_CFG;
const basePianoCfg = () => ({ videos: { collections: [
  { label: 'Music Lessons', plex: ['plex:100'] },
  { label: 'Music Appreciation', plex: ['plex:200'] },
] } });

function makeDeps({ summaries }) {
  PIANO_CFG = basePianoCfg();
  // summaries: { [userId]: { [showId]: { completed, total, lastPlayedAt } } }
  return {
    configService: {
      getHouseholdAppConfig: () => PIANO_CFG,
      getHouseholdUsers: () => ['kc', 'felix'],
      getUserProfile: (id) => ({ display_name: id.toUpperCase() }),
    },
    plexClient: {
      children: async (key) => (String(key) === '100'
        ? [{ ratingKey: '10', title: 'Course A', thumb: '/img/a' }, { ratingKey: '11', title: 'Course B', thumb: '/img/b' }]
        : [{ ratingKey: '20', title: 'Appreciation X', thumb: '/img/x' }]),
    },
    fitnessPlayableService: {
      getPlayableEpisodes: async (id) => ({ info: {}, items: [{ plex: `${id}-e1` }, { plex: `${id}-e2` }] }),
    },
    userVideoProgressStore: {
      progressFileMtime: () => 1,
      summarize: (items, userId) => {
        const showId = String(items[0].plex).split('-')[0];
        return summaries[userId]?.[showId] || { completed: 0, total: items.length, lastPlayedAt: null };
      },
    },
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
  };
}

test('default slot: incomplete courses by highest percent, 100% courses dropped', async () => {
  const uc = new GetRecentCourseActivity(makeDeps({ summaries: {
    felix: {
      10: { completed: 1, total: 2, lastPlayedAt: '2026-07-20T00:00:00Z' },  // 50%
      11: { completed: 2, total: 2, lastPlayedAt: '2026-07-25T00:00:00Z' },  // 100% — excluded
    },
    kc: { 10: { completed: 1, total: 2, lastPlayedAt: '2026-07-26T00:00:00Z' } },
  } }));
  const { players } = await uc.execute();
  assert.equal(players.length, 2);
  assert.equal(players[0].userId, 'kc');                        // newest player first
  assert.equal(players[0].name, 'KC');                          // display_name resolution
  assert.equal(players[0].lastPlayedAt, '2026-07-26T00:00:00Z');
  const felix = players[1];
  assert.equal(felix.courses.length, 1);                        // completed course dropped
  assert.equal(felix.courses[0].courseId, 'plex:10');
  assert.equal(felix.courses[0].percent, 50);
  assert.equal(felix.lastPlayedAt, '2026-07-25T00:00:00Z');     // recency still counts the 100% course
});

test('default slot ranks by percent (highest first), not recency', async () => {
  const deps = makeDeps({ summaries: {
    kc: {
      10: { completed: 1, total: 10, lastPlayedAt: '2026-07-26T00:00:00Z' }, // 10%, newest
      11: { completed: 8, total: 10, lastPlayedAt: '2026-07-20T00:00:00Z' }, // 80%, older
    },
  } });
  const uc = new GetRecentCourseActivity(deps);
  const { players } = await uc.execute();
  assert.deepEqual(players[0].courses.map((c) => c.courseId), ['plex:11', 'plex:10']);
});

test('menu_activity.slots config overrides the default (recent-courses)', async () => {
  const deps = makeDeps({ summaries: {
    felix: {
      10: { completed: 1, total: 2, lastPlayedAt: '2026-07-20T00:00:00Z' },
      11: { completed: 2, total: 2, lastPlayedAt: '2026-07-25T00:00:00Z' },
    },
  } });
  PIANO_CFG.menu_activity = { slots: ['recent-courses'] };
  const uc = new GetRecentCourseActivity(deps);
  const { players } = await uc.execute();
  const felix = players[0];
  assert.equal(felix.courses.length, 2);                        // 100% course included
  assert.equal(felix.courses[0].courseId, 'plex:11');           // newest first
});

test('placeholder and unknown slots contribute nothing without crashing', async () => {
  const deps = makeDeps({ summaries: {
    kc: { 10: { completed: 1, total: 2, lastPlayedAt: '2026-07-26T00:00:00Z' } },
  } });
  PIANO_CFG.menu_activity = { slots: ['recent-sheet-music', 'top-polish', 'nonsense', 'top-incomplete-courses'] };
  const uc = new GetRecentCourseActivity(deps);
  const { players } = await uc.execute();
  assert.equal(players[0].courses.length, 1);                   // only the real slot filled
  assert.equal(players[0].courses[0].courseId, 'plex:10');
});

test('a player with only completed courses falls back to recent courses (their trophy)', async () => {
  const deps = makeDeps({ summaries: {
    kc: { 10: { completed: 2, total: 2, lastPlayedAt: '2026-07-26T00:00:00Z' } }, // 100%
  } });
  const uc = new GetRecentCourseActivity(deps);
  const { players } = await uc.execute();
  assert.equal(players.length, 1);
  assert.equal(players[0].courses.length, 1);
  assert.equal(players[0].courses[0].percent, 100);
});

test('duplicate rows from the raw children container collapse to one course', async () => {
  const deps = makeDeps({ summaries: {
    kc: { 10: { completed: 1, total: 2, lastPlayedAt: '2026-07-26T00:00:00Z' } },
  } });
  // Mirror the live Plex quirk: the raw /children response lists the show twice.
  deps.plexClient.children = async (key) => (String(key) === '100'
    ? [
      { ratingKey: '10', title: 'Course A', thumb: '/img/a' },
      { ratingKey: '10', title: 'Course A', thumb: '/img/a' },
    ]
    : []);
  const uc = new GetRecentCourseActivity(deps);
  const { players } = await uc.execute();
  assert.equal(players[0].courses.length, 1);
  assert.equal(players[0].courses[0].courseId, 'plex:10');
});

test('caps each player at 4 course thumbnails, most recent kept', async () => {
  const deps = makeDeps({ summaries: {
    kc: {
      10: { completed: 1, total: 2, lastPlayedAt: '2026-07-21T00:00:00Z' },
      11: { completed: 1, total: 2, lastPlayedAt: '2026-07-22T00:00:00Z' },
      12: { completed: 1, total: 2, lastPlayedAt: '2026-07-23T00:00:00Z' },
      13: { completed: 1, total: 2, lastPlayedAt: '2026-07-24T00:00:00Z' },
      14: { completed: 1, total: 2, lastPlayedAt: '2026-07-20T00:00:00Z' }, // oldest — dropped
    },
  } });
  deps.plexClient.children = async (key) => (String(key) === '100'
    ? ['10', '11', '12', '13', '14'].map((k) => ({ ratingKey: k, title: `Course ${k}`, thumb: `/img/${k}` }))
    : []);
  const uc = new GetRecentCourseActivity(deps);
  const { players } = await uc.execute();
  assert.equal(players[0].courses.length, 4);
  assert.deepEqual(players[0].courses.map((c) => c.courseId), ['plex:13', 'plex:12', 'plex:11', 'plex:10']);
});

test('appreciation collections are out of scope', async () => {
  const uc = new GetRecentCourseActivity(makeDeps({ summaries: {
    kc: { 20: { completed: 5, total: 2, lastPlayedAt: '2026-07-26T00:00:00Z' } },
  } }));
  const { players } = await uc.execute();
  assert.equal(players.length, 0); // show 20 is in the appreciation group
});

test('caches on unchanged progress mtimes, recomputes on change', async () => {
  const deps = makeDeps({ summaries: { kc: { 10: { completed: 1, total: 2, lastPlayedAt: '2026-07-26T00:00:00Z' } } } });
  let mtime = 1;
  deps.userVideoProgressStore.progressFileMtime = () => mtime;
  let childrenCalls = 0;
  const origChildren = deps.plexClient.children;
  deps.plexClient.children = async (k) => { childrenCalls += 1; return origChildren(k); };
  const uc = new GetRecentCourseActivity(deps);
  await uc.execute();
  const callsAfterFirst = childrenCalls;
  await uc.execute();
  assert.equal(childrenCalls, callsAfterFirst); // cache hit — no re-walk
  mtime = 2;
  await uc.execute();
  assert.ok(childrenCalls > callsAfterFirst);   // mtime change → recompute
});

test('a failed children() fetch degrades the result but does not poison the cache', async () => {
  const deps = makeDeps({ summaries: {
    kc: { 10: { completed: 1, total: 2, lastPlayedAt: '2026-07-26T00:00:00Z' } },
  } });
  // Fixed mtime — an unchanged key would normally serve the cached (possibly
  // stale) result, so this proves the skip: the second execute() must still
  // recompute even though nothing about the roster's mtimes changed.
  deps.userVideoProgressStore.progressFileMtime = () => 1;
  let childrenCalls = 0;
  deps.plexClient.children = async (key) => {
    childrenCalls += 1;
    if (childrenCalls === 1) throw new Error('Plex unreachable');
    return String(key) === '100'
      ? [{ ratingKey: '10', title: 'Course A', thumb: '/img/a' }, { ratingKey: '11', title: 'Course B', thumb: '/img/b' }]
      : [{ ratingKey: '20', title: 'Appreciation X', thumb: '/img/x' }];
  };
  const uc = new GetRecentCourseActivity(deps);

  const first = await uc.execute();
  assert.equal(first.players.length, 0); // degraded: no shows discovered, so no player has history

  const second = await uc.execute();
  // Only the in-scope collection ("plex:100", the first group) is ever queried
  // (see the "appreciation collections are out of scope" test above) — one
  // failed call on the first execute(), one successful call on the second.
  // If the degraded result had been cached, this second call would never
  // happen at all.
  assert.equal(childrenCalls, 2);
  assert.equal(second.players.length, 1); // players present once the fetch succeeds
  assert.equal(second.players[0].userId, 'kc');
});
