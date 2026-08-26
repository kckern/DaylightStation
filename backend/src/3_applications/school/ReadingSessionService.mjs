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
 * AN IDLE SESSION ENDS ITSELF (D6). Two minutes of quiet at the prompt or the
 * countdown and the sweep tears it down — the same teardown a finished session
 * runs. Without it the failure is silent in both directions: the living-room TV
 * stays on all night, and tomorrow's first card tap lands in a session
 * belonging to a child who left the room. `reading` is exempt, because a
 * 45-minute audiobook is not an empty room. Both the clock and the sweep timer
 * are injected, so the behaviour is testable in milliseconds.
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

/** ~2 minutes of quiet. Long enough to fetch a book from the shelf. */
export const DEFAULT_IDLE_TIMEOUT_MS = 120_000;

/** How often the sweep looks. Cheap — a Map walk over at most a few rooms. */
export const DEFAULT_SWEEP_INTERVAL_MS = 15_000;

/**
 * The states an idle session may be torn down FROM (D6). `reading` is
 * deliberately absent: a 45-minute audiobook is not an idle room, and the
 * whole point of the timeout is to catch the room that is genuinely empty.
 */
const IDLE_STATES = new Set(['prompt', 'confirm']);

export class ReadingSessionService {
  #sessions = new Map();
  #eventBus; #clock; #logger;
  #idleTimeoutMs; #sweepIntervalMs; #onTimeout; #scheduler; #timer = null;

  /**
   * @param {object} [config]
   * @param {number} [config.idleTimeoutMs] - quiet time before teardown; `0`
   *   disables the timeout entirely (a test rig, or a household that would
   *   rather leave the TV on than risk a false teardown).
   * @param {(session: object) => Promise<void>|void} [config.onTimeout] - the
   *   teardown itself, which in the field is "power the TV off". Injected
   *   because THIS class must not know what a TV is; composition does.
   * @param {{setInterval: Function, clearInterval: Function}} [config.scheduler]
   *   - injected so the timeout can be tested in milliseconds rather than in
   *   the two minutes the field waits.
   */
  constructor({
    eventBus = null, clock = () => new Date(), logger = console,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS,
    onTimeout = null,
    scheduler = { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval },
  } = {}) {
    this.#eventBus = eventBus;
    this.#clock = clock;
    this.#logger = logger;
    this.#idleTimeoutMs = Number.isFinite(idleTimeoutMs) ? idleTimeoutMs : DEFAULT_IDLE_TIMEOUT_MS;
    this.#sweepIntervalMs = sweepIntervalMs;
    this.#onTimeout = onTimeout;
    this.#scheduler = scheduler;
  }

  /**
   * Arm the idle sweep. Idempotent: composition calls it once at boot, and a
   * second call must not leave a second timer running against the same Map.
   */
  start() {
    if (this.#timer || !this.#idleTimeoutMs) return this;
    this.#timer = this.#scheduler.setInterval(() => {
      // Never let a rejected sweep become an unhandled rejection on a timer
      // nobody is awaiting. `sweep` already swallows its own teardown errors;
      // this is the belt to that braces.
      Promise.resolve(this.sweep()).catch((err) => {
        this.#log('warn', 'school.reading.sweep-failed', { error: err?.message ?? String(err) });
      });
    }, this.#sweepIntervalMs);
    // A sweep timer must never hold the process open on its own account.
    this.#timer?.unref?.();
    return this;
  }

  /** Disarm the sweep. Safe to call twice, and safe to call having never started. */
  stop() {
    if (!this.#timer) return this;
    this.#scheduler.clearInterval(this.#timer);
    this.#timer = null;
    return this;
  }

  /**
   * Close every session that has sat quiet past the timeout (D6).
   *
   * TEARDOWN IS TRIED, THE CLOSE IS CERTAIN. A TV that will not answer is not
   * a reason to keep a stale session alive — the next card tapped at that
   * reader would land in a session belonging to a child who left, and
   * attribution is the one thing this feature cannot get wrong quietly. So the
   * close happens whatever the teardown does, and a failed teardown is a log
   * line rather than a stuck room.
   *
   * @returns {Promise<object[]>} the sessions that were torn down
   */
  async sweep() {
    const closed = [];
    if (!this.#idleTimeoutMs) return closed;
    const now = this.#clock().getTime();
    for (const session of [...this.#sessions.values()]) {
      if (!IDLE_STATES.has(session.state)) continue;
      if (now - session.lastActivityAt <= this.#idleTimeoutMs) continue;
      // Close FIRST, so a second sweep landing on top of a slow teardown
      // cannot tear the same session down twice.
      const gone = this.close(session.location, { reason: 'timeout' });
      if (!gone) continue;
      closed.push(gone);
      this.#log('info', 'school.reading.session-timeout', {
        location: gone.location, learnerId: gone.learnerId, idleMs: now - session.lastActivityAt,
      });
      try {
        await this.#onTimeout?.(gone);
      } catch (err) {
        this.#log('warn', 'school.reading.teardown-failed', {
          location: gone.location, error: err?.message ?? String(err),
        });
      }
    }
    return closed;
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
    const at = this.#clock();
    const session = Object.freeze({
      location: location.trim(),
      learnerId: learnerId.trim(),
      target,
      state: PROMPT,
      openedAt: at.toISOString(),
      // Epoch ms, not an ISO string: the idle sweep compares it on every pass
      // and a re-parse per session per sweep buys nothing. Every tap moves it
      // (see `update`), so a child picking a book is never counted as idle.
      lastActivityAt: at.getTime(),
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
    const { location: _l, learnerId: _w, openedAt: _o, lastActivityAt: _a, ...safe } = patch || {};
    // Any update IS activity — a pick, a swap, the first frame of a story.
    // `lastActivityAt` is not patchable for the same reason `learnerId` is not:
    // a caller that could hand in its own value could hold a dead session open
    // forever, and the timeout is what stops the TV running all night (D6).
    const updated = Object.freeze({ ...session, ...safe, lastActivityAt: this.#clock().getTime() });
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
