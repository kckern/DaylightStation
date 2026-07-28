/**
 * RecordMediaCompletion — the other end of the media handoff (spec §8).
 *
 * **Only completion releases the linked quiz or form.** Starting playback is not
 * completion, and a playhead three quarters of the way through is not either.
 * That single rule is why this use case exists as its own thing rather than as a
 * flag on the dispatch: the question "did the child actually finish it?" has to
 * be answerable from evidence.
 *
 * Two confidences, kept apart on purpose. A screen reports its playhead
 * (`verified: 'playhead'`). A playback-hub headset reports nothing, so the only
 * available evidence is that duration-plus-grace has elapsed with the device
 * still on the content (`verified: 'duration'`). Reports can then tell the two
 * apart instead of pretending they are the same fact.
 *
 * And the session never wedges: no completion by duration + grace becomes
 * `media_stalled`, whose printed next action is "start it again". The clock is
 * injected, so the grace window is testable rather than something that happens
 * to a real child at bedtime.
 */
import { reduceSession, createEvent } from '#domains/school/sessions/sessionEvents.mjs';

const DEFAULT_GRACE_SEC = 600;

export class RecordMediaCompletion {
  #curriculum; #sessions; #clock; #graceSec; #logger;

  /**
   * @param {object} deps
   * @param {import('../CurriculumAccess.mjs').CurriculumAccess} deps.curriculum
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {() => Date} [deps.clock]
   * @param {number} [deps.graceSec] - slack past the media's own duration
   * @param {object} [deps.logger]
   */
  constructor({ curriculum, sessions, clock = () => new Date(), graceSec = DEFAULT_GRACE_SEC, logger = console } = {}) {
    if (!curriculum || !sessions) throw new Error('RecordMediaCompletion requires curriculum and sessions');
    this.#curriculum = curriculum;
    this.#sessions = sessions;
    this.#clock = clock;
    this.#graceSec = graceSec;
    this.#logger = logger;
  }

