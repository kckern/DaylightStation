/**
 * DispatchMedia — hand a unit's media to a screen or a headset (spec §8).
 *
 * Target autonomy is the policy here: a target carries `child_selectable`, and a
 * target a child may not choose simply never prints on their agenda. That is the
 * whole mechanism — there is no second permission check somewhere else, and no
 * way to reach a non-selectable target by scanning harder.
 *
 * The other rule is the third row of the idempotency matrix: **re-scanning the
 * media action mid-play must not dispatch a second time**. It is enforced twice
 * over — `resolveTokenState` will not even call this while the session is
 * `media_dispatched`, and this use case refuses anyway, because a duplicate
 * dispatch means a video restarting under a child who was halfway through it.
 *
 * Starting playback is NEVER completion (§8). Nothing here records progress;
 * `RecordMediaCompletion` owns the other end.
 *
 * ## The checkpoint list rides along with the dispatch
 *
 * A gated unit's `checkpoints:` are handed back HERE, with the dispatch, so the
 * screen that is about to start playing has its gate positions without a second
 * round trip — one fewer request between "the video started" and "the gate is
 * armed" is one fewer window in which a child reaches a stop that nothing is
 * watching for. `already_playing` answers with the list too, which is the case
 * that matters most: a screen that reloaded mid-lesson re-scans, and this is how
 * it re-arms.
 *
 * **Ids and positions only — never the items.** A checkpoint's `items` name bank
 * questions, and the bank holds the ANSWERS; the list travels to a browser a
 * child is sitting in front of. `RecordCheckpointAnswer` serves the questions
 * one at a time, and the grading never leaves the backend. This is the same rule
 * `CurriculumAccess.summarise` states for unit summaries, applied to the one
 * other payload that reaches the same screen.
 *
 * The list is ADVISORY. `RecordMediaCompletion` re-reads the unit and refuses a
 * completion with anything outstanding, so a client that ignores, loses or edits
 * what it is given here gains nothing.
 */
import { reduceSession, createEvent } from '#domains/school/sessions/sessionEvents.mjs';
import { noticeDocument } from '#domains/school/documents/receipts.mjs';

/** States in which handing media to a device still means something. */
const DISPATCHABLE = new Set(['created', 'media_stalled']);

/** Tolerates both spellings; household YAML uses snake_case, code camelCase. */
const isChildSelectable = (target) => target?.childSelectable === true || target?.child_selectable === true;

/**
 * The gate positions, as a screen may see them: `{id, at}` and nothing else.
 * Built by picking the two safe fields rather than by deleting `items` — a
 * later field added to an authored checkpoint then stays behind by default
 * instead of leaking on the day it is introduced.
 *
 * @param {object|null} unit
 * @returns {Array<{id: string, at: number}>|null} null when the unit is
 *   ungated, unreadable, or gone — all three mean "no gate to arm", and the
 *   backend refuses the completion either way.
 */
const publicCheckpoints = (unit) => (Array.isArray(unit?.checkpoints)
  ? unit.checkpoints.map(({ id, at }) => ({ id, at }))
  : null);

/**
 * Normalise the configured target list.
 * @param {Array} raw
 * @returns {Array<{id: string, label: string, childSelectable: boolean}>}
 */
export function normaliseTargets(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((t) => t && typeof t === 'object' && typeof t.id === 'string' && t.id.trim())
    .map((t) => ({ id: t.id.trim(), label: t.label || t.id.trim(), childSelectable: isChildSelectable(t) }));
}

export class DispatchMedia {
  #curriculum; #sessions; #playback; #targets; #clock; #logger;

  /**
   * @param {object} deps
   * @param {import('../CurriculumAccess.mjs').CurriculumAccess} deps.curriculum
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {{dispatch: Function}} deps.playback - playback adapter surface
   *   (`{target, contentId, sessionId, learnerId, durationSec}` -> correlator)
   * @param {Array} [deps.targets] - configured playback targets
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({ curriculum, sessions, playback, targets = [], clock = () => new Date(), logger = console } = {}) {
    if (!curriculum || !sessions || !playback) {
      throw new Error('DispatchMedia requires curriculum, sessions and playback');
    }
    this.#curriculum = curriculum;
    this.#sessions = sessions;
    this.#playback = playback;
    this.#targets = normaliseTargets(targets);
    this.#clock = clock;
    this.#logger = logger;
  }

  /** The targets a child is allowed to pick — what the agenda may print. */
  selectableTargets() {
    return this.#targets.filter((t) => t.childSelectable).map((t) => ({ ...t }));
  }

