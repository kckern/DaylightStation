import { EntityNotFoundError } from '#domains/core/errors/index.mjs';

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

/**
 * When payouts settle. Two triggers, one path (`PayoutService.settle`):
 *
 *   events     `school.session.outcome-recorded` ({learnerId, ...}) and
 *              `piano.lesson.completed` ({userId, ...}), debounced per learner
 *              (default 30 s) so a burst of grades settles once.
 *   schedule   `economy:payout-reconcile` every 15 minutes settles the whole
 *              roster for the current week. It catches what no event announces:
 *              day-met and week-met lines turn true as days close, and the ring
 *              contest at Saturday noon.
 *
 * Always subscribed, so a reload from `off` to `dry-run`/`live` needs no
 * restart; while the catalog reads `off` both triggers return before any
 * preview. A failure is logged (`economy.payout.failed`) and never reaches
 * the bus or the scheduler loop.
 *
 * @param {object} deps
 * @param {import('../application/PayoutService.mjs').PayoutService} deps.payoutService
 * @param {{catalog: () => {mode: string}}} deps.config
 * @param {{subscribe: (topic: string, fn: Function) => Function|void}|null} [deps.eventBus]
 * @param {{registerTask: (key: string, cron: string, fn: Function) => void}|null} [deps.scheduler]
 * @returns {{stop: () => void}}
 */
export function startEconomyPayouts({ payoutService, config, eventBus = null, scheduler = null, logger = console,
  debounceMs = 30_000, timers = { setTimeout, clearTimeout } }) {
  const off = () => config.catalog().mode === 'off';
  const fail = (learnerId, err) => {
    // Not every piano player is on the school roster; that is not a failure.
    if (err instanceof EntityNotFoundError) {
      logger.debug?.('economy.payout.unknown-learner', { learnerId, error: err.message });
      return;
    }
    logger.warn?.('economy.payout.failed', { learnerId, error: err?.message ?? String(err) });
  };
  const pending = new Map();
  const schedule = (learnerId) => {
    timers.clearTimeout(pending.get(learnerId));
    const timer = timers.setTimeout(() => {
      pending.delete(learnerId);
      Promise.resolve()
        .then(() => payoutService.settle({ learnerId, week: null }))
        .catch((err) => fail(learnerId, err));
    }, debounceMs);
    timer?.unref?.();
    pending.set(learnerId, timer);
  };
  const onEvent = (payload) => {
    try {
      const raw = payload?.learnerId ?? payload?.userId;
      const learnerId = typeof raw === 'string' ? raw.trim() : '';
      if (!learnerId || off()) return;
      schedule(learnerId);
    } catch (err) {
      fail(null, err);
    }
  };
  const unsubscribers = eventBus?.subscribe
    ? PAYOUT_TOPICS.map((topic) => eventBus.subscribe(topic, onEvent))
    : [];
  scheduler?.registerTask?.('economy:payout-reconcile', '*/15 * * * *', async () => {
    try {
      if (off()) return;
      await payoutService.settleAll({ week: null });
    } catch (err) {
      fail(null, err);
    }
  });
  return {
    stop() {
      unsubscribers.forEach((unsubscribe) => { if (typeof unsubscribe === 'function') unsubscribe(); });
      for (const timer of pending.values()) timers.clearTimeout(timer);
      pending.clear();
    },
  };
}
