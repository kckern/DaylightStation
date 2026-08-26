import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetRecentCourseActivity } from './GetRecentCourseActivity.mjs';

let PIANO_CFG;
const basePianoCfg = () => ({ videos: { collections: [
  { label: 'Piano Lessons', plex: ['plex:100'] },
  { label: 'Voice Lessons', shows: ['plex:30'] },
  { label: 'Music Appreciation', plex: ['plex:200'] },
] } });

function makeDeps({ summaries, itemCounts = {} }) {
  PIANO_CFG = basePianoCfg();
  // summaries: { [userId]: { [showId]: { completed, total, lastPlayedAt } } }
  return {
    configService: {
      getHouseholdAppConfig: () => PIANO_CFG,
      getHouseholdUsers: () => ['kc', 'learner2'],
      getUserProfile: (id) => ({ display_name: id.toUpperCase() }),
    },
    plexClient: {
      children: async (key) => (String(key) === '100'
        ? [{ ratingKey: '10', title: 'Course A', thumb: '/img/a' }, { ratingKey: '11', title: 'Course B', thumb: '/img/b' }]
        : [{ ratingKey: '20', title: 'Appreciation X', thumb: '/img/x' }]),
      metadata: async (key) => ({ ratingKey: String(key), title: `Standalone ${key}`, thumb: `/img/${key}` }),
    },
    fitnessPlayableService: {
      getPlayableEpisodes: async (id) => ({
        info: {},
        items: Array.from({ length: itemCounts[id] ?? 2 }, (_, i) => ({ plex: `${id}-e${i + 1}` })),
      }),
    },
    userVideoProgressStore: {
      progressFileMtime: () => 1,
      // Flat (single-unit) shows: the summary {completed, total, lastPlayedAt}
      // maps to per-item enrichment — first `completed` items watched, newest
      // activity stamped on the first item.
      enrich: (items, userId) => {
        const showId = String(items[0].plex).split('-')[0];
        const s = summaries[userId]?.[showId];
        if (!s || !s.lastPlayedAt) return items;
        return items.map((it, i) => ({
          ...it,
          userWatched: i < s.completed,
          userLastPlayedAt: i === 0 ? s.lastPlayedAt : null,
        }));
      },
    },
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
  };
}

