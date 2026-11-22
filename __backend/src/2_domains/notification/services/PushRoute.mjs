/**
 * Which transport carries a push: the DaylightStation Android app when the
 * recipient's phone holds a connection and said hello recently, otherwise the
 * Home Assistant companion app. Pure; the caller supplies the clock.
 *
 * A push the recipient can answer (Approve/Deny, a quick reply) always goes
 * through Home Assistant until the app's presses carry device auth: anything on
 * the household network could otherwise claim to be the phone, or press for it.
 */
export const PHONE_FRESH_MS = 90_000;

export function choosePushTransport({ phone, nowMs, freshMs = PHONE_FRESH_MS, answerable = false }) {
  if (answerable) return 'ha';
  if (!phone?.connectionId || !Number.isFinite(phone.lastSeenMs)) return 'ha';
  return nowMs - phone.lastSeenMs <= freshMs ? 'android' : 'ha';
}
