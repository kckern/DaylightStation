/**
 * readingSessionInterceptor — first refusal on a book tap at a reader where a
 * child has a reading session open.
 *
 * THIS IS THE ONE PLACE THE MODE SPLIT LANDS IN CODE. Everything else about
 * assignment vs browsing is derivation; here is the single differing cell of
 * the transition matrix — a book tapped MID-STORY:
 *
 *   assignment  → CLAIM AND REFUSE. Claiming is what stops the tap reaching
 *                 the queue; refusing is what the child sees. One story at a
 *                 time: finish this one first.
 *   browsing    → DO NOT CLAIM. The existing preempt / on-deck rules
 *                 (`ScreenActionHandler.handleMediaQueueOp`) apply exactly as
 *                 they do today, untouched.
 *
 * Every other cell is the same in both modes, which is why the mode is worth
 * having: it collapses "is this child enrolled", "have they finished", and
 * "may they queue a second book" into one derived word.
 *
 * MODE IS DERIVED ON EVERY CLAIM AND NEVER STORED. It is a pure function of
 * the enrollment and the reading log, so it cannot go stale and it flips by
 * itself the moment the last required story finishes. A session field would
 * have to be invalidated by something, and nothing is watching.
 *
 * AN UNKNOWN MODE IS BROWSING. A mode source that throws, or is not wired,
 * answers relaxed — because relaxed IS today's behaviour, and the failure mode
 * of this whole seam must be "the old behaviour", never "the TV does nothing".
 * The same reason a non-enrolled card needs no special case: it is simply
 * always browsing.
 *
 * A CLAIM IS A PROMISE THAT THE SCREEN WILL HANDLE IT. So the broadcast that
 * tells the screen goes out FIRST, and if it cannot be made the tap is handed
 * back to the ordinary dispatch. A claim nobody can act on is the one outcome
 * this feature is not allowed to produce: a child taps, the TV does nothing,
 * and they tap harder.
 *
 * Layer: APPLICATION (3_applications/school).
 *
 * @module applications/school/readingSessionInterceptor
 */
import { readingTopic } from './ReadingSessionService.mjs';

export const CLAIMED_BY = 'reading-session';

/** The states in which a story is on screen and the mode split applies. */
const MID_STORY = new Set(['reading']);

export class ReadingSessionInterceptor {
  #sessions; #storyTime; #eventBus; #clock; #logger;

  /**
   * @param {object} config
   * @param {import('./ReadingSessionService.mjs').ReadingSessionService} config.sessions
   * @param {{status: (a:{userId:string}) => Promise<object>}} [config.storyTime]
   *   the story-time launcher, asked for `{error, count, target}`. Absent or
   *   throwing means browsing.
   */
  constructor({ sessions, storyTime = null, eventBus = null, clock = () => new Date(), logger = console } = {}) {
    if (!sessions) throw new Error('ReadingSessionInterceptor requires a sessions store');
    this.#sessions = sessions;
    this.#storyTime = storyTime;
    this.#eventBus = eventBus;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {object} response  the content Response about to be dispatched
   * @returns {Promise<object|null>} a claim, or null to let it dispatch normally
   */
  async claim(response) {
    if (response?.kind !== 'content') return null;
    const location = response?.location;
    if (!location) return null;
    const session = this.#sessions.current(location);
    if (!session) return null;

    const contentId = response.expression?.contentId ?? null;
    const { learnerId } = session;

    if (MID_STORY.has(session.state)) {
      const mode = await this.#modeFor(learnerId);
      if (mode !== 'assignment') {
        this.#log('info', 'school.reading.book-unclaimed', { location, learnerId, contentId, mode });
        return null;
      }
      if (!this.#broadcast(location, {
        event: 'book-refused', reason: 'finish-this-one', learnerId, location, contentId,
        target: response.target ?? null, at: this.#clock().toISOString(),
      })) return null;
      this.#log('info', 'school.reading.book-refused', { location, learnerId, contentId });
      return { claimed: true, by: CLAIMED_BY, refused: true, reason: 'finish-this-one', learnerId, contentId };
    }

    // PROMPT or CONFIRM: the session owns the screen in BOTH modes. Browsing is
    // relaxed only mid-story; a child who tapped their card still gets their
    // countdown, whatever they owe.
    const pick = { contentId, target: response.target ?? null, at: this.#clock().toISOString() };
    if (!this.#broadcast(location, { event: 'book-selected', learnerId, location, ...pick })) return null;
    this.#sessions.update(location, { state: 'confirm', pick });
    this.#log('info', 'school.reading.book-selected', { location, learnerId, contentId });
    return { claimed: true, by: CLAIMED_BY, learnerId, contentId };
  }

  /**
   * `assignment` only when the obligation is READABLE and UNMET. An `error`
   * status means the enrollment or the log could not be read — which is not
   * the same as "nothing is owed", but it is the only answer that leaves the
   * TV behaving the way it did yesterday.
   */
  async #modeFor(learnerId) {
    try {
      const status = await this.#storyTime?.status?.({ userId: learnerId });
      if (!status || status.error) return 'browsing';
      const { count, target } = status;
      if (!Number.isFinite(count) || !Number.isFinite(target)) return 'browsing';
      return count < target ? 'assignment' : 'browsing';
    } catch (err) {
      this.#log('warn', 'school.reading.mode-undeterminable', {
        learnerId, error: err?.message ?? String(err),
      });
      return 'browsing';
    }
  }

  /** @returns {boolean} whether the screen can actually be told about this claim */
  #broadcast(location, payload) {
    try {
      if (!this.#eventBus?.broadcast) throw new Error('no event bus');
      this.#eventBus.broadcast(readingTopic(location), payload);
      return true;
    } catch (err) {
      this.#log('warn', 'school.reading.claim-abandoned', {
        location, event: payload?.event ?? null, error: err?.message ?? String(err),
      });
      return false;
    }
  }

  #log(level, event, data) {
    try { this.#logger?.[level]?.(event, data); } catch { /* the tap outranks the log line */ }
  }
}

export default ReadingSessionInterceptor;