  /**
   * @param {object} args
   * @param {string} args.sessionId
   * @param {string} [args.target] - defaults to the only child-selectable target
   * @returns {Promise<{ status: 'dispatched'|'already_playing'|'unavailable'|'already_done',
   *                     sessionId: string, dispatchId: string|null, target: string|null,
   *                     contentId: string|null, durationSec: number|null,
   *                     checkpoints: Array<{id: string, at: number}>|null,
   *                     message: string, document: object|null }>}
   */
  async execute({ sessionId, target = null } = {}) {
    const nowIso = this.#clock().toISOString();
    const state = reduceSession(await this.#sessions.readEvents(sessionId));

    if (!state.sessionId) return this.#unavailable(sessionId, 'unknown-session', 'We could not find that work.');

    if (state.state === 'media_dispatched') {
      // The matrix row: no second dispatch, and a friendly answer either way.
      // The list still comes back: this is the reloaded-screen case, and a gate
      // it cannot see is a gate it cannot stop at.
      return {
        status: 'already_playing',
        sessionId,
        dispatchId: state.mediaDispatch?.dispatchId ?? null,
        target: state.mediaDispatch?.target ?? null,
        contentId: state.mediaDispatch?.contentId ?? null,
        durationSec: null,
        checkpoints: publicCheckpoints(await this.#curriculum.getUnit(state.unitId)),
        message: 'It is already playing. Enjoy!',
        document: null,
      };
    }
    if (!DISPATCHABLE.has(state.state)) {
      return {
        status: 'already_done',
        sessionId,
        dispatchId: null,
        target: null,
        contentId: null,
        durationSec: null,
        checkpoints: null,
        message: 'You already watched this one. Scan your card to see what is next.',
        document: noticeDocument({
          id: `watched-${sessionId}`,
          headline: 'Already watched',
          lines: ['Scan your card to see what is next.'],
        }),
      };
    }

    const unit = await this.#curriculum.getUnit(state.unitId);
    const manifest = unit?.media ? await this.#curriculum.getManifest(unit.media) : null;
    if (!manifest) {
      this.#logger.warn?.('school.media.no-manifest', { sessionId, unitId: state.unitId, media: unit?.media ?? null });
      return this.#unavailable(sessionId, 'no-media', 'There is nothing to play for this one. Tell a grown-up.');
    }

    const chosen = this.#chooseTarget(target);
    if (!chosen.ok) return this.#refuseTarget(sessionId, target, chosen.reason);

    let dispatch;
    try {
      dispatch = await this.#playback.dispatch({
        target: chosen.target.id,
        contentId: manifest.locator,
        // The session id travels with the dispatch because a SCREEN target
        // opens the lesson by fetching its own snapshot
        // (`GET /school/lesson/:sessionId`) — see `ScreenPlaybackAdapter`. The
        // adapter cannot derive it and this is the only caller that has it, so
        // it is passed rather than invented. Required by every implementation
        // of the port (`VirtualPlaybackAdapter`, `FakePlayback`) so a caller
        // that forgot it cannot pass the tests and fail in the living room.
        sessionId,
        learnerId: state.learnerId,
        durationSec: manifest.durationSec ?? 0,
      });
    } catch (err) {
      // A device that will not take the content is a retryable failure: the
      // annotation leaves the state (and therefore the ticket) alone.
      const { event } = createEvent({ type: 'failed', at: nowIso, sessionId, stage: 'dispatch', reason: err.message });
      if (event) await this.#sessions.appendEvent(sessionId, event);
      this.#logger.warn?.('school.media.dispatch-failed', { sessionId, target: chosen.target.id, error: err.message });
      return this.#unavailable(sessionId, 'dispatch-failed', `${chosen.target.label} did not answer. Scan your card to try again.`);
    }

    const { errors, event } = createEvent({
      type: 'media_dispatched', at: nowIso, sessionId,
      dispatchId: dispatch.dispatchId, target: chosen.target.id, contentId: manifest.locator,
    });
    if (errors.length) throw new Error(`DispatchMedia: could not record the dispatch: ${errors.join('; ')}`);
    await this.#sessions.appendEvent(sessionId, event);

    this.#logger.info?.('school.media.dispatched', {
      sessionId, unitId: state.unitId, target: chosen.target.id, dispatchId: dispatch.dispatchId,
    });

    return {
      status: 'dispatched',
      sessionId,
      dispatchId: dispatch.dispatchId,
      target: chosen.target.id,
      contentId: manifest.locator,
      durationSec: manifest.durationSec ?? null,
      checkpoints: publicCheckpoints(unit),
      message: `Starting on ${chosen.target.label}.`,
      document: null,
    };
  }

  #chooseTarget(requested) {
    const selectable = this.#targets.filter((t) => t.childSelectable);
    if (requested == null) {
      if (selectable.length === 1) return { ok: true, target: selectable[0] };
      return { ok: false, reason: selectable.length ? 'ambiguous' : 'none_selectable' };
    }
    const known = this.#targets.find((t) => t.id === requested);
    if (!known) return { ok: false, reason: 'unknown' };
    if (!known.childSelectable) return { ok: false, reason: 'not_selectable' };
    return { ok: true, target: known };
  }

  #refuseTarget(sessionId, requested, reason) {
    const lines = {
      none_selectable: 'There is nowhere to play this right now. Tell a grown-up.',
      ambiguous: 'Pick where to play it from your list.',
      unknown: 'We do not know that player.',
      not_selectable: 'That player is not one you can pick. Tell a grown-up.',
    };
    this.#logger.info?.('school.media.target-refused', { sessionId, requested, reason });
    return {
      status: 'unavailable',
      sessionId,
      dispatchId: null,
      target: null,
      contentId: null,
      durationSec: null,
      checkpoints: null,
      message: lines[reason],
      document: noticeDocument({
        id: `target-${reason}-${sessionId}`,
        headline: 'We could not start that',
        lines: [lines[reason], 'Scan your card for a new list.'],
      }),
    };
  }

  #unavailable(sessionId, id, line) {
    return {
      status: 'unavailable',
      sessionId: sessionId ?? null,
      dispatchId: null,
      target: null,
      contentId: null,
      durationSec: null,
      checkpoints: null,
      message: line,
      document: noticeDocument({
        id: `${id}-${sessionId ?? 'none'}`,
        headline: 'We could not start that',
        lines: [line, 'Scan your card for a new list.'],
      }),
    };
  }
}

export default DispatchMedia;
