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
 *
 * ## THE HARD GATE (spec §8, gated media lessons)
 *
 * The finer-grained version of the same rule: on a unit that authors
 * `checkpoints:`, **a lesson with an uncleared checkpoint has not been
 * completed**, whatever the client says. This is where that guarantee actually
 * lives. `frontend/src/modules/School/lesson/useCheckpointGate.js` deliberately
 * FAILS OPEN on an unusable checkpoint list — blocking there would freeze a
 * video with no question able to release it, and would freeze every ungated
 * lesson too — and the reason that was an acceptable trade is this file. A
 * screen that lost its list, or a child who found a way past a stop, reaches
 * here and is refused. Neither confidence buys a way around it: a playhead at
 * the end of the video and a duration timer that has run out are both evidence
 * about TIME, and a checkpoint is a question about COMPREHENSION.
 *
 * Three judgements, recorded because each had a plausible opposite:
 *
 *  1. **An unresolvable unit completes.** If `getUnit` answers null — the unit
 *     was withdrawn, or edited into invalidity while a child watched — we
 *     cannot know what was owed. Refusing there wedges the session with NO
 *     EXIT: the same missing unit means `RecordCheckpointAnswer` answers
 *     `not_gated` (no question can be asked, so none can be cleared) and
 *     `DispatchMedia` answers `unavailable` (nothing to replay). The child
 *     would be left holding a lesson they finished and a quiz that never
 *     unlocks. It is also not a hole a child can open: the unit id comes off
 *     the session's own `created` event, never off the request. So it fails
 *     open, loudly, at `warn`.
 *  2. **A curriculum read that THREW propagates.** A null is durable — it will
 *     still be null on the retry — while a throw is a blip, and the caller can
 *     simply post the completion again. Completing off a transient catalog
 *     error would skip a gate that is still perfectly well authored.
 *  3. **`media_stalled` still cannot complete**, exactly as before. It is not a
 *     policy choice this file is free to make: `TRANSITIONS` has no
 *     `media_stalled -> media_completed` edge, so the reducer would record a
 *     violation and the datastore would refuse the write. The real problem it
 *     points at — a gated lesson stalling merely because a child was thinking —
 *     is fixed where it is caused, in `checkStalled` below.
 */
import { reduceSession, createEvent } from '#domains/school/sessions/sessionEvents.mjs';
import { clearedSetFrom, seekCeilingFor } from '#domains/school/mediaCheckpoints.mjs';

const DEFAULT_GRACE_SEC = 600;

/**
 * Extra stall grace per authored checkpoint.
 *
 * A gated lesson takes longer than its own running time BY DESIGN — that is
 * what the gates are for — so measuring it against `duration + grace` writes
 * off healthy lessons. The domain already concedes the arithmetic: a 20-minute
 * lesson with five gates, at a couple of minutes per gate, is stalled at
 * exactly the moment an attentive child finishes it (see `ANNOTATION_STATES`
 * in `sessionEvents.mjs`, which accepts clears from `media_stalled` for this
 * very reason). Three minutes a gate is generous next to a child answering and
 * short next to a child who wandered off, and stalling too EARLY is the
 * expensive mistake: it throws away a lesson that was going fine and refuses
 * the completion when it arrives.
 */
const CHECKPOINT_GRACE_SEC = 180;

export class RecordMediaCompletion {
  static CHECKPOINT_GRACE_SEC = CHECKPOINT_GRACE_SEC;

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
   * @returns {Promise<{ status: 'completed'|'already_completed'|'uncorrelated'|'not_playing'
   *                             |'checkpoints_outstanding',
   *                     sessionId: string|null, released: boolean, nextAction: object|null, message: string }>}
   *   `checkpoints_outstanding` alone carries two extra fields — `outstanding`
   *   (how many stops are still owed) and `seekCeiling` (the `at` of the first
   *   of them, i.e. where the screen must send the playhead back to). They are
   *   deliberately NOT added to the other branches: every existing caller and
   *   every ungated lesson keeps the payload it has always had.
   * @throws when the curriculum read itself fails (see judgement 2 in the
   *   header) — a blip is retryable, and nothing is appended before it.
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

    // THE HARD GATE. Last check before anything is written, so a refusal
    // leaves the event stream exactly as it found it.
    const outstanding = await this.#outstandingCheckpoints(id, state);
    if (outstanding) {
      const { count, seekCeiling } = outstanding;
      // `duration` on a gated unit says more than "refused": the only device
      // that reports duration-confidence is a headset, which cannot ask a
      // question at all — so a gated lesson is playing somewhere it can never
      // be finished, and a grown-up needs to see that.
      this.#logger[verified === 'duration' ? 'warn' : 'info']?.('school.media.checkpoints-outstanding', {
        sessionId: id, unitId: state.unitId, outstanding: count, seekCeiling, verified,
      });
      return {
        status: 'checkpoints_outstanding',
        sessionId: id,
        released: false,
        nextAction: state.nextAction,
        outstanding: count,
        seekCeiling,
        message: count === 1
          ? 'Almost! One question stop is still waiting — rewind to it, answer it, and this one counts.'
          : `Almost! ${count} question stops are still waiting — rewind to them, answer them, and this one counts.`,
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
    // A gated lesson gets its gates' worth of extra window — on top of whatever
    // grace the caller chose, because the allowance is a fact about the LESSON
    // rather than a knob on the sweep. An ungated unit adds zero and is
    // therefore unchanged, to the second.
    const gateCount = Array.isArray(unit?.checkpoints) ? unit.checkpoints.length : 0;
    const grace = (graceSec ?? this.#graceSec) + gateCount * CHECKPOINT_GRACE_SEC;
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

  /**
   * The stops this session still owes, or null when it owes none — which is
   * also the answer for an ungated unit and for one that cannot be read at all
   * (judgement 1 in the header).
   *
   * @param {string} sessionId
   * @param {object} state - the reduced session
   * @returns {Promise<{count: number, seekCeiling: number|null}|null>}
   */
  async #outstandingCheckpoints(sessionId, state) {
    const unit = await this.#curriculum.getUnit(state.unitId);
    if (!unit) {
      this.#logger.warn?.('school.media.completion-unit-unresolvable', { sessionId, unitId: state.unitId });
      return null;
    }
    const checkpoints = Array.isArray(unit.checkpoints) ? unit.checkpoints : null;
    if (!checkpoints) return null;

    // `clearedSetFrom` degrades a malformed row to "not cleared" — i.e. still
    // owed. Erring toward re-asking is the safe direction for a gate, and it is
    // the same direction the domain chose.
    const cleared = clearedSetFrom(state.clearedCheckpoints);
    const count = checkpoints.filter((cp) => !cleared.has(cp.id)).length;
    return count ? { count, seekCeiling: seekCeilingFor(checkpoints, cleared) } : null;
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