test('default slot: incomplete courses by highest percent, 100% courses dropped', async () => {
  const uc = new GetRecentCourseActivity(makeDeps({ summaries: {
    'learner2': {
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
  const learnerTwo = players[1];
  assert.equal(learnerTwo.courses.length, 1);                        // completed course dropped
  assert.equal(learnerTwo.courses[0].courseId, 'plex:10');
  assert.equal(learnerTwo.courses[0].percent, 50);
  assert.equal(learnerTwo.lastPlayedAt, '2026-07-25T00:00:00Z');     // recency still counts the 100% course
});

test('default slot ranks by percent (highest first), not recency', async () => {
  const deps = makeDeps({
    summaries: {
      kc: {
        10: { completed: 1, lastPlayedAt: '2026-07-26T00:00:00Z' }, // 1/10 = 10%, newest
        11: { completed: 8, lastPlayedAt: '2026-07-20T00:00:00Z' }, // 8/10 = 80%, older
      },
    },
    itemCounts: { 10: 10, 11: 10 },
  });
  const uc = new GetRecentCourseActivity(deps);
  const { players } = await uc.execute();
  assert.deepEqual(players[0].courses.map((c) => c.courseId), ['plex:11', 'plex:10']);
  assert.equal(players[0].courses[0].percent, 80);
});

test('percent_mode current-module reflects the current unit, not the whole program', async () => {
  const deps = makeDeps({ summaries: {} });
  PIANO_CFG.menu_activity = { percent_mode: 'current-module' };
  // One show, two 2-lecture units; kc finished unit s1 and is 1-of-2 into s2
  // (course-wide that is 3/4 = 75%; the card must say 50% — the current module).
  // parentId nests under item.metadata — the playable SERVICE shape (the HTTP
  // router flattens it; the use case consumes the service directly).
  deps.fitnessPlayableService.getPlayableEpisodes = async () => ({ info: {}, items: [
    { plex: 'e1', metadata: { parentId: 's1' } }, { plex: 'e2', metadata: { parentId: 's1' } },
    { plex: 'e3', metadata: { parentId: 's2' } }, { plex: 'e4', metadata: { parentId: 's2' } },
  ] });
  deps.userVideoProgressStore.enrich = (items, userId) => (userId !== 'kc' ? items : items.map((it) => ({
    ...it,
    userWatched: ['e1', 'e2', 'e3'].includes(it.plex),
    userLastPlayedAt: it.plex === 'e3' ? '2026-07-26T00:00:00Z'
      : (it.plex === 'e1' ? '2026-07-01T00:00:00Z' : null),
  })));
  const uc = new GetRecentCourseActivity(deps);
  const { players } = await uc.execute();
  const c = players[0].courses[0];
  assert.equal(c.completed, 1);           // current module s2: 1 of 2
  assert.equal(c.total, 2);
  assert.equal(c.percent, 50);            // NOT 75 course-wide
  assert.equal(c.courseCompleted, false); // course-level flag stays whole-course
});

test('menu_activity.slots config overrides the default (recent-courses)', async () => {
  const deps = makeDeps({ summaries: {
    'learner2': {
      10: { completed: 1, total: 2, lastPlayedAt: '2026-07-20T00:00:00Z' },
      11: { completed: 2, total: 2, lastPlayedAt: '2026-07-25T00:00:00Z' },
    },
  } });
  PIANO_CFG.menu_activity = { slots: ['recent-courses'] };
  const uc = new GetRecentCourseActivity(deps);
  const { players } = await uc.execute();
  const learnerTwo = players[0];
  assert.equal(learnerTwo.courses.length, 2);                        // 100% course included
  assert.equal(learnerTwo.courses[0].courseId, 'plex:11');           // newest first
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

// learner3 shape: intro unit s1 (single lecture, DONE, most recent play) while
// unit s2 sits at 5/8.
function learnerThreeDeps() {
  const deps = makeDeps({ summaries: {} });
  deps.fitnessPlayableService.getPlayableEpisodes = async () => ({ info: {}, items: [
    { plex: 'intro', metadata: { parentId: 's1' } },
    ...Array.from({ length: 8 }, (_, i) => ({ plex: `m${i + 1}`, metadata: { parentId: 's2' } })),
  ] });
  deps.userVideoProgressStore.enrich = (items, userId) => (userId !== 'learner3' ? items : items.map((it) => ({
    ...it,
    userWatched: it.plex === 'intro' || ['m1', 'm2', 'm3', 'm4', 'm5'].includes(it.plex),
    userLastPlayedAt: it.plex === 'intro' ? '2026-07-27T00:00:00Z'
      : (it.plex === 'm5' ? '2026-07-21T00:00:00Z' : null),
  })));
  deps.configService.getHouseholdUsers = () => ['learner3'];
  return deps;
}

test('current-module mode: a finished one-off unit played last does not carry the day', async () => {
  const deps = learnerThreeDeps();
  PIANO_CFG.menu_activity = { percent_mode: 'current-module' };
  const uc = new GetRecentCourseActivity(deps);
  const { players } = await uc.execute();
  const c = players[0].courses[0];
  assert.equal(c.completed, 5);
  assert.equal(c.total, 8);
  assert.equal(c.percent, 63);
  assert.equal(players[0].lastPlayedAt, '2026-07-27T00:00:00Z'); // recency still the intro play
});

test('default season-weighted: each unit is an equal slice, episodes interpolate within', async () => {
  const uc = new GetRecentCourseActivity(learnerThreeDeps());
  const { players } = await uc.execute();
  const c = players[0].courses[0];
  // (s1 done = 1.0) + (s2 at 5/8 = 0.625) over 2 units → 81%
  assert.equal(c.percent, 81);
  assert.equal(c.completed, 6);  // tooltip counts are whole-course
  assert.equal(c.total, 9);
  assert.deepEqual(c.units, ['done', 'active']); // per-season dots
});

test('single-season courses emit per-EPISODE dots (done/active/todo)', async () => {
  const deps = makeDeps({ summaries: {} });
  deps.fitnessPlayableService.getPlayableEpisodes = async () => ({ info: {}, items: [
    { plex: 'e1', metadata: { parentId: 's1' } },
    { plex: 'e2', metadata: { parentId: 's1' } },
    { plex: 'e3', metadata: { parentId: 's1' } },
    { plex: 'e4', metadata: { parentId: 's1' } },
  ] });
  deps.userVideoProgressStore.enrich = (items, userId) => (userId !== 'kc' ? items : items.map((it) => ({
    ...it,
    userWatched: it.plex === 'e1',
    userPercent: it.plex === 'e2' ? 40 : null,
    userLastPlayedAt: it.plex === 'e2' ? '2026-07-26T00:00:00Z' : (it.plex === 'e1' ? '2026-07-20T00:00:00Z' : null),
  })));
  const uc = new GetRecentCourseActivity(deps);
  const { players } = await uc.execute();
  assert.deepEqual(players[0].courses[0].units, ['done', 'active', 'todo', 'todo']);
});

test('percent_mode course: plain completed/total across every lecture', async () => {
  const deps = learnerThreeDeps();
  PIANO_CFG.menu_activity = { percent_mode: 'course' };
  const uc = new GetRecentCourseActivity(deps);
  const { players } = await uc.execute();
  const c = players[0].courses[0];
  assert.equal(c.completed, 6);
  assert.equal(c.total, 9);
  assert.equal(c.percent, 67);
});

test('caps each player at 2 course thumbnails (equal percents break ties by recency)', async () => {
  const deps = makeDeps({ summaries: {
    kc: {
      10: { completed: 1, total: 2, lastPlayedAt: '2026-07-21T00:00:00Z' },
      11: { completed: 1, total: 2, lastPlayedAt: '2026-07-22T00:00:00Z' },
      12: { completed: 1, total: 2, lastPlayedAt: '2026-07-23T00:00:00Z' },
      13: { completed: 1, total: 2, lastPlayedAt: '2026-07-24T00:00:00Z' }, // newest
      14: { completed: 1, total: 2, lastPlayedAt: '2026-07-20T00:00:00Z' }, // oldest — dropped
    },
  } });
  deps.plexClient.children = async (key) => (String(key) === '100'
    ? ['10', '11', '12', '13', '14'].map((k) => ({ ratingKey: k, title: `Course ${k}`, thumb: `/img/${k}` }))
    : []);
  const uc = new GetRecentCourseActivity(deps);
  const { players } = await uc.execute();
  assert.equal(players[0].courses.length, 2);
  assert.deepEqual(players[0].courses.map((c) => c.courseId), ['plex:13', 'plex:12']);
});

test('voice-lesson shows outside any collection join the scope via metadata()', async () => {
  const uc = new GetRecentCourseActivity(makeDeps({
    summaries: { kc: { 30: { completed: 1, lastPlayedAt: '2026-07-26T00:00:00Z' } } },
  }));
  const { players } = await uc.execute();
  assert.equal(players.length, 1);
  assert.equal(players[0].courses[0].courseId, 'plex:30');
  assert.equal(players[0].courses[0].courseTitle, 'Standalone 30'); // from metadata()
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
