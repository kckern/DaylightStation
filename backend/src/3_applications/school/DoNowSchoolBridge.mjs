/**
 * Settles an out-of-band approved School launch. The realtime gateway supplies
 * only approved School-owned dispatch facts; this workflow still verifies the
 * referenced session exists and remains `created` before honor-closing it.
 */
import { reduceSession, createEvent } from '#domains/school/sessions/sessionEvents.mjs';

export class DoNowSchoolBridge {
  #realtime; #sessions; #close; #clock; #logger; #unsubscribe;

  /**
   * @param {object} deps
   * @param {{onApprovedLaunchDispatched: Function}} deps.realtime
   * @param {import('./ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {import('./usecases/CloseSessionOutcome.mjs').CloseSessionOutcome} deps.closeSessionOutcome
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({
    realtime, sessions, closeSessionOutcome, clock = () => new Date(), logger = console,
  } = {}) {
    if (!realtime?.onApprovedLaunchDispatched || !sessions || !closeSessionOutcome) {
      throw new Error('DoNowSchoolBridge requires realtime, sessions and closeSessionOutcome');
    }
    this.#realtime = realtime;
    this.#sessions = sessions;
    this.#close = closeSessionOutcome;
    this.#clock = clock;
    this.#logger = logger;
    this.#unsubscribe = null;
  }

  /** Observe approved launches. Safe to call more than once. */
  start() {
    if (this.#unsubscribe) return;
    // Implicit return (no braces): the handler hands its promise back to the
    // bus. A real fire-and-forget bus never awaits it — this is fine, since
    // nothing here needs to block a broadcast — but a test double CAN await
    // it to observe the async append+honor-close deterministically.
    this.#unsubscribe = this.#realtime.onApprovedLaunchDispatched((payload) => this.#handle(payload).catch((err) => {
      this.#logger.warn?.('school.donow-bridge.handler-threw', { error: err?.message ?? String(err) });
    }));
  }

  /** Unsubscribe. Safe to call more than once, and safe to call before `start()`. */
  stop() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  async #handle(payload) {
    const sessionId = payload?.sessionId;
    if (!sessionId) return;

    let state;
    try {
      state = reduceSession(await this.#sessions.readEvents(sessionId));
    } catch (err) {
      this.#logger.warn?.('school.donow-bridge.read-failed', { sessionId, error: err?.message ?? String(err) });
      return;
    }

    // Belt-and-braces (see class doc): a ref this store cannot resolve to a
    // real session, or one that has already moved past `created` (not ours
    // to close, or already closed by a prior/duplicate approval), is not
    // acted on.
    if (!state.sessionId || state.state !== 'created') return;

    const { errors, event } = createEvent({
      type: 'launch_dispatched', at: this.#clock().toISOString(), sessionId,
      surface: payload.surface, decision: 'dispatched', approvalId: payload.approvalId ?? null,
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
