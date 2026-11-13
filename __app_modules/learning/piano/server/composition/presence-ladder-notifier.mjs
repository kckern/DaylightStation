import { composePresenceLadderPush } from '../domain/lessons/presenceLadderPush.mjs';

/** 'YYYY-MM-DD' for an instant in the household zone (falls back to the host zone). */
function householdDay(iso, timezone) {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }
}

/**
 * The optional owner push when a piano lesson sitting reaches the top of the
 * presence ladder (R9): the head of household's HA notify service, the same
 * route as harvester health. Off unless `isEnabled()` (read per call:
 * `videos.practice.presence_ladder.notify_top_rung === true`). Never throws.
 *
 * @returns {(call: { userId, title, minimalCheckIns, at, startedAt }) => Promise<void>}
 */
export function createPresenceLadderNotifier({ isEnabled, getHaGateway, getNotifyService, getDisplayName, timezone = null, logger = console }) {
  return async ({ userId, title = null, minimalCheckIns = 0, at = new Date().toISOString(), startedAt = null } = {}) => {
    try {
      if (!isEnabled?.()) {
        logger.info?.('piano.presence-ladder.notify-skipped', { userId, reason: 'disabled' });
        return;
      }
      const gateway = getHaGateway?.();
      const service = getNotifyService?.();
      if (!gateway || !service) {
        logger.info?.('piano.presence-ladder.notify-skipped', { userId, reason: 'no-target' });
        return;
      }
      const push = composePresenceLadderPush({
        child: getDisplayName?.(userId) ?? null, lesson: title, minimalCheckIns, startedAt, timezone, userId, day: householdDay(at, timezone),
      });
      await gateway.callService('notify', service, push);
      logger.info?.('piano.presence-ladder.notify-sent', { userId, minimalCheckIns, tag: push.data.tag });
    } catch (err) {
      logger.warn?.('piano.presence-ladder.notify-failed', { userId, error: err?.message });
    }
  };
}

export default createPresenceLadderNotifier;
