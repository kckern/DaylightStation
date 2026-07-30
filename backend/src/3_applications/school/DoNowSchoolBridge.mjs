/**
 * DoNowSchoolBridge — the school lifecycle's subscription to `donow.dispatched`
 * (spec §6 "The approval gap").
 *
 * A `launch:` unit's scan can PEND rather than dispatch immediately (the
 * surface was occupied) — `ResolveScanAction#dispatchLaunch` handles the
 * synchronous `dispatched` case itself (append `launch_dispatched` + honor-
 * close, right there in the same round trip), but a pending request is
 * approved later, out of band, by a grown-up working the approvals queue —
 * nobody is scanning a card at that moment for `ResolveScanAction` to answer.
 * `DoNowService.dispatchApproved` fires the SAME `donow.dispatched` event
 * either way, so this bridge is what closes the loop for the pending path:
 * it subscribes to the `donow` topic and, on approval, does exactly what the
 * synchronous path already did.
 *
 * OWNERSHIP FILTER, BY REPOSITORY LOOKUP — NEVER SHAPE MATCHING. `ref` on the
 * `donow` topic is per-caller (a schoolwork sessionId for `school-scan`, a
 * program id for `school-program`, anything an `api`/`trigger` caller chose).
 * This bridge only ever acts when BOTH:
 *   1. `requestedBy === 'school-scan'` — the provenance this bridge owns.
 *   2. `sessions.readEvents(ref)` resolves to a REAL session this store owns,
 *      sitting at `created` — no session event was written while pending
 *      (spec §6), so a session this bridge is entitled to close is still at
 *      `created` when the approval fires. A stale/unknown ref, or a `ref`
 *      that happens to collide with some OTHER caller's id, reads back as
 *      "not mine" and is ignored by construction — never a shape check on
 *      the payload itself.
 * Anything else (a different `requestedBy`, a ref this store can't resolve,
 * a ref already past `created`) is silently ignored — this bridge never
 * throws on traffic that isn't its own.
 */
import { reduceSession, createEvent } from '#domains/school/sessions/sessionEvents.mjs';

export class DoNowSchoolBridge {
  #eventBus; #sessions; #close; #clock; #logger; #unsubscribe;

  /**
   * @param {object} deps
   * @param {{subscribe: Function}} deps.eventBus - `subscribe(topic, handler): unsubscribe`.
   * @param {import('./ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {import('./usecases/CloseSessionOutcome.mjs').CloseSessionOutcome} deps.closeSessionOutcome
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({
    eventBus, sessions, closeSessionOutcome, clock = () => new Date(), logger = console,
  } = {}) {
    if (!eventBus || typeof eventBus.subscribe !== 'function' || !sessions || !closeSessionOutcome) {
      throw new Error('DoNowSchoolBridge requires eventBus, sessions and closeSessionOutcome');
    }
    this.#eventBus = eventBus;
    this.#sessions = sessions;
    this.#close = closeSessionOutcome;
    this.#clock = clock;
    this.#logger = logger;
    this.#unsubscribe = null;
  }

  /** Subscribe to the `donow` topic. Safe to call more than once — a second call no-ops. */
  start() {
    if (this.#unsubscribe) return;
    // Implicit return (no braces): the handler hands its promise back to the
    // bus. A real fire-and-forget bus never awaits it — this is fine, since
    // nothing here needs to block a broadcast — but a test double CAN await
    // it to observe the async append+honor-close deterministically.
    this.#unsubscribe = this.#eventBus.subscribe('donow', (payload) => this.#handle(payload).catch((err) => {
      this.#logger.warn?.('school.donow-bridge.handler-threw', { error: err?.message ?? String(err) });
    }));
  }

  /** Unsubscribe. Safe to call more than once, and safe to call before `start()`. */
  stop() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  async #handle(payload) {
    if (!payload || payload.type !== 'donow.dispatched' || payload.requestedBy !== 'school-scan') return;
    const sessionId = payload.ref;
    if (!sessionId) return;

    let state;
    try {
      state = reduceSession(await this.#sessions.readEvents(sessionId));
    } catch (err) {
      this.#logger.warn?.('school.donow-bridge.read-failed', { sessionId, error: err?.message ?? String(err) });
      return;
    }

    // Repository lookup, never shape matching: a ref this store cannot
    // resolve to a real session, or one that has already moved past
    // `created` (not ours to close, or already closed), is not acted on.
    if (!state.sessionId || state.state !== 'created') return;

    const { errors, event } = createEvent({
      type: 'launch_dispatched', at: this.#clock().toISOString(), sessionId, surface: payload.surface,
    });
    if (errors.length) {
      this.#logger.warn?.('school.donow-bridge.event-invalid', { sessionId, errors });
      return;
    }
    await this.#sessions.appendEvent(sessionId, event);
    this.#logger.info?.('school.donow-bridge.honor-closed', { sessionId, surface: payload.surface });
    await this.#close.execute({ sessionId, honorClose: true });
  }
}

export default DoNowSchoolBridge;
