import { EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { weekWindowFor } from "../../../../learning/school/server/study-calendar.mjs";

export async function createEconomyEarningsRuntime({schoolLifecycle,economyApi,fitnessRings,schoolLearnerDirectory,measuresTimezone,rootLogger}) {
    const { EarningsPreviewService } = await import("../application/EarningsPreviewService.mjs");
    const { SchoolEarningEvidence } = await import("../adapters/school/SchoolEarningEvidence.mjs");
    const { createEarningsRouter } = await import("../api/earnings.mjs");
    const { PayoutService } = await import("../application/PayoutService.mjs");
    const termVerdicts = schoolLifecycle?.termVerdicts ?? null;
    const learnerSessions = schoolLifecycle?.listLearnerSessions ?? null;
    const curriculum = schoolLifecycle?.stores?.curriculum ?? null;
    const unavailableSchool = {
      schoolWeek: async () => { throw new Error('school term verdicts are not wired'); },
    };
    const earningsPreview = new EarningsPreviewService({
      rules: economyApi.earnRulesService,
      schoolEvidence: termVerdicts && learnerSessions
        ? new SchoolEarningEvidence({
          termVerdicts,
          sessions: learnerSessions,
          unitInfo: curriculum?.getUnitSummary
            ? async (unitId) => {
              const unit = await curriculum.getUnitSummary(unitId);
              return unit ? { subject: unit.subject ?? null, courseId: unit.courseId ?? null } : null;
            }
            : null,
          logger: rootLogger.child({ module: 'school-earning-evidence' }),
        })
        : unavailableSchool,
      // The same provider the board's weekly ring figure uses.
      ringEvidence: fitnessRings,
      learners: async () => schoolLearnerDirectory.listLearners(),
      clock: () => new Date(),
      timezone: measuresTimezone,
      logger: rootLogger.child({ module: 'economy-earnings' }),
    });
    // Payouts mint what this same preview says was earned (B3), so the board
    // and the ledger read one evaluator. Started by `startEconomyPayouts`.
    const payoutService = new PayoutService({
      preview: earningsPreview,
      economy: economyApi.economyService,
      config: economyApi.configProjection,
      logger: rootLogger.child({ module: 'economy-payout' }),
    });
    const router = createEarningsRouter({
      earningsPreview,
      earnRules: economyApi.earnRulesService,
      logger: rootLogger.child({ module: 'economy-earnings-api' }),
    });
    return { router, earningsPreview, payoutService };
}

const PAYOUT_TOPICS = ['school.session.outcome-recorded', 'piano.lesson.completed'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// Monday, Tuesday, Wednesday: last week is still re-priced (late grades).
const GRACE_WEEKDAYS = new Set([1, 2, 3]);

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (day) => new Date(`${day}T00:00:00.000Z`).getUTCDay();

/**
 * When payouts settle. Two triggers, one path (`PayoutService`):
 *
 *   events     `school.session.outcome-recorded` ({learnerId, studyDay?}) and
 *              `piano.lesson.completed` ({userId}), debounced per learner and
 *              week (default 30 s) so a burst of grades settles once. A fact
 *              naming a study day settles that day's week, so a grade
 *              corrected late re-prices the week the work belongs to.
 *   schedule   `economy:payout-reconcile`, the hourly reconcile, settles the
 *              whole roster for the current week, and for the previous week
 *              too while today's study day is Monday to Wednesday (the grace
 *              window). It catches what no event announces: day-met and
 *              week-met lines turn true as days close, and the ring contest
 *              at Saturday noon. (The scheduler runs a task at most once per
 *              clock hour, so the cron is hourly.)
 *
 * Disabled (`enabled: false`, the same gate as the scheduler) it subscribes to
 * nothing and registers nothing. Enabled, it always subscribes, so a reload
 * from `off` to `dry-run`/`live` needs no restart; while the catalog reads
 * `off` both triggers return before any preview. A failure is logged
 * (`economy.payout.failed`) and never reaches the bus or the scheduler loop.
 *
 * @param {object} deps
 * @param {import('../application/PayoutService.mjs').PayoutService} deps.payoutService
 * @param {{catalog: () => {mode: string}}} deps.config
 * @param {boolean} [deps.enabled=true]
 * @param {{subscribe: (topic: string, fn: Function) => Function|void}|null} [deps.eventBus]
 * @param {{registerTask: (key: string, cron: string, fn: Function) => void}|null} [deps.scheduler]
 * @returns {{stop: () => void}} stop() unsubscribes and drops pending debounced
 *   settles; a settle already running is not awaited, and the scheduler (which
 *   has no unregister) keeps calling a task that now returns at once.
 */
export function startEconomyPayouts({ payoutService, config, enabled = true, eventBus = null, scheduler = null, logger = console,
  debounceMs = 30_000, timers = { setTimeout, clearTimeout } }) {
  if (!enabled) {
    logger.info?.('economy.payout.disabled', { reason: 'scheduler disabled (production or ENABLE_CRON only)' });
    return { stop() {} };
  }
  let stopped = false;
  const off = () => config.catalog().mode === 'off';
  // The preview's own "today" (its clock, timezone and boundary hour), so the
  // grace window and `week: null` can never disagree about the day.
  const today = () => payoutService.currentStudyDay();
  const mondayOf = (day) => weekWindowFor(day).from;
  const fail = (learnerId, err) => {
    // Not every piano player is on the school roster; that is not a failure.
    if (err instanceof EntityNotFoundError) {
      logger.debug?.('economy.payout.unknown-learner', { learnerId, error: err.message });
      return;
    }
    const level = err?.code === 'CORRUPT_LEDGER' ? 'error' : 'warn';
    logger[level]?.('economy.payout.failed', { learnerId, error: err?.message ?? String(err), code: err?.code ?? null });
  };
  const pending = new Map();
  const schedule = (learnerId, week) => {
    const key = `${learnerId}|${week ?? 'current'}`;
    timers.clearTimeout(pending.get(key));
    const timer = timers.setTimeout(() => {
      pending.delete(key);
      if (stopped) return;
      Promise.resolve()
        .then(() => payoutService.settle({ learnerId, week }))
        .catch((err) => fail(learnerId, err));
    }, debounceMs);
    timer?.unref?.();
    pending.set(key, timer);
  };
  const onEvent = (payload) => {
    try {
      if (stopped) return;
      const raw = payload?.learnerId ?? payload?.userId;
      const learnerId = typeof raw === 'string' ? raw.trim() : '';
      if (!learnerId || off()) return;
      // The week the work belongs to; the current week reads as null so it
      // shares a debounce with the facts that carry no study day.
      const studyDay = DAY.test(payload?.studyDay ?? '') ? payload.studyDay : null;
      const week = studyDay && mondayOf(studyDay) !== mondayOf(today()) ? mondayOf(studyDay) : null;
      schedule(learnerId, week);
    } catch (err) {
      fail(null, err);
    }
  };
  const unsubscribers = eventBus?.subscribe
    ? PAYOUT_TOPICS.map((topic) => eventBus.subscribe(topic, onEvent))
    : [];
  scheduler?.registerTask?.('economy:payout-reconcile', '0 * * * *', async () => {
    if (stopped) return;
    try {
      if (off()) return;
    } catch (err) {
      fail(null, err);
      return;
    }
    // Separate tries: a current-week failure must not skip last week's grace settle.
    try {
      await payoutService.settleAll({ week: null });
    } catch (err) {
      fail(null, err);
    }
    try {
      const day = today();
      if (GRACE_WEEKDAYS.has(weekday(day))) {
        await payoutService.settleAll({ week: addDays(mondayOf(day), -7) });
      }
    } catch (err) {
      fail(null, err);
    }
  });
  return {
    stop() {
      stopped = true;
      unsubscribers.forEach((unsubscribe) => { if (typeof unsubscribe === 'function') unsubscribe(); });
      for (const timer of pending.values()) timers.clearTimeout(timer);
      pending.clear();
    },
  };
}
