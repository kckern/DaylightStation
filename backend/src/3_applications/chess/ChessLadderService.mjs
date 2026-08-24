import {
  applyGameToProgress, availableOpponents, createLadderProgress, normalizeProgress,
  promotionStatus, resolvePolicy, resolveRoster, rungForLevel,
} from '#shared/gaming/rulesets/chess/ladder.mjs';

/**
 * A player's position on the opponent ladder.
 *
 * The promotion arithmetic lives in the shared domain, because the kiosk has to
 * show a player where they stand and two implementations of one rule would
 * eventually disagree. What lives here is everything that only a server may do:
 * deciding when a game counts, and being the single writer of the file that
 * says how far a child has climbed.
 *
 * That the SERVER folds the result in matters. If the kiosk computed its own
 * promotions, a reloaded tab or a closed lid mid-write would lose a rung a child
 * had earned — the one piece of state here they would genuinely be upset to
 * lose.
 *
 * A guest has no ladder. There is nowhere to keep it and nobody to keep it for,
 * so a guest always faces the bottom of the roster.
 */
export function createChessLadderService({ readConfig, readProgress, writeProgress, logger = null }) {
  const policyFor = async (userId) => resolvePolicy(await readConfig(userId));

  return {
    /** Where this player stands: the roster they can face, and their next step. */
    async read(userId) {
      const config = await readConfig(userId);
      const policy = resolvePolicy(config);
      const roster = resolveRoster(config);
      const progress = userId
        ? normalizeProgress(await readProgress(userId))
        : createLadderProgress();
      const status = promotionStatus(progress, policy);
      return {
        roster,
        available: availableOpponents(progress, roster),
        current: roster[progress.unlocked_through] || roster[0],
        unlocked_through: progress.unlocked_through,
        status,
        policy,
        // A guest plays the bottom of the ladder and climbs nothing, and the
        // screen has to be able to say so rather than showing a stuck bar.
        persisted: !!userId,
      };
    },

    /**
     * Fold a finished game in, and report whether it earned the next opponent.
     *
     * Refuses to write for a guest rather than pretending: there is no file to
     * write, and a silent no-op that returns "promoted" would put a character on
     * screen that vanishes on the next load.
     */
    async recordGame(userId, record) {
      const config = await readConfig(userId);
      const policy = resolvePolicy(config);
      if (!userId) return { promoted: false, persisted: false, status: null };

      const stored = await readProgress(userId);
      const outcome = applyGameToProgress(stored, record, policy);
      const saved = await writeProgress(userId, outcome.progress);
      if (!saved) {
        logger?.warn?.('chess.ladder.write-failed', { userId, level: outcome.to });
        return { promoted: false, persisted: false, status: promotionStatus(outcome.progress, policy) };
      }
      if (outcome.promoted) {
        logger?.info?.('chess.ladder.promoted', { userId, from: outcome.from, to: outcome.to });
      }
      const roster = resolveRoster(config);
      return {
        promoted: outcome.promoted,
        persisted: true,
        from: outcome.from,
        to: outcome.to,
        next_opponent: outcome.promoted ? roster[outcome.to] : null,
        status: promotionStatus(outcome.progress, policy),
      };
    },

    /**
     * The engine settings for the level a player is asking to face, refusing to
     * look further up the ladder than they have climbed.
     *
     * The clamp is the whole "no skipping ahead" rule at its only load-bearing
     * point: everything else about it is presentation, and presentation can be
     * bypassed with a crafted request.
     */
    async rungFor(userId, requestedLevel) {
      const config = await readConfig(userId);
      const policy = resolvePolicy(config);
      const progress = userId ? normalizeProgress(await readProgress(userId)) : createLadderProgress();
      const asked = Number.isFinite(Number(requestedLevel)) ? Number(requestedLevel) : progress.unlocked_through;
      const level = Math.min(progress.unlocked_through, Math.max(0, Math.floor(asked)));
      return { rung: rungForLevel(level, policy), level, opponent: resolveRoster(config)[level] || null };
    },
  };
}

export default { createChessLadderService };
