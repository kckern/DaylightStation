// Per-rider Skyline Glider progression. Completions are recorded as runs save;
// a rider with no progress file gets one rebuilt from the run log, so riders
// who finished an act before progression existed keep that completion.

const RIDER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

const empty = () => ({ schema: 'skyline-glider-progress/v1', completed: {}, unlocked: [] });

function invalidRider() {
  const error = new Error('invalid rider id');
  error.code = 'INVALID_RIDER';
  return error;
}

function withCompletion(progress, record) {
  const actId = record.run.course_id;
  const bells = record.collectibles.length;
  const prior = progress.completed[actId];
  if (prior && prior.bells >= bells) return progress;
  return {
    ...progress,
    completed: { ...progress.completed, [actId]: { at: record.run.ended_at, bells, run_id: record.run.id } },
  };
}

/**
 * Status per act: an act is open when it is the first in the world, when the
 * act before it (across zone boundaries) is completed, or when an admin
 * unlocked it. `next` is the first open act not yet completed.
 */
export function buildWorldProgress(world, progress = empty()) {
  const completed = progress.completed || {};
  const unlocked = new Set(progress.unlocked || []);
  let previousDone = true;
  let next = null;
  const zones = world.zones.map((zone) => ({
    ...zone,
    acts: zone.acts.map((act) => {
      const done = !!completed[act.id];
      const open = done || previousDone || unlocked.has(act.id);
      previousDone = done;
      if (open && !done && !next) next = act.id;
      return {
        ...act,
        status: done ? 'completed' : open ? 'open' : 'locked',
        ...(done ? { best: { bells: completed[act.id].bells } } : {}),
      };
    }),
  }));
  return { zones, next };
}

export class SkylineGliderProgressService {
  constructor({ progressStore, runStore, logger = console } = {}) {
    if (!progressStore || !runStore) throw new Error('SkylineGliderProgressService requires progressStore and runStore');
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
      .filter((record) => record?.rider?.user_id === riderId && record?.run?.status === 'completed' && Array.isArray(record.collectibles))
      .reduce(withCompletion, empty());
    this.logger.info?.('fitness.skyline_glider.progress.rebuilt', { riderId, completed: Object.keys(progress.completed).length });
    return progress;
  }

  async recordRun(record, householdId) {
    if (record?.run?.status !== 'completed') return null;
    const riderId = record.rider.user_id;
    const progress = withCompletion(await this.get(riderId, householdId), record);
    await this.progressStore.save(riderId, progress, householdId);
    return progress;
  }

  async unlock(riderId, actId, unlockedBy, householdId) {
    const progress = await this.get(riderId, householdId);
    if (progress.unlocked.includes(actId)) return progress;
    const next = {
      ...progress,
      unlocked: [...progress.unlocked, actId],
      unlocked_by: { ...(progress.unlocked_by || {}), [actId]: { user_id: unlockedBy || null, at: new Date().toISOString() } },
    };
    await this.progressStore.save(riderId, next, householdId);
    this.logger.info?.('fitness.skyline_glider.progress.unlocked', { riderId, actId, unlockedBy });
    return next;
  }
}
