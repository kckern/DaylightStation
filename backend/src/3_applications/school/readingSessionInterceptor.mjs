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

const mintPickId = () => `pick_${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`;

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

    if (session.state === 'starting') {
      this.#broadcast(location, {
        event: 'book-refused', reason: 'screen-starting', learnerId, location, contentId,
        at: this.#clock().toISOString(),
      });
      return { claimed: true, by: CLAIMED_BY, refused: true, reason: 'screen-starting', learnerId, contentId };
    }

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
    const samePick = session.state === 'confirm' && session.pick?.contentId === contentId;
    const pick = samePick ? session.pick : {
      pickId: mintPickId(), learnerId, contentId, target: response.target ?? null,
      studyDay: this.#storyTime?.studyDay?.() ?? null, at: this.#clock().toISOString(),
    };
    if (!this.#broadcast(location, { event: 'book-selected', learnerId, location, sessionId: session.sessionId, ...pick })) return null;
    this.#sessions.update(location, { state: 'confirm', pick });
    this.#log('info', 'school.reading.book-selected', { location, learnerId, contentId });
    return { claimed: true, by: CLAIMED_BY, learnerId, contentId };
  }

  /**
   * D9 — an unregistered book tag tapped inside a session.
   *
   * THIS CANNOT BE A CLAIM, and that is why it is a separate door. A tag that
   * resolves to nothing never becomes a content `Response` at all: it
   * dead-ends in the dispatcher's unknown-tag path, above the interceptor
   * seam, so `claim` is never called and never will be. The screen has handled
   * `book-unknown` since the widget shipped with nothing anywhere producing
   * it, and the child tapping a book saw the TV do nothing while a push
   * arrived on a phone in another room.
   *
   * IT ADDS, IT DOES NOT REPLACE. The observed-registry write and the
   * `notify_unknown` push are what actually get the book enrolled; the caller
   * does both regardless of what this answers, and this is only the half the
   * four-year-old can see.
   *
   * TOTAL AND SYNCHRONOUS. It runs on the tap path with nothing to await it,
   * so a throw here would surface as an unhandled rejection on a code path
   * whose entire job is to be reliable about tags nobody knows.
   *
   * @param {{location?: string, tagUid?: string}} info
   * @returns {boolean} whether the room was actually told
   */
  noteUnknownTag(info) {
    try {
      const location = info?.location;
      if (!location) return false;
      const session = this.#sessions.current(location);
      if (!session) return false;
      const told = this.#broadcast(location, {
        event: 'book-unknown', tagUid: info?.tagUid ?? null, location,
        learnerId: session.learnerId, at: this.#clock().toISOString(),
      });
      this.#log('info', 'school.reading.book-unknown', {
        location, learnerId: session.learnerId, tagUid: info?.tagUid ?? null, told,
      });
      return told;
    } catch (err) {
      this.#log('warn', 'school.reading.book-unknown-failed', {
        location: info?.location ?? null, error: err?.message ?? String(err),
      });
      return false;
    }
  }

  /**
   * D8 — the seam's OTHER question: may this dispatch keep the reader
   * location's `end` behaviour?
   *
   * `livingroom` is configured `end: tv-off`, and that is right for every tap
   * that is not part of a reading session. While one is open it is a hazard:
   * the TV would power off the instant a story ends, which is before the
   * ceremony renders and with a child still standing at the reader. So the
   * session takes the location's teardown away for as long as it is open and
   * runs its own — after the ceremony, or when the room has actually gone
   * quiet (D6).
   *
   * SUPPRESSION IS NOT CLAIMING, and the taps that need it are precisely the
   * ones `claim` handed back: a browsing-mode second book, and a mid-story tap
   * whose obligation could not be read. Both still play. Neither may take the
   * lights with it.
   *
   * IT ASKS ONLY WHETHER A SESSION IS OPEN — never the mode, never the state.
   * A mode decides who may claim a book; it has nothing to say about whether a
   * child is in the room. Synchronous and total: the caller evaluates this on
   * the dispatch path, and an answer it has to await (or catch) is an answer
   * that can arrive after the TV is already off.
   *
   * @param {object} response the content Response about to be dispatched
   * @returns {boolean}
   */
  suppressEnd(response) {
    if (response?.kind !== 'content') return false;
    const location = response?.location;
    if (!location) return false;
    const session = this.#sessions.current(location);
    if (!session) return false;
    // "WHY DIDN'T THE TV TURN OFF?" — this is the answer, and it used to be
    // unlogged. Taking the location's `end: tv-off` away is the single most
    // consequential thing this seam does to a room, and it is invisible from
    // the outside: nothing else in the house reports that a teardown was
    // cancelled. On 2026-08-28 a session stuck in `reading` (the idle sweep
    // exempts that state on purpose) suppressed the teardown indefinitely and
    // the living-room TV stayed on with nobody in the room.
    //
    // `sessionState` is the field that makes it diagnosable rather than merely
    // observable: suppressing under `prompt` is the feature working, and
    // suppressing under `reading` long after a story should have ended is the
    // fault. The state is what tells them apart.
    this.#log('info', 'school.reading.end-suppressed', {
      location,
      learnerId: session.learnerId,
      sessionState: session.state,
      openedAt: session.openedAt,
    });
    return true;
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