  /**
   * Record that the media finished.
   *
   * @param {object} args
   * @param {string} [args.sessionId] - when the caller knows it
   * @param {string} [args.learnerId] - with `dispatchId`, when it does not
   * @param {string} [args.dispatchId] - the correlator handed back by the dispatch
   * @param {'playhead'|'duration'} [args.verified]
   * @returns {Promise<{ status: 'completed'|'already_completed'|'uncorrelated'|'not_playing',
   *                     sessionId: string|null, released: boolean, nextAction: object|null, message: string }>}
   */
  async execute({ sessionId = null, learnerId = null, dispatchId = null, verified = 'playhead' } = {}) {
    const nowIso = this.#clock().toISOString();
    const resolved = await this.#resolveSession({ sessionId, learnerId, dispatchId });
    if (!resolved) {
      // A completion nobody asked for: an in-app play with no work session
      // behind it is normal and must stay silent (§8: the Portal player flow is
      // untouched; a session merely records those events when one exists).
      this.#logger.debug?.('school.media.uncorrelated', { sessionId, learnerId, dispatchId });
      return { status: 'uncorrelated', sessionId: null, released: false, nextAction: null, message: 'No school work is waiting on that.' };
    }

    const { id, state } = resolved;
    if (state.mediaDispatch?.status === 'completed') {
      return {
        status: 'already_completed', sessionId: id, released: true,
        nextAction: state.nextAction, message: 'You already finished that one.',
      };
    }
    if (state.state !== 'media_dispatched' && state.state !== 'media_stalled') {
      return {
        status: 'not_playing', sessionId: id, released: false,
        nextAction: state.nextAction, message: 'Nothing is playing for that work.',
      };
    }

    // A stalled session has to be re-dispatched before it can complete: the
    // reducer's table says so, and a late signal for a run that was already
    // written off would otherwise reopen it out of order.
    if (state.state === 'media_stalled') {
      return {
        status: 'not_playing', sessionId: id, released: false,
        nextAction: state.nextAction, message: 'That one was given up on. Scan the ticket to start it again.',
      };
    }

    const { errors, event } = createEvent({ type: 'media_completed', at: nowIso, sessionId: id, verified });
    if (errors.length) throw new Error(`RecordMediaCompletion: could not record completion: ${errors.join('; ')}`);
    await this.#sessions.appendEvent(id, event);

    const next = reduceSession(await this.#sessions.readEvents(id));
    this.#logger.info?.('school.media.completed', { sessionId: id, unitId: next.unitId, verified });
    return {
      status: 'completed',
      sessionId: id,
      released: true,
      nextAction: next.nextAction,
      message: 'Nice. Scan your ticket for the questions.',
    };
  }

  /**
   * Has this dispatch run past its own duration plus the grace window without a
   * completion signal? If so, say so on the record.
   *
   * @param {object} args
   * @param {string} args.sessionId
   * @param {number} [args.graceSec] - overrides the configured window
   * @returns {Promise<{ stalled: boolean, sessionId: string, secondsRemaining: number|null,
   *                     nextAction: object|null, reason: string }>}
   */
  async checkStalled({ sessionId, graceSec = null } = {}) {
    const now = this.#clock();
    const events = await this.#sessions.readEvents(sessionId);
    const state = reduceSession(events);
    if (state.state !== 'media_dispatched') {
      return { stalled: false, sessionId, secondsRemaining: null, nextAction: state.nextAction, reason: 'not_playing' };
    }

    const dispatchedAt = [...events].reverse().find((e) => e.type === 'media_dispatched')?.at;
    const unit = await this.#curriculum.getUnit(state.unitId);
    const manifest = unit?.media ? await this.#curriculum.getManifest(unit.media) : null;
    const durationSec = manifest?.durationSec ?? 0;
    const grace = graceSec ?? this.#graceSec;
    const deadline = Date.parse(dispatchedAt ?? '') + (durationSec + grace) * 1000;
    if (!Number.isFinite(deadline)) {
      return { stalled: false, sessionId, secondsRemaining: null, nextAction: state.nextAction, reason: 'no_dispatch_time' };
    }

    const remainingSec = Math.round((deadline - now.getTime()) / 1000);
    if (remainingSec > 0) {
      return { stalled: false, sessionId, secondsRemaining: remainingSec, nextAction: state.nextAction, reason: 'still_within_window' };
    }

    const { event } = createEvent({
      type: 'media_stalled', at: now.toISOString(), sessionId,
      reason: `no completion after ${durationSec}s + ${grace}s grace`,
    });
    await this.#sessions.appendEvent(sessionId, event);
    const next = reduceSession(await this.#sessions.readEvents(sessionId));
    this.#logger.warn?.('school.media.stalled', { sessionId, unitId: state.unitId, durationSec, graceSec: grace });
    return { stalled: true, sessionId, secondsRemaining: 0, nextAction: next.nextAction, reason: 'timed_out' };
  }

  /**
   * Run the stall check over everything this learner has in flight — what a
   * scheduled sweep (or the next agenda) calls.
   *
   * @param {{learnerId: string, graceSec?: number}} args
   * @returns {Promise<Array<object>>} one result per session that was playing
   */
  async sweepStalled({ learnerId, graceSec = null } = {}) {
    const open = await this.#sessions.listOpenForLearner(learnerId);
    const results = [];
    for (const row of open.filter((r) => r.state === 'media_dispatched')) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await this.checkStalled({ sessionId: row.sessionId, graceSec }));
    }
    return results;
  }

  async #resolveSession({ sessionId, learnerId, dispatchId }) {
    if (sessionId) {
      const state = reduceSession(await this.#sessions.readEvents(sessionId));
      return state.sessionId ? { id: sessionId, state } : null;
    }
    if (!learnerId || !dispatchId) return null;
    const open = await this.#sessions.listOpenForLearner(learnerId);
    for (const row of open) {
      // eslint-disable-next-line no-await-in-loop
      const state = reduceSession(await this.#sessions.readEvents(row.sessionId));
      if (state.mediaDispatch?.dispatchId === dispatchId) return { id: row.sessionId, state };
    }
    return null;
  }
}

export default RecordMediaCompletion;
