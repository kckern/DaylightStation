import {
  DEFAULT_RESUME_MAX_DAYS, markAbandoned, normalizeSlot, recordIntoSlot, selectResumable,
} from '#shared/gaming/rulesets/chess/resumeSlot.mjs';

/**
 * Which unfinished chess game a player picks up again.
 *
 * The server holds the answer, not the tablet: a reload, a cleared
 * localStorage, a crash or a deploy mid-game must never cost a child their
 * position. See `shared/gaming/rulesets/chess/resumeSlot.mjs` for the rules and
 * the incident this exists for.
 *
 * Writes for one player are serialised. Progress saves are debounced on the
 * client but a beacon on page-hide can land beside one, and a read-modify-write
 * on one file would otherwise lose the later of the two.
 */
export function createChessResumeService({
  readSlot, writeSlot, readConfig = async () => ({}), logger = null, now = () => new Date(),
}) {
  const queues = new Map();
  const serial = (userId, work) => {
    const run = (queues.get(userId) || Promise.resolve()).catch(() => {}).then(work);
    queues.set(userId, run);
    return run;
  };

  const maxDaysFor = async (userId) => {
    const config = await readConfig(userId);
    const raw = config?.resume_max_days;
    return raw === undefined || raw === null || raw === '' || !Number.isFinite(Number(raw))
      ? DEFAULT_RESUME_MAX_DAYS
      : Number(raw);
  };

  return {
    /** File a progress save or an archive. Guests have no profile and are not resumed. */
    record(record) {
      const userId = record?.user_id;
      if (!userId) return Promise.resolve({ applied: false, reason: 'guest' });
      return serial(userId, async () => {
        const slot = normalizeSlot(await readSlot(userId));
        const result = recordIntoSlot(slot, record, now());
        if (!result.applied) return { applied: false, reason: result.reason, state: result.state };
        await writeSlot(userId, result.slot);
        logger?.debug?.('chess.resume.recorded', {
          userId, gameId: record.game_id, state: result.state, plies: record.move_count ?? null,
        });
        return { applied: true, state: result.state };
      });
    },

    abandon(userId, gameId) {
      return serial(userId, async () => {
        const result = markAbandoned(await readSlot(userId), gameId);
        if (result.applied) {
          await writeSlot(userId, result.slot);
          logger?.info?.('chess.resume.abandoned', { userId, gameId });
        }
        return { applied: result.applied };
      });
    },

    async resumable(userId) {
      const [slot, maxDays] = await Promise.all([readSlot(userId), maxDaysFor(userId)]);
      const pick = selectResumable(slot, { now: now(), maxDays });
      return { game: pick, window_days: maxDays };
    },
  };
}

export default createChessResumeService;
