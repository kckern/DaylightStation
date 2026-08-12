/**
 * Chess configuration: household defaults under a per-user override.
 *
 * The ladder is replaced wholesale rather than merged element-wise — a
 * half-merged ladder (rung 2 from the user, rung 3 from the house) is never
 * what anyone means.
 */

const MERGE_BLOCKS = ['feedback'];

export function mergeChessConfig(household, user) {
  const base = household || {};
  if (!user || typeof user !== 'object') return { ...base };
  const merged = { ...base, ...user };
  for (const block of MERGE_BLOCKS) {
    if (base[block] || user[block]) {
      merged[block] = { ...(base[block] || {}), ...(user[block] || {}) };
    }
  }
  return merged;
}

/** A typo in YAML must not take the game down, so an unknown rung lands mid-ladder. */
export function resolveRung(config, rungId, logger = null) {
  const rungs = Array.isArray(config?.rungs) ? config.rungs : [];
  if (rungs.length === 0) return null;
  const found = rungs.find((rung) => rung.id === rungId);
  if (found) return found;
  const middle = rungs[Math.floor(rungs.length / 2)];
  logger?.warn?.('chess.config.unknown-rung', { requested: rungId, fallback: middle.id });
  return middle;
}

export function createChessConfigService({
  readHouseholdConfig,
  readUserConfig,
  writeUserConfig,
  logger = null,
}) {
  return {
    async read(userId) {
      const household = await readHouseholdConfig();
      const user = userId ? await readUserConfig(userId) : null;
      return mergeChessConfig(household, user);
    },
    /**
     * Merge a patch into the user's override.
     *
     * The datastore writes whole files, so this must read first: the panel emits
     * one sparse patch per tap, and a straight write would make each setting
     * erase the one before it.
     */
    async writeUserLayer(userId, patch) {
      if (!userId) throw new Error('chess config: a user is required to write an override');
      const existing = (await readUserConfig(userId)) || {};
      const next = mergeChessConfig(existing, patch || {});
      await writeUserConfig(userId, next);
      logger?.info?.('chess.config.user-saved', { userId, keys: Object.keys(patch || {}) });
      return next;
    },
    resolveRung: (config, rungId) => resolveRung(config, rungId, logger),
  };
}

export default { createChessConfigService, mergeChessConfig, resolveRung };
