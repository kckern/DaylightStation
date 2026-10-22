import { EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { weekWindowFor } from "../../../../learning/school/server/study-calendar.mjs";
import { sheetReward } from "../domain/earnings/index.mjs";

const WEEK_PREVIEW_TTL_MS = 60_000;

/**
 * The current week's preview for one learner, cached per learner and week for
 * `ttlMs` (default 60 s), so per-kid polling (the bank, "print my next
 * sheet") runs one preview a minute between them. The in-flight promise is
 * what is cached, so concurrent misses for one key share one preview. A
 * learner the preview does not know (off the school roster) gets null, cached
 * too; any other failure evicts the entry and is thrown.
 * @param {object} deps
 * @param {{preview: Function, currentStudyDay: () => string}} deps.preview - EarningsPreviewService
 * @param {() => number} [deps.now]
 * @param {number} [deps.ttlMs]
 * @returns {(learnerId: string) => Promise<object|null>}
 */
export function cachedWeekPreview({ preview, now = () => Date.now(), ttlMs = WEEK_PREVIEW_TTL_MS }) {
  const cache = new Map(); // `${learnerId}|${monday}` → { at, promise }
  const load = async (learnerId) => {
    try {
      return await preview.preview({ learnerId });
    } catch (err) {
      if (err instanceof EntityNotFoundError) return null;
      throw err;
    }
  };
  return (learnerId) => {
    const key = `${learnerId}|${weekWindowFor(preview.currentStudyDay()).from}`;
    const t = now();
    const hit = cache.get(key);
    if (hit && t - hit.at < ttlMs) return hit.promise;
    for (const [k, v] of cache) if (t - v.at >= ttlMs) cache.delete(k);
    const entry = { at: t, promise: load(learnerId) };
    cache.set(key, entry);
    entry.promise.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
    return entry.promise;
  };
}

/**
 * The bank's evidence labels: the current week's preview lines for one
 * learner, as ref → label, off `cachedWeekPreview` (pass `weeks` to share
 * one cache). Null for a learner off the roster; any other failure is
 * thrown, and the bank falls back to rule labels.
 * @param {object} deps
 * @param {{preview: Function, currentStudyDay: () => string}} [deps.preview] - EarningsPreviewService
 * @param {(learnerId: string) => Promise<object|null>} [deps.weeks] - a shared `cachedWeekPreview`
 * @param {() => number} [deps.now]
 * @param {number} [deps.ttlMs]
 */
export function cachedEvidenceLabels({ preview, now = () => Date.now(), ttlMs = WEEK_PREVIEW_TTL_MS, weeks = null }) {
  const week = weeks ?? cachedWeekPreview({ preview, now, ttlMs });
  const built = new WeakMap(); // one Map per cached week, so a cache hit is the same Map
  return async (learnerId) => {
    const w = await week(learnerId);
    if (!w) return null;
    if (!built.has(w)) built.set(w, new Map((w.lines ?? []).filter((l) => l.ref && l.label).map((l) => [l.ref, l.label])));
    return built.get(w);
  };
}

/**
 * School's `rewardFor({learnerId, unit})` port: what one sheet is worth
 * (`domain/earnings/sheetReward.mjs`), off the shared week cache. Only a
 * `live` economy names an amount; off and dry-run answer null without running
 * a preview. Never throws: a failure is null, warned once per learner until a
 * read for that learner succeeds again.
 * @param {object} deps
 * @param {(learnerId: string) => Promise<object|null>} deps.weeks - `cachedWeekPreview`
 * @param {{catalog: () => {mode: string}}} deps.config
 */
export function cachedSheetRewards({ weeks, config, logger = console }) {
  const warned = new Set();
  return async ({ learnerId, unit } = {}) => {
    try {
      const mode = config.catalog().mode;
      if (mode !== 'live') return null;
      const reward = sheetReward({ week: await weeks(learnerId), unit, mode });
      warned.delete(learnerId);
      return reward;
    } catch (err) {
      if (!warned.has(learnerId)) {
        warned.add(learnerId);
        logger.warn?.('economy.sheet-reward.failed', { learnerId: learnerId ?? null, error: err?.message ?? String(err) });
      }
      return null;
    }
  };
}

export async function createEconomyEarningsRuntime({schoolLifecycle,economyApi,fitnessRings,schoolLearnerDirectory,measuresTimezone,rootLogger,previewCacheNow = () => Date.now()}) {
    const { EarningsPreviewService } = await import("../application/EarningsPreviewService.mjs");
    const { SchoolEarningEvidence } = await import("../adapters/school/SchoolEarningEvidence.mjs");
    const { createEarningsRouter } = await import("../api/earnings.mjs");
    const { PayoutService } = await import("../application/PayoutService.mjs");
    const { WeekCloseService } = await import("../application/WeekCloseService.mjs");
    const { WorkoutEarningsService } = await import("../application/WorkoutEarningsService.mjs");
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
          debriefs: schoolLifecycle?.debriefLauncher?.weekFacts
            ? {
              week: ({ learnerId, week }) => schoolLifecycle.debriefLauncher.weekFacts({
                learnerId, week,
                quizPassRatio: schoolLifecycle.debriefConfig?.quizPassRatio ?? 0.67,
                substantiveScore: schoolLifecycle.debriefConfig?.substantiveScore ?? 6,
              }),
            }
            : null,
          logger: rootLogger.child({ module: 'school-earning-evidence' }),
        })
        : unavailableSchool,
      // The same provider the board's weekly ring figure uses.
      ringEvidence: fitnessRings,
      learners: async () => schoolLearnerDirectory.listLearners(),
      clock: () => new Date(),
      // One study calendar for the preview and the passes (the bank's "today").
      timezone: economyApi.studyCalendar?.timezone ?? measuresTimezone,
      boundaryHour: economyApi.studyCalendar?.boundaryHour ?? 4,
      logger: rootLogger.child({ module: 'economy-earnings' }),
    });
    // One briefly cached week per learner, so polled surfaces do not rerun the
    // ring standings. The bank names a payout by the preview line it paid for
    // (ref → label); School's "print my next sheet" says what the sheet is
    // worth (`economyApi.rewardFor`, handed to School before this runtime exists).
    const weeks = cachedWeekPreview({ preview: earningsPreview, now: previewCacheNow });
    economyApi.useEvidenceLabels?.(cachedEvidenceLabels({ weeks }));
    economyApi.useSheetRewards?.(cachedSheetRewards({
      weeks, config: economyApi.configProjection, logger: rootLogger.child({ module: 'economy-sheet-reward' }),
    }));
    // Payouts mint what this same preview says was earned (B3), so the board
    // and the ledger read one evaluator. Started by `startEconomyPayouts`.
    const payoutService = new PayoutService({
      preview: earningsPreview,
      economy: economyApi.economyService,
      config: economyApi.configProjection,
      logger: rootLogger.child({ module: 'economy-payout' }),
    });
    // The Sunday close (B4): settle the week once more, then silver → gold.
    // Started by `startWeekClose`.
    const weekCloseService = new WeekCloseService({
      payout: payoutService,
      economy: economyApi.economyService,
      config: economyApi.configProjection,
      // Off-roster payout earners close too (a kid who left the roster).
      listUsers: () => economyApi.configProjection.users(),
      logger: rootLogger.child({ module: 'economy-week-close' }),
    });
    // What one workout was worth (the fitness coin ceremony) and the week's
    // standings (the fitness home cards). Read-only over the same preview.
    const workoutEarnings = new WorkoutEarningsService({
      preview: earningsPreview,
      economy: economyApi.economyService,
      config: economyApi.configProjection,
      logger: rootLogger.child({ module: 'economy-workout-earnings' }),
    });
    const router = createEarningsRouter({
      earningsPreview,
      earnRules: economyApi.earnRulesService,
      workoutEarnings,
      logger: rootLogger.child({ module: 'economy-earnings-api' }),
    });
    return { router, earningsPreview, payoutService, weekCloseService, workoutEarnings };
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

