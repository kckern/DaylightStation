/**
 * The phone copy for a public-kiosk lockdown
 * (docs/reference/notifications/push-standard.md: local times, a tag, no ids).
 * Pure: the caller supplies the lock window and the household timezone.
 */
import { formatClockTime, formatDuration, pushData } from '#domains/notification/push/pushText.mjs';

export function composeKioskShutdownPush({ lockedAt = null, lockedUntil = null, timezone = null } = {}) {
  const span = formatDuration(Date.parse(lockedUntil ?? '') - Date.parse(lockedAt ?? ''));
  const until = formatClockTime(lockedUntil, timezone);
  const detail = [span, until ? `until ${until}` : null].filter(Boolean).join(', ');
  return {
    title: detail ? `🔒 Kiosks locked — ${detail}` : '🔒 Kiosks locked',
    message: 'Started from the shutdown tag',
    // A second tap re-arms the lock; the tag replaces the first card and
    // alert_once keeps that replacement from ringing again.
    data: pushData({ tag: 'kiosk-shutdown', alertOnce: true, channel: 'Household alerts', importance: 'high' }),
  };
}

export default composeKioskShutdownPush;
