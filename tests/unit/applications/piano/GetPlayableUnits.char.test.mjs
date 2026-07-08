/**
 * Characterization test for the reference-unit matching + co-progress lock
 * algorithm (Task P2.6). Pins the exact locked/playable + aheadBy output the
 * piano /courses/:courseId/playable handler produced BEFORE it was extracted
 * into GetPlayableUnits — parent-link lift, reference-unit set (explicit id +
 * title pattern), per-item isReference flags, and the credited-count vs
 * rule.buffer co-progress lock.
 *
 * Expected values derived by reading the original router body (piano.mjs
 * GET /courses/:courseId/playable).
 */
import { describe, it, expect } from 'vitest';
import { GetPlayableUnits } from '../../../../backend/src/3_applications/piano/usecases/GetPlayableUnits.mjs';

const noop = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

const pianoConfig = {
  videos: {
    sequential_labels: ['Sequential'],
    reference_units: [{ courseId: 'plex:C', titlePatterns: ['practice'], unitIds: ['u-ref'] }],
    co_progress: [{ courseId: 'plex:C', users: ['alice', 'bob'], buffer: 2 }],
  },
};

const profiles = { alice: { name: 'Alice' }, bob: { name: 'Bob' } };
const configService = {
  getHouseholdAppConfig: () => pianoConfig,
  getUserProfile: (id) => profiles[id] || null,
};

const basePlayable = () => ({
  compoundId: 'plex:C',
  info: { labels: ['Sequential'] },
  parents: {
    u1: { title: 'Unit One' },
    'u-ref': { title: 'Reference Zone' },   // explicit unitId → reference
    u2: { title: 'Practice Basics' },        // 'practice' pattern → reference
  },
  items: [
    { plex: 'e1', metadata: { parentId: 'u1', parentIndex: 1, parentTitle: 'Unit One', itemIndex: 1 } },
    { plex: 'e2', metadata: { parentId: 'u1', parentIndex: 1, parentTitle: 'Unit One', itemIndex: 2 } },
    { plex: 'e3', metadata: { parentId: 'u2', parentIndex: 2, parentTitle: 'Practice Basics', itemIndex: 1 } },
    { plex: 'e4', metadata: { parentId: 'u-ref', parentIndex: 3, parentTitle: 'Reference Zone', itemIndex: 1 } },
  ],
});

const fitnessPlayableService = { async getPlayableEpisodes() { return basePlayable(); } };

// enrich() fixture: mark userWatched from a per-user watched plex-id set.
const makeStore = (watched) => ({
  isKnownUser: (id) => id in watched,
  enrich: (items, userId) => items.map((it) => ({
    ...it,
    userWatched: !!watched[userId]?.has(it.plex),
    userPercent: null, userPlayhead: null, userEngaged: false, userCompletedAt: null,
  })),
});

const makeUseCase = (store) => new GetPlayableUnits({
  fitnessPlayableService,
  userVideoProgressStore: store,
  configService,
  logger: noop,
});

describe('GetPlayableUnits (characterization)', () => {
  it('rejects an unknown user with reason invalid_user', async () => {
    const store = makeStore({ alice: new Set(), bob: new Set() });
    const out = await makeUseCase(store).execute({ courseId: 'C', userId: 'zeke' });
    expect(out).toEqual({ ok: false, reason: 'invalid_user' });
  });

  it('matches reference units (explicit id + title pattern), flags items, and LOCKS the ahead user at aheadBy >= buffer', async () => {
    // alice watched all 4; credit excludes the two reference units (u2, u-ref) → 2.
    // bob watched none → 0. aheadBy = 2 - 0 = 2 >= buffer(2) → locked.
    const store = makeStore({ alice: new Set(['e1', 'e2', 'e3', 'e4']), bob: new Set() });
    const { ok, result } = await makeUseCase(store).execute({ courseId: 'C', userId: 'alice' });
    expect(ok).toBe(true);
    expect(result.isSequential).toBe(true);
    // Insertion order of Object.entries(parents): u1, u-ref, u2 → ref set add order.
    expect(result.referenceUnitIds).toEqual(['u-ref', 'u2']);
    expect(result.items.map((i) => [i.plex, i.parentId, i.isReference])).toEqual([
      ['e1', 'u1', false],
      ['e2', 'u1', false],
      ['e3', 'u2', true],
      ['e4', 'u-ref', true],
    ]);
    expect(result.coProgressLock).toEqual({ locked: true, aheadBy: 2, waitingForId: 'bob', buffer: 2 });
  });

  it('does NOT lock when aheadBy < buffer', async () => {
    // alice watched only e1 → credit 1; bob 0 → aheadBy 1 < buffer 2 → no lock.
    const store = makeStore({ alice: new Set(['e1']), bob: new Set() });
    const { result } = await makeUseCase(store).execute({ courseId: 'C', userId: 'alice' });
    expect(result.coProgressLock).toBeNull();
  });

  it('guest gets the course with no enrichment and no lock', async () => {
    const store = makeStore({ alice: new Set(['e1', 'e2', 'e3', 'e4']), bob: new Set() });
    const { ok, result } = await makeUseCase(store).execute({ courseId: 'C', userId: 'guest' });
    expect(ok).toBe(true);
    expect(result.coProgressLock).toBeNull();
    expect(result.items.every((i) => i.userWatched === undefined)).toBe(true);
  });

  it('lifts nested metadata parent link to item top-level', async () => {
    const store = makeStore({ alice: new Set(), bob: new Set() });
    const { result } = await makeUseCase(store).execute({ courseId: 'C', userId: 'alice' });
    expect(result.items[0]).toMatchObject({ parentId: 'u1', parentIndex: 1, parentTitle: 'Unit One', itemIndex: 1 });
  });
});
