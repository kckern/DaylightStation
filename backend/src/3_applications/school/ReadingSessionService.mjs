/**
 * ReadingSessionService — who is standing at a reader right now.
 *
 * THIS IS NOT EVIDENCE. The reading log is. A session is the answer to one
 * question — "whose screen is this?" — and it is held in memory, per trigger
 * location, for exactly as long as somebody is there. A backend restart loses
 * every session, which is CORRECT: nobody is standing at the reader after a
 * restart, and a session recovered from disk would credit a book to a child
 * who left the room an hour ago.
 *
 * LAST TAP WINS. A second card at the same reader replaces the first outright
 * rather than being refused, because the session IS the screen and the screen
 * belongs to whoever is in front of it. Attribution for a story is settled at
 * PICK time and travels with the pick, so a sibling wandering past mid-story
 * swaps the context without stealing the read.
 *
 * STATE IS STORED; MODE IS NOT. `state` (prompt / confirm / reading) is a fact
 * about this session that nothing else can derive, so it lives here. The
 * assignment/browsing MODE is a pure function of the enrollment and the
 * reading log — it is re-derived on every evaluation and deliberately never
 * written here, so it cannot go stale and it flips by itself the moment the
 * last required story finishes.
 *
 * EVERY BROADCAST IS WRAPPED. `open` is called from a card tap that has to
 * answer; a dead bus costs the screen an update, never the child their
 * session. The same rule the learner response handler holds, for the same
 * reason: a child who taps and sees nothing taps harder.
 *
 * Layer: APPLICATION (3_applications/school).
 *
 * @module applications/school/ReadingSessionService
 */

/** One topic per reader, so a screen subscribes to its own room and nothing else. */
export const readingTopic = (location) => `reading:${location}`;

/** Where a fresh session starts: nothing picked, nothing playing. */
export const PROMPT = 'prompt';

export class ReadingSessionService {
  #sessions = new Map();
  #eventBus; #clock; #logger;

  constructor({ eventBus = null, clock = () => new Date(), logger = console } = {}) {
    this.#eventBus = eventBus;
    this.#clock = clock;
    this.#logger = logger;
  }

  /** @returns {object|null} the frozen session at this location, or null */
  current(location) {
    return this.#sessions.get(location) ?? null;
  }

  /** Every open session, newest state included — for a status endpoint or a sweep. */
  list() {
    return [...this.#sessions.values()];
  }

  /**
   * Open (or replace) the session at a reader.
   *
   * @param {{location: string, learnerId: string, target?: string|null}} a
   * @returns {object} the frozen session
   */
  open({ location, learnerId, target = null } = {}) {
    if (typeof location !== 'string' || !location.trim()) {
      throw new Error('ReadingSessionService.open requires a location');
    }
    if (typeof learnerId !== 'string' || !learnerId.trim()) {
      throw new Error('ReadingSessionService.open requires a learnerId');
    }
    const previous = this.#sessions.get(location) ?? null;
    const session = Object.freeze({
      location: location.trim(),
      learnerId: learnerId.trim(),
      target,
      state: PROMPT,
      openedAt: this.#clock().toISOString(),
    });
    this.#sessions.set(session.location, session);
    this.#log('info', 'school.reading.session-open', {
      location: session.location,
      learnerId: session.learnerId,
      replaced: previous?.learnerId ?? null,
    });
    this.#broadcast(session.location, { event: 'session-open', ...session });
    return session;
  }

  /**
   * Merge a patch into the open session. `location` and `learnerId` are NOT
   * patchable: a different child is a different session, and letting an update
   * rewrite the learner is how a story ends up credited to whoever tapped last
   * rather than whoever picked it. Swapping learners is `open`.
   *
   * @returns {object|null} the updated frozen session, or null if none is open
   */
  update(location, patch = {}) {
    const session = this.#sessions.get(location) ?? null;
    if (!session) return null;
    const { location: _l, learnerId: _w, openedAt: _o, ...safe } = patch || {};
    const updated = Object.freeze({ ...session, ...safe });
    this.#sessions.set(session.location, updated);
    this.#broadcast(session.location, { event: 'session-update', ...updated });
    return updated;
  }

  /**
   * Close the session at a reader.
   *
   * @returns {object|null} the session that was closed, or null if none was open
   */
  close(location, { reason = null } = {}) {
    const session = this.#sessions.get(location) ?? null;
    if (!session) return null;
    this.#sessions.delete(location);
    this.#log('info', 'school.reading.session-close', {
      location: session.location, learnerId: session.learnerId, reason,
    });
    this.#broadcast(session.location, { event: 'session-close', ...session, reason });
    return session;
  }

  #broadcast(location, payload) {
    try {
      this.#eventBus?.broadcast?.(readingTopic(location), payload);
    } catch (err) {
      this.#log('warn', 'school.reading.broadcast-failed', {
        location, event: payload?.event ?? null, error: err?.message ?? String(err),
      });
    }
  }

  /** A broken log transport must not become a broken tap. */
  #log(level, event, data) {
    try { this.#logger?.[level]?.(event, data); } catch { /* the tap outranks the log line */ }
  }
}

export default ReadingSessionService;
