import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetRecentCourseActivity } from './GetRecentCourseActivity.mjs';

const PIANO_CFG = { videos: { collections: [
  { label: 'Music Lessons', plex: ['plex:100'] },
  { label: 'Music Appreciation', plex: ['plex:200'] },
] } };

function makeDeps({ summaries }) {
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

test('picks each user newest lesson course, sorted most recent first, skipping no-history users', async () => {
  const uc = new GetRecentCourseActivity(makeDeps({ summaries: {
    felix: {
      10: { completed: 1, total: 2, lastPlayedAt: '2026-07-20T00:00:00Z' },
      11: { completed: 2, total: 2, lastPlayedAt: '2026-07-25T00:00:00Z' },
    },
    kc: { 10: { completed: 1, total: 2, lastPlayedAt: '2026-07-26T00:00:00Z' } },
  } }));
  const { players } = await uc.execute();
  assert.equal(players.length, 2);
  assert.equal(players[0].userId, 'kc');                    // newest first
  assert.equal(players[1].courseId, 'plex:11');             // felix's newest course
  assert.equal(players[1].courseTitle, 'Course B');
  assert.equal(players[1].completed, 2);
  assert.equal(players[1].percent, 100);
  assert.equal(players[0].name, 'KC');                      // display_name resolution
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
