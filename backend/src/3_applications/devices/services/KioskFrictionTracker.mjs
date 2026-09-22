// backend/src/3_applications/devices/services/KioskFrictionTracker.mjs
import { recordFrictionPing, frictionScore } from '#domains/devices/kioskFrictionWindow.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC calendar-day boundary — friction cooldown does not need household-
 * timezone precision (unlike School's study-day semantics); this is purely
 * for assertion-id/period stability, not curriculum logic, so importing a
 * School domain util here would be the wrong layer dependency anyway. */
function utcDayWindow(at) {
  const dayStart = Math.floor(at / DAY_MS) * DAY_MS;
  return { day: new Date(dayStart).toISOString().slice(0, 10), startsAt: dayStart, endsAt: dayStart + DAY_MS };
}

/**
 * Tracks a short rolling window of "friction" signals per device and keeps
 * State Gates' `kiosk.friction-score` claim current — one stable assertion
 * per (device, calendar day), corrected in place with a strictly increasing
 * `sourceRevision`, exactly the pattern `SchoolStateGatesProducer.mjs` uses
 * for its own per-subject assertions (`#nextRevision`, stable assertion id,
 * explicit period bounds, `validUntil`).
 *
 * Field names and value types (`claimTypeId`, epoch-ms `observedAt`/
 * `validFrom`/`validUntil`, epoch-ms `period.startsAt`/`endsAt`) match
 * SchoolStateGatesProducer's own `#observe` call exactly — State Gates'
 * `instant()` support fn requires `Number.isFinite`, so an ISO string is
 * rejected outright.
 *
 * Never throws back to a caller: a failed publish is logged and swallowed,
 * matching the friction-ping HTTP endpoint's fire-and-forget posture.
 */
export class KioskFrictionTracker {
  #ingress; #householdId; #principal; #windowMs; #clock; #logger;
  #eventsByDevice = new Map(); #revisions = new Map();

  constructor({ ingress, householdId, principal, windowMs, clock = () => Date.now(), logger = console }) {
    if (!ingress?.observe) throw new Error('KioskFrictionTracker requires ingress.observe');
    if (!householdId) throw new Error('KioskFrictionTracker requires householdId');
    if (!principal) throw new Error('KioskFrictionTracker requires principal');
    this.#ingress = ingress;
    this.#householdId = householdId;
    this.#principal = principal;
    this.#windowMs = windowMs;
    this.#clock = clock;
    this.#logger = logger;
  }

  #nextRevision(assertionId, observedAt) {
    const candidate = Math.max(1, Math.trunc(observedAt));
    const next = Math.max(candidate, (this.#revisions.get(assertionId) ?? 0) + 1);
    this.#revisions.set(assertionId, next);
    return next;
  }

  async recordFriction({ deviceId, kind }) {
    const at = this.#clock();
    const events = recordFrictionPing(this.#eventsByDevice.get(deviceId) ?? [], { at, windowMs: this.#windowMs });
    this.#eventsByDevice.set(deviceId, events);
    const value = frictionScore(events, { at, windowMs: this.#windowMs });

    const { day, startsAt, endsAt } = utcDayWindow(at);
    const assertionId = `kiosk:friction-score:${deviceId}:${day}`;
    try {
      await this.#ingress.observe(this.#householdId, this.#principal, {
        assertionId,
        claimTypeId: 'kiosk.friction-score',
        subject: { kind: 'device', id: deviceId },
        period: { kind: 'interval', id: `kiosk-day:${deviceId}:${day}`, startsAt, endsAt },
        value,
        sourceRevision: this.#nextRevision(assertionId, at),
        observedAt: at,
        validFrom: at,
        // Decay: the claim naturally goes stale `windowMs` after the LAST
        // ping, well inside the day-long period, so a quiet device re-opens
        // on its own without an active decrement job.
        validUntil: Math.min(at + this.#windowMs, endsAt),
        evidenceRef: `kiosk-friction:${kind ?? 'unknown'}`,
      });
    } catch (error) {
      this.#logger.warn?.('devices.kiosk-friction.publish-failed', { deviceId, kind, error: error.message });
    }
  }
}

export default KioskFrictionTracker;
