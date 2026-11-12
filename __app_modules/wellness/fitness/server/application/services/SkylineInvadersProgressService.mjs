// Per-rider Skyline Invaders progression. Completions are recorded as runs
// save; a rider with no progress file gets one rebuilt from the run log, so
// deleting a progress file loses nothing.

const RIDER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

const empty = () => ({ schema: 'skyline-invaders-progress/v1', completed: {}, unlocked: [] });

function invalidRider() {
  const error = new Error('invalid rider id');
  error.code = 'INVALID_RIDER';
  return error;
}

// A completion replaces the prior one only with more stars, or equal stars and
// a higher score.
function withCompletion(progress, record) {
  const levelId = record.run.level_id;
  const { stars, score } = record.run;
  const prior = progress.completed[levelId];
  if (prior && (prior.stars > stars || (prior.stars === stars && prior.score >= score))) return progress;
  return {
    ...progress,
    completed: { ...progress.completed, [levelId]: { at: record.run.ended_at, stars, score, run_id: record.run.id } },
  };
}

/**
 * Status per level: a level is open when it is the first in the world, when
 * the level before it is completed, or when an admin unlocked it. `next` is
 * the first open level not yet completed.
 */
export function buildWorldProgress(world, progress = empty()) {
  const completed = progress.completed || {};
  const unlocked = new Set(progress.unlocked || []);
  let previousDone = true;
  let next = null;
  const levels = world.levels.map((level) => {
    const done = !!completed[level.id];
    const open = done || previousDone || unlocked.has(level.id);
    previousDone = done;
    if (open && !done && !next) next = level.id;
    return {
      ...level,
      status: done ? 'completed' : open ? 'open' : 'locked',
      ...(done ? { best: { stars: completed[level.id].stars, score: completed[level.id].score } } : {}),
    };
  });
  return { levels, next };
}

export class SkylineInvadersProgressService {
  constructor({ progressStore, runStore, logger = console } = {}) {
    if (!progressStore || !runStore) throw new Error('SkylineInvadersProgressService requires progressStore and runStore');
    this.progressStore = progressStore;
    this.runStore = runStore;
    this.logger = logger;
  }

  async get(riderId, householdId) {
    if (!RIDER_ID.test(riderId || '')) throw invalidRider();
    const stored = await this.progressStore.find(riderId, householdId);
    if (stored) return { ...empty(), ...stored };
    const rebuilt = await this.rebuild(riderId, householdId);
    await this.progressStore.save(riderId, rebuilt, householdId);
    return rebuilt;
  }

  async worldFor(world, riderId, householdId) {
    return buildWorldProgress(world, riderId ? await this.get(riderId, householdId) : undefined);
  }

  async rebuild(riderId, householdId) {
    const runs = await this.runStore.findAll(householdId);
    const progress = runs
      .filter((record) => record?.rider?.user_id === riderId && record?.run?.status === 'completed' && Number.isFinite(record.run.stars) && Number.isFinite(record.run.score))
      .reduce(withCompletion, empty());
    this.logger.info?.('fitness.skyline_invaders.progress.rebuilt', { riderId, completed: Object.keys(progress.completed).length });
    return progress;
  }

  async recordRun(record, householdId) {
    if (record?.run?.status !== 'completed') return null;
    const riderId = record.rider.user_id;
    const progress = withCompletion(await this.get(riderId, householdId), record);
    await this.progressStore.save(riderId, progress, householdId);
    return progress;
  }

  async unlock(riderId, levelId, unlockedBy, householdId) {
    const progress = await this.get(riderId, householdId);
    if (progress.unlocked.includes(levelId)) return progress;
    const next = {
      ...progress,
      unlocked: [...progress.unlocked, levelId],
      unlocked_by: { ...(progress.unlocked_by || {}), [levelId]: { user_id: unlockedBy || null, at: new Date().toISOString() } },
    };
    await this.progressStore.save(riderId, next, householdId);
    this.logger.info?.('fitness.skyline_invaders.progress.unlocked', { riderId, levelId, unlockedBy });
    return next;
  }
}
