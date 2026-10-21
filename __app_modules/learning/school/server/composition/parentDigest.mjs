/**
 * The 6 pm parent digest and the zero-days alert, composed (school economy
 * slice 1, C6). See `SchoolParentDigest` for what is sent.
 *
 * School imports no economy code. Composition hands it:
 *
 * - `economyToday(learnerId, studyDay)`, built here from `economyService`
 *   by duck typing (`getHistory`, `hasUser`), like `agendaEconomy.mjs`.
 *   Silver earned is the sum of positive silver deltas on payout entries
 *   (kind earn/prize, `source: 'payout'`, `action: 'payout:…'`, the economy's
 *   `isPayoutEntry`) stamped inside the study day (household zone, 4 am
 *   boundary). Passes used counts the day's pass purchases (the `pass`
 *   marker whose `ref` is its own pass id) less the ones refunded. A learner
 *   the economy does not know answers null (no silver or pass clause).
 * - the catalog's `digest` block. `cron` is read once, at boot: a change
 *   needs a restart, and a null cron registers nothing. `zero_days_alert`
 *   and `mode` are read on every run.
 *
 * Scheduling: `school:parent-digest` on the catalog cron, plus
 * `school:parent-digest-retry` every 15 minutes, which resends any push the
 * NotificationService held (`suppressed`). Both register only when
 * `enabled` (the agents scheduler's production/ENABLE_CRON gate).
 */
import { SchoolParentDigest } from "../application/SchoolParentDigest.mjs";
import { createSchoolLedgerReader } from "../adapters/logging/SchoolLedgerReader.mjs";
import { studyDayWindowForDate, studyDayForInstant } from "../domain/studyDay.mjs";

export const RETRY_CRON = '*/15 * * * *';

const isPayout = (t) => (t?.kind === 'earn' || t?.kind === 'prize') && t.source === 'payout'
  && typeof t.action === 'string' && t.action.startsWith('payout:');

/**
 * @param {{economyService: object|null, timezone?: string|null, boundaryHour?: number}} args
 * @returns {((learnerId: string, studyDay: string) => Promise<{silverEarned: number, passesUsed: number}|null>)|null}
 */
export function createDigestEconomyPort({ economyService, timezone = null, boundaryHour = 4 } = {}) {
  if (typeof economyService?.getHistory !== 'function') return null;
  return async (learnerId, studyDay) => {
    if (typeof economyService.hasUser === 'function' && !economyService.hasUser(learnerId)) return null;
    const window = studyDayWindowForDate(studyDay, { timezone, boundaryHour });
    if (!window) return null;
    const history = await economyService.getHistory(learnerId, { since: new Date(window.startAtMs).toISOString() });
    const inDay = (t) => {
      const ms = Date.parse(t?.at ?? '');
      return Number.isFinite(ms) && ms >= window.startAtMs && ms < window.endAtMs;
    };
    let silverEarned = 0;
    const bought = new Set();
    const refunded = new Set();
    for (const t of history ?? []) {
      if (isPayout(t) && (t.currency ?? 'silver') === 'silver' && t.delta > 0 && inDay(t)) silverEarned += t.delta;
      if (t?.kind !== 'pass' || t.source !== 'pass') continue;
      if (t.ref && t.ref === t.evidenceRef && (t.meta?.studyDay ? t.meta.studyDay === studyDay : inDay(t))) bought.add(t.ref);
      if (t.meta?.state === 'refunded' && t.evidenceRef) refunded.add(t.evidenceRef);
    }
    const passesUsed = [...bought].filter((id) => !refunded.has(id)).length;
    return { silverEarned, passesUsed };
  };
}

/**
 * @returns {{digest: SchoolParentDigest|null, stop: () => void}}
 */
export function createSchoolParentDigest({
  economyConfig = null, economyService = null, studyCalendar = {},
  roster, learnerName, getLearnerDayCompletion, termVerdicts, sessions = null,
  notificationService, teachers, logsDir = null, timezone = null,
  scheduler = null, enabled = false, now = Date.now, logger = console,
} = {}) {
  if (!enabled || !scheduler?.registerTask) {
    logger.info?.('school.parent-digest.disabled', { reason: 'scheduler disabled (production or ENABLE_CRON only)' });
    return { digest: null, stop() {} };
  }
  let cron = null;
  try { cron = economyConfig?.catalog?.()?.digest?.cron ?? null; } catch (error) {
    logger.warn?.('school.parent-digest.config-failed', { error: error?.message ?? String(error) });
  }
  if (typeof cron !== 'string' || !cron.trim()) {
    logger.info?.('school.parent-digest.no-cron', { reason: 'economy catalog digest.cron is not set' });
    return { digest: null, stop() {} };
  }
  const catalogDigest = () => economyConfig?.catalog?.()?.digest ?? {};
  const digest = new SchoolParentDigest({
    roster, learnerName, getLearnerDayCompletion, termVerdicts,
    economyToday: createDigestEconomyPort({
      economyService, timezone: studyCalendar.timezone ?? timezone, boundaryHour: studyCalendar.boundaryHour ?? 4,
    }),
    coinsMode: () => economyConfig?.catalog?.()?.mode ?? 'off',
    zeroDaysAlert: () => catalogDigest().zero_days_alert ?? null,
    ledger: logsDir ? createSchoolLedgerReader({ baseDir: logsDir }) : null,
    learnerSessionIds: sessions?.listForLearner
      ? async (learnerId) => (await sessions.listForLearner(learnerId)).map((s) => s.sessionId)
      : null,
    notifications: notificationService,
    teachers,
    today: () => studyDayForInstant(now(), { timezone }),
    timezone,
    logger,
  });
  let stopped = false;
  scheduler.registerTask('school:parent-digest', cron.trim(), async () => {
    if (stopped) return;
    try { await digest.run({}); } catch (error) {
      logger.warn?.('school.parent-digest.failed', { error: error?.message ?? String(error) });
    }
  });
  scheduler.registerTask('school:parent-digest-retry', RETRY_CRON, async () => {
    if (stopped) return;
    try { await digest.retryHeld(); } catch (error) {
      logger.warn?.('school.parent-digest.failed', { reason: 'retry', error: error?.message ?? String(error) });
    }
  });
  logger.info?.('school.parent-digest.wired', { cron: cron.trim() });
  return { digest, stop() { stopped = true; } };
}

export default createSchoolParentDigest;
