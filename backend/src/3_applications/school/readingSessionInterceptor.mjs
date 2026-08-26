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
 * AN UNKNOWN MODE IS BROWSING, BUT IT IS NOT SILENT. A mode source that throws,
 * or answers `error`, still relaxes — because relaxed IS today's behaviour, and
 * the failure mode of this whole seam must be "the old behaviour", never "the
 * TV does nothing" — but it also broadcasts `session-error` so the screen can
 * SAY the obligation could not be read (§9: never silently downgraded).
 *
 * NOT ENROLLED IS A DIFFERENT ANSWER FROM UNREADABLE, and telling them apart is
 * why `StoryTimeProgramLauncher.status()` carries `enrolled`. A child with no
 * story-time enrollment is browsing and nothing is wrong — no banner, no noise
 * (D1). A child whose log went unreadable is ALSO browsing, because refusing
 * their book on a guess would be worse, but that one is a fault and it shows.
 * While the two shared one answer, an unreadable log switched a mid-assignment
 * child's hardening off with nothing anywhere to say so.
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

/**
 * Neither `assignment` nor `browsing`: the obligation could not be READ. It is
 * played like browsing and reported like a fault — see `#modeFor`.
 */
const MODE_UNREADABLE = 'unreadable';

export class ReadingSessionInterceptor {
  #sessions; #storyTime; #eventBus; #clock; #logger;

  /**
   * @param {object} config
   * @param {import('./ReadingSessionService.mjs').ReadingSessionService} config.sessions
   * @param {{status: (a:{userId:string}) => Promise<object>}} [config.storyTime]
   *   the story-time launcher, asked for `{error, enrolled, count, target}`.
   *   Absent means browsing, silently; `error` (or a throw) means browsing WITH
   *   a `session-error` on screen. See `#modeFor`.
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
      if (mode === MODE_UNREADABLE) {
        // Relaxed, like browsing — but said out loud. The book is handed back
        // to the ordinary dispatch either way; the difference is only whether
        // the room is told that the obligation could not be read.
        this.#broadcast(location, {
          event: 'session-error', reason: 'obligation-unreadable', learnerId, location,
          contentId, at: this.#clock().toISOString(),
        });
        this.#log('warn', 'school.reading.obligation-unreadable', { location, learnerId, contentId });
        return null;
      }
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
   * THREE answers, not two. `assignment` only when the obligation is READABLE
   * and UNMET; `browsing` when it is readable and there is nothing owed —
   * including a learner with no enrollment at all, which is an ordinary state
   * and not a fault; `unreadable` when nobody can say. That last one behaves
   * like browsing and is REPORTED like a fault, which is the only combination
   * that neither refuses a child's book on a guess nor lies about the state of
   * their obligation.
   *
   * No mode source wired at all is browsing, silently: a household composed
   * without a story-time launcher is not a household with a broken one.
   */
  async #modeFor(learnerId) {
    if (!this.#storyTime?.status) return 'browsing';
    try {
      const status = await this.#storyTime.status({ userId: learnerId });
      if (!status) return MODE_UNREADABLE;
      if (status.error) return MODE_UNREADABLE;
      // Enrolled in nothing owes nothing. Asked and answered — not a fault.
      if (status.enrolled === false) return 'browsing';
      const { count, target } = status;
      if (!Number.isFinite(count) || !Number.isFinite(target)) return MODE_UNREADABLE;
      return count < target ? 'assignment' : 'browsing';
    } catch (err) {
      this.#log('warn', 'school.reading.mode-undeterminable', {
        learnerId, error: err?.message ?? String(err),
      });
      return MODE_UNREADABLE;
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
