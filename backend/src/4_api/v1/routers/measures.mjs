/**
 * `/api/v1/measures` — weekly measures for the whole school roster.
 *
 * ROSTER-WIDE, NOT PER-LEARNER, on purpose. The school status board draws one
 * card per child and already follows this pattern for the teacher day digest;
 * four cards must not mean four round trips on a wall panel that repaints
 * every five minutes.
 *
 * Read-only and `no-store`. It mints nothing, opens no session and writes no
 * evidence — it is a view over facts fitness already recorded.
 */
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { studyDayFor, weekWindowFor, weekState } from '#domains/measures/weeklyWindow.mjs';

export function createMeasuresRouter({
  registry,
  learners,           // () => Promise<Array<{id}>> — the school roster
  timezone = 'UTC',
  clock = () => new Date(),
  logger = null,
} = {}) {
  const router = express.Router();

  /**
   * GET /weekly?week=YYYY-MM-DD
   *
   * `week` is any day inside the wanted week; the Sunday→Saturday window
   * containing it is returned. Omitted means the current week.
   */
  router.get('/weekly', asyncHandler(async (req, res) => {
    const asked = typeof req.query.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.week)
      ? req.query.week
      : studyDayFor(clock(), { timezone });
    const window = weekWindowFor(asked);

    const roster = (await learners?.()) ?? [];
    const today = studyDayFor(clock(), { timezone });

    const rows = [];
    for (const learner of roster) {
      const learnerId = learner?.id ?? learner?.learnerId;
      if (!learnerId) continue;
      const measures = await registry.totalsFor({ learnerId, ...window, logger });
      rows.push({
        learnerId,
        measures: measures.map((m) => ({
          ...m,
          // v1 configures no targets, so this is `untargeted` for everyone. It
          // is computed anyway because it is the vocabulary the eventual gate
          // needs, and deriving it later would mean revisiting every layer.
          state: weekState({ value: m.value ?? 0, target: null, day: today, window }),
        })),
      });
    }

    res.set('Cache-Control', 'no-store').json({ window, learners: rows });
  }));

  return router;
}

export default createMeasuresRouter;
