/**
 * Which transport carries a push: the DaylightStation Android app when the
 * recipient's phone holds a connection and said hello recently, otherwise the
 * Home Assistant companion app. Pure; the caller supplies the clock.
 */
export const PHONE_FRESH_MS = 90_000;

export function choosePushTransport({ phone, nowMs, freshMs = PHONE_FRESH_MS }) {
  if (!phone?.connectionId || !Number.isFinite(phone.lastSeenMs)) return 'ha';
  return nowMs - phone.lastSeenMs <= freshMs ? 'android' : 'ha';
}
