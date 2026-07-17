/**
 * Pure send/suppress decision for a notification intent. No I/O, no clock read —
 * everything (lastSentAt, now, quietHours, cooldownMs) is passed in.
 */
export class NotificationPolicy {
  evaluate({ intent, lastSentAt, now, quietHours, cooldownMs }) {
    if (quietHours && quietHours.isWithin(now) && intent.urgency !== 'critical') {
      return { send: false, reason: 'quiet_hours' };
    }
    if (lastSentAt && (now.getTime() - lastSentAt) < cooldownMs) {
      return { send: false, reason: 'cooldown' };
    }
    return { send: true, reason: 'ok' };
  }
}
