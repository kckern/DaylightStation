// backend/src/3_applications/devices/services/KioskFrictionTracker.mjs
import { recordFrictionPing, frictionScore } from '#domains/devices/kioskFrictionWindow.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC calendar-day boundary — friction cooldown does not need household-
 * timezone precision (unlike School's study-day semantics); this is purely
 * for assertion-id/period stability, not curriculum logic, so importing a
 * School domain util here would be the wrong layer dependency anyway.
 *
 * Both the period's `endsAt` (this function) and the published claim's
 * `validUntil` (in #publish, derived from `endsAt`) are UTC-midnight
 * boundaries, NOT the household's local study-day boundary. This is a
 * deliberate, harmless simplification (see the kiosk-friction-detection
 * plan) — a cooldown can therefore end up to a few hours earlier or later
 * than "midnight local time" would suggest. Do not "fix" this by importing
 * School's study-day helpers; that reintroduces the wrong-layer dependency
 * this function's comment above exists to avoid. */
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
 *
 * Publish debouncing: this is the first State Gates publisher driven by raw
 * human-input frequency rather than a daily rollup, and by construction it
 * fires HARDEST during exactly the burst-of-rejected-codes scenario this
 * feature exists to detect — a full State Gates commit (load + parse the
 * whole current-state file, re-derive gate instances, atomic full-file
 * rewrite) on every single ping would mean a 20-wrong-code burst is 20
 * read-parse-dump cycles on a synced data volume, and churns the shared
 * transition journal (capped at 500 entries/7 days, shared with School and
 * Fitness) fastest during exactly the moments other subscribers most need
 * it intact.
 *
 * The in-memory rolling window (`#eventsByDevice`) is updated on EVERY call
 * — the count is never allowed to drift from reality. Only the expensive
 * `ingress.observe` publish is debounced, per device, and only skipped when
 * none of the following hold:
 *   - this is the first ping ever seen for this device (or since it last
 *     went idle long enough to age out of `#windowMs`), or
 *   - this ping crosses the denial threshold in EITHER direction (a real
 *     cooldown must start/end promptly, not sit delayed by debounce), or
 *   - at least `#debounceMs` has elapsed since the last publish attempt.
 * A suppressed ping schedules a single trailing-edge flush (if one isn't
 * already pending) that fires `#debounceMs` after the last publish and
 * re-reads the rolling window AT FIRE TIME — so even if more pings arrive
 * while it waits, the eventual publish still reflects the true, current
 * count, not a stale snapshot from when the timer was set.
 */
export class KioskFrictionTracker {
  #ingress; #householdId; #principal; #windowMs; #clock; #logger; #debounceMs; #denialThreshold; #scheduler;
  // These Maps are never pruned, but growth is bounded by device count ×
  // ~1 entry/day (#revisions keys on the per-device-per-day assertionId) —
  // negligible in absolute terms for a household's kiosk fleet, not truly
  // unbounded.
  #eventsByDevice = new Map(); #revisions = new Map();
  #lastPublishedAt = new Map(); #lastScoreByDevice = new Map();
  #lastKindByDevice = new Map(); #trailingCancels = new Map();

  constructor({
    ingress, householdId, principal, windowMs, clock = () => Date.now(), logger = console,
    // Application-layer code may not call global setTimeout directly
    // (apps-no-global-timers) — the trailing-edge debounce flush goes
    // through this injected IApplicationScheduler port instead (composition
    // wires the real NodeApplicationScheduler; tests inject a fake).
    scheduler,
    // A few seconds: friction pings are gated on a physical human action
    // (a stray tap, a mistyped code), so even a fast, deliberate burst is
    // unlikely to exceed roughly one per second — a 3s debounce collapses
    // a tight burst to about one publish every 3s while staying far below
    // the multi-minute windowMs, so the cooldown boundary itself is never
    // meaningfully delayed by it.
    debounceMs = 3_000,
    // Mirrors the installed policy's `kiosk.friction-ok` gate comparison
    // value (installedStateGatesPolicy.mjs, currently PROVISIONAL) — keep
    // the two in sync if either changes. Only used to decide whether a ping
    // crosses the denial boundary and therefore must publish immediately;
    // it does not otherwise affect the published value.
    denialThreshold = 5,
  } = {}) {
    if (!ingress?.observe) throw new Error('KioskFrictionTracker requires ingress.observe');
    if (!householdId) throw new Error('KioskFrictionTracker requires householdId');
    if (!principal) throw new Error('KioskFrictionTracker requires principal');
    if (!scheduler?.after) throw new Error('KioskFrictionTracker requires scheduler');
    this.#ingress = ingress;
    this.#householdId = householdId;
    this.#principal = principal;
    this.#windowMs = windowMs;
    this.#clock = clock;
    this.#logger = logger;
    this.#scheduler = scheduler;
    this.#debounceMs = debounceMs;
    this.#denialThreshold = denialThreshold;
  }

  #nextRevision(assertionId, observedAt) {
    const candidate = Math.max(1, Math.trunc(observedAt));
    const next = Math.max(candidate, (this.#revisions.get(assertionId) ?? 0) + 1);
    this.#revisions.set(assertionId, next);
    return next;
  }

  async recordFriction({ deviceId, kind }) {
    // The School selfservice API's deviceId resolution returns null for
    // non-panel browser surfaces (confirmed real, not hypothetical) — a
    // reject path can call this with a null/empty deviceId in normal
    // operation. State Gates' SubjectRef rejects a null id, so this would
    // otherwise throw inside the try/catch below (swallowed as a warn) AND
    // pollute #eventsByDevice/#revisions with a shared `null` key across
    // every such caller, corrupting the rolling window for a device
    // identity that was never real. "We don't know which device" is not an
    // error to surface — just drop it.
    if (typeof deviceId !== 'string' || !deviceId.trim()) return;

    const at = this.#clock();
    const events = recordFrictionPing(this.#eventsByDevice.get(deviceId) ?? [], { at, windowMs: this.#windowMs });
    this.#eventsByDevice.set(deviceId, events);
    const value = frictionScore(events, { at, windowMs: this.#windowMs });
    this.#lastKindByDevice.set(deviceId, kind);

    const previousScore = this.#lastScoreByDevice.get(deviceId);
    this.#lastScoreByDevice.set(deviceId, value);
    const crossedThreshold = previousScore !== undefined
      && (previousScore < this.#denialThreshold) !== (value < this.#denialThreshold);

    const lastPublishedAt = this.#lastPublishedAt.get(deviceId);
    const isFirstEver = lastPublishedAt === undefined;
    const dueForPublish = isFirstEver || crossedThreshold || (at - lastPublishedAt) >= this.#debounceMs;

    if (!dueForPublish) {
      this.#scheduleTrailingFlush(deviceId);
      return;
    }

    this.#clearTrailingTimer(deviceId);
    await this.#publish(deviceId, kind, at, value);
  }

  #scheduleTrailingFlush(deviceId) {
    if (this.#trailingCancels.has(deviceId)) return; // already scheduled — it will pick up the freshest value
    const cancel = this.#scheduler.after(this.#debounceMs, () => {
      this.#trailingCancels.delete(deviceId);
      const at = this.#clock();
      const value = frictionScore(this.#eventsByDevice.get(deviceId) ?? [], { at, windowMs: this.#windowMs });
      this.#lastScoreByDevice.set(deviceId, value);
      this.#publish(deviceId, this.#lastKindByDevice.get(deviceId), at, value).catch(() => {});
    });
    this.#trailingCancels.set(deviceId, cancel);
  }

  #clearTrailingTimer(deviceId) {
    const cancel = this.#trailingCancels.get(deviceId);
    if (!cancel) return;
    cancel();
    this.#trailingCancels.delete(deviceId);
  }

  async #publish(deviceId, kind, at, value) {
    const { day, startsAt, endsAt } = utcDayWindow(at);
    const assertionId = `kiosk:friction-score:${deviceId}:${day}`;
    // Recorded before the await, not after success: a failing publish
    // still "counts" as an attempt for debounce purposes, so a State Gates
    // outage doesn't turn every ping into a hot retry loop — first-ping and
    // threshold-crossing triggers still get through immediately regardless.
    this.#lastPublishedAt.set(deviceId, at);
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