/**
 * When the week closes: `economy:week-close` on `catalog().week_close.cron`
 * (Sunday 23:30 local in the shipped catalog), read once at boot, so a cron
 * change needs a restart. A null or blank cron registers nothing and says so
 * once. The task asks `WeekCloseService.close()` with no week, which closes
 * the week whose Sunday is today or has passed (the preview's study day).
 *
 * Same gate as the payouts (`enabled`). Registered whatever the mode, so a
 * reload from `off` needs no restart; while the catalog reads `off`, `close`
 * returns before any settle. A failure is logged (`economy.week-close.failed`,
 * error for CORRUPT_LEDGER) and never reaches the scheduler loop. The
 * scheduler has no catch-up: a close missed while the backend was down waits
 * for next Sunday, which converts the whole balance anyway.
 *
 * @param {object} deps
 * @param {import('../application/WeekCloseService.mjs').WeekCloseService} deps.weekCloseService
 * @param {{catalog: () => {mode: string, week_close: {cron: string|null}}}} deps.config
 * @param {boolean} [deps.enabled=true]
 * @param {{registerTask: (key: string, cron: string, fn: Function) => void}|null} [deps.scheduler]
 * @returns {{stop: () => void}} stop() makes the registered task return at once.
 */
export function startWeekClose({ weekCloseService, config, enabled = true, scheduler = null, logger = console }) {
  if (!enabled) {
    logger.info?.('economy.week-close.disabled', { reason: 'scheduler disabled (production or ENABLE_CRON only)' });
    return { stop() {} };
  }
  const fail = (err) => {
    const level = err?.code === 'CORRUPT_LEDGER' ? 'error' : 'warn';
    logger[level]?.('economy.week-close.failed', { error: err?.message ?? String(err), code: err?.code ?? null });
  };
  let cron;
  try {
    cron = config.catalog().week_close?.cron;
  } catch (err) {
    fail(err);
    return { stop() {} };
  }
  if (typeof cron !== 'string' || !cron.trim()) {
    logger.info?.('economy.week-close.no-cron', { reason: 'catalog week_close.cron is not set' });
    return { stop() {} };
  }
  let stopped = false;
  scheduler?.registerTask?.('economy:week-close', cron.trim(), async () => {
    if (stopped) return;
    try {
      // `close` reads the mode itself, per run: that read governs the
      // conversion (off returns before any settle).
      await weekCloseService.close({});
    } catch (err) {
      fail(err);
    }
  });
  return { stop() { stopped = true; } };
}
