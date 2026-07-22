/**
 * Characterization test for the course-progress grading/ranking algorithm
 * (Task P2.6). Pins the exact ranked/capped roster output the piano
 * /courses/progress handler produced BEFORE it was extracted into
 * GetCourseProgress — recency filter, min-completed filter, reference-unit
 * exclusion from totals, tie-break-by-recency ordering, and max-avatars cap.
 *
 * Expected values are derived by reading the original router body
 * (piano.mjs GET /courses/progress) and the pure courseProgress helpers.
 */
import { describe, it, expect } from 'vitest';
import { GetCourseProgress } from '../../../../backend/src/3_applications/piano/usecases/GetCourseProgress.mjs';

const noop = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const DAY = 24 * 60 * 60 * 1000;
const recentA = iso(1 * DAY);   // most recent
const recentB = iso(2 * DAY);   // recent, older than A
const stale = iso(30 * DAY);    // outside the 7-day window

// The roster now comes from the HOUSEHOLD, not from piano.yml — one ordered
// list that every picker and overlay in the house shares. Piano restating it
// as `users.primary` was the second source of truth that let School drift.
const householdUsers = ['alice', 'bob', 'carol'];

const pianoConfig = {
  videos: {
    sequential_labels: ['Sequential'],
    progress_overlay: { recency_days: 7, min_completed: 1, max_avatars: 2 },
    reference_units: [{ courseId: 'plex:100', unitIds: ['ref-unit'] }],
  },
};

const profiles = {
  alice: { name: 'Alice' },
  bob: { name: 'Bob' },
  carol: { name: 'Carol' },
};

const configService = {
  getHouseholdAppConfig: () => pianoConfig,
  getHouseholdUsers: () => householdUsers,
  getUserProfile: (id) => profiles[id] || null,
};

// Playable fixtures keyed by the BARE rating key (plex: prefix stripped).
const playableByKey = {
  100: {
    info: { labels: ['Sequential'] },
    items: [
      { plex: 'e1', parentId: 'u1' },
      { plex: 'e2', parentId: 'u1' },
      { plex: 'e3', parentId: 'ref-unit' }, // excluded by reference_units → total 2
    ],
  },
  200: {
    info: { labels: ['Other'] },            // not sequential → users []
    items: [{ plex: 'x1', parentId: 'x' }],
  },
};

const fitnessPlayableService = {
  async getPlayableEpisodes(bareKey) {
    if (bareKey === 'err') throw new Error('boom');
    return playableByKey[bareKey];
  },
};

// summarize() fixture: per-course-item aggregation per user.
const summaries = {
  alice: { completed: 2, lastPlayedAt: recentA },
  bob: { completed: 2, lastPlayedAt: recentB },
  carol: { completed: 1, lastPlayedAt: stale }, // recent-filtered out
};
const userVideoProgressStore = {
  summarize: (items, userId) => ({ ...summaries[userId], total: items.length }),
};

const makeUseCase = () => new GetCourseProgress({
  fitnessPlayableService,
  userVideoProgressStore,
  configService,
  logger: noop,
});

describe('GetCourseProgress (characterization)', () => {
  it('returns empty courses for no ids', async () => {
    const { courses } = await makeUseCase().execute({ ids: [] });
    expect(courses).toEqual({});
  });

  it('ranks recent+sufficient users, caps to max_avatars, excludes reference units from total', async () => {
    const { courses } = await makeUseCase().execute({ ids: ['plex:100'] });
    expect(courses['plex:100']).toEqual({
      isSequential: true,
      total: 2, // ref-unit item excluded
      users: [
        { id: 'alice', name: 'Alice', completed: 2, total: 2, lastPlayedAt: recentA },
        { id: 'bob', name: 'Bob', completed: 2, total: 2, lastPlayedAt: recentB },
      ], // carol dropped (stale); tie on completed=2 → alice first (more recent)
    });
  });

  it('non-sequential course yields no users but keeps total', async () => {
    const { courses } = await makeUseCase().execute({ ids: ['plex:200'] });
    expect(courses['plex:200']).toEqual({ isSequential: false, total: 1, users: [] });
  });

  it('a fetch error skips the course entirely (continue)', async () => {
    const { courses } = await makeUseCase().execute({ ids: ['plex:err', 'plex:200'] });
    expect(courses['plex:err']).toBeUndefined();
    expect(courses['plex:200']).toBeDefined();
  });
});
