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
 * THE LAUNCH CARD IS THE ONLY HAND-OFF POINT. A second learner is first
 * presented on the screen, then becomes authoritative only after the screen
 * proves that learner's face was actually painted with no fullscreen overlay
 * above it. A card during confirmation, playback, celebration, or return is a
 * refusal and cannot rotate the session id underneath a finishing story.
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

/** Where a fresh session starts: nothing picked, nothing playing. */
export const PROMPT = 'prompt';
export const STARTING = 'starting';
export const PRESENTING = 'presenting';
export const RETURNING = 'returning';

/** ~2 minutes of quiet. Long enough to fetch a book from the shelf. */
export const DEFAULT_IDLE_TIMEOUT_MS = 120_000;

/** How often the sweep looks. Cheap — a Map walk over at most a few rooms. */
export const DEFAULT_SWEEP_INTERVAL_MS = 15_000;

/**
 * How often the open sessions are written down, when anything has changed.
 *
 * The Map is the living room's state and it lives in this process, so a deploy
 * erases it. On 2026-09-11 one landed four minutes into a 9m40s read-along and
 * the child finished the book into a server that had never heard of his
 * session. `ReadingApiService` now credits the read from the request's own
 * evidence, so the book is not lost either way; this is what keeps the ROOM
 * coherent — the pick still attributable, teardown still owed, no second scan.
 *
 * Five seconds because the thing being protected against is a restart, and
 * losing the last five seconds of a session's life to one costs nothing: the
 * fields that matter (who, which book, which pick) are minutes old by then, and
 * the fields that churn (the playback position, at 10 Hz) are re-reported by
 * the player within a second of it coming back.
 *
 * Structural events — a session opening or closing — do not wait for it.
 */
export const DEFAULT_PERSIST_INTERVAL_MS = 5_000;

/**
 * How long after a teardown a book card may still reclaim the session it
 * belongs to.
 *
 * A child who scans their card, chooses a book off the shelf and scans it is
 * doing ONE thing, and the idle sweep cannot see the middle of it. On
 * 2026-09-11 the sweep closed a session at 17:13:21 and the book landed at
 * 17:13:30 — nine seconds — and the story played with nobody's name on it.
 *
 * Deliberately a fraction of the idle timeout, not a second timeout: this does
 * not keep a room alive, it only lets a tap that was ALREADY in flight land
 * where it was aimed.
 *
 * That "fraction" is enforced, not merely asserted: `idleTimeoutMs` is
 * injectable per instance, so a household configured shorter than this would
 * otherwise get a grace LONGER than its own timeout. The effective grace is
 * clamped to the instance's idle timeout whenever that timeout is positive —
 * see `#reopenGraceMs`.
 */
export const REOPEN_GRACE_MS = 45_000;

/**
 * The states an idle session may be torn down FROM (D6). `reading` is
 * deliberately absent: a 45-minute audiobook is not an idle room, and the
 * whole point of the timeout is to catch the room that is genuinely empty.
 */
const IDLE_STATES = new Set([STARTING, PRESENTING, PROMPT, 'confirm', RETURNING]);

/**
 * How long a session may sit in `reading` before the sweep calls it stuck.
 *
 * `reading` is EXEMPT from teardown on purpose (D6) — a 45-minute audiobook is
 * not an empty room — and that exemption is unbounded, which is the hazard.
 * A session only leaves `reading` when `POST /reading/read` succeeds; if that
 * write fails (on 2026-08-28: a null `learnerId` the screen had frozen at pick
 * time), the state never moves. The idle sweep skips it forever, `suppressEnd`
 * keeps cancelling the room's `end: tv-off`, and the TV stays on all night with
 * nobody in the room. Nothing anywhere reported this.
 *
 * 90 minutes is deliberately well past the longest thing anyone reads along to,
 * so this NEVER fires on a legitimately long story. It does not tear anything
 * down — teardown here would cut off a real audiobook, which is the failure D6
 * exists to prevent. It only says so, loudly, once.
 */
export const STUCK_READING_MS = 90 * 60_000;
/** A running player should report timeupdate every five seconds. */
export const PLAYBACK_STALL_MS = 90_000;
/** Paused media may stay paused, but not own the TV indefinitely. */
export const PAUSED_PLAYBACK_TIMEOUT_MS = 10 * 60_000;
/** An ended event normally follows a near-end progress sample immediately. */
export const TERMINAL_PROGRESS_GRACE_MS = 20_000;
/** Enough context for an operator without turning runtime state into a log DB. */
export const DEFAULT_OBSERVATION_LIMIT = 200;

export class ReadingSessionService {
  #sessions = new Map();
  #revisions = new Map();
  #serverEpoch;
  #ackWaiters = new Map();
  #observations = [];
  #observationStore;
  /** Locations already reported stuck, so the 15s sweep warns once, not always. */
  #stuckReported = new Set();
  /** location -> {session, reason, closedAt}: the last teardown, for the reopen grace. */
  #recentlyClosed = new Map();
  #realtime; #clock; #logger; #idFactory; #idSequence = 0;
  #idleTimeoutMs; #sweepIntervalMs; #onTimeout; #scheduler; #cancelSweep = null;
  #sessionStore; #persistIntervalMs; #cancelPersist = null; #dirty = false;

  /**
   * @param {object} [config]
   * @param {number} [config.idleTimeoutMs] - quiet time before teardown; `0`
   *   disables the timeout entirely (a test rig, or a household that would
   *   rather leave the TV on than risk a false teardown).
   * @param {(session: object) => Promise<void>|void} [config.onTimeout] - the
   *   teardown itself, which in the field is "power the TV off". Injected
   *   because THIS class must not know what a TV is; composition does.
   * @param {import('./ports/IAsyncScheduler.mjs').IAsyncScheduler} config.scheduler
   *   - injected so the timeout can be tested in milliseconds rather than in
   *   the two minutes the field waits. Required because the same deadline is
   *   what advances a missed screen delivery into replay and recovery.
   */
  constructor({
    realtime = null, clock = () => new Date(), idFactory = null, logger = console,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS,
    onTimeout = null,
    scheduler, observationStore = null,
    // Durability across a restart. Optional: absent, the service behaves
    // exactly as it always has — in memory, and forgotten on deploy.
    sessionStore = null,
    persistIntervalMs = DEFAULT_PERSIST_INTERVAL_MS,
  } = {}) {
    const missingSchedulerMethods = ['withDeadline', 'every', 'wait']
      .filter((method) => typeof scheduler?.[method] !== 'function');
    if (missingSchedulerMethods.length) {
      throw new TypeError(`ReadingSessionService requires scheduler methods: ${missingSchedulerMethods.join(', ')}`);
    }
    this.#realtime = realtime;
    this.#clock = clock;
    this.#logger = logger;
    this.#idleTimeoutMs = Number.isFinite(idleTimeoutMs) ? idleTimeoutMs : DEFAULT_IDLE_TIMEOUT_MS;
    this.#sweepIntervalMs = sweepIntervalMs;
    this.#onTimeout = onTimeout;
    this.#scheduler = scheduler;
    this.#idFactory = idFactory;
    this.#serverEpoch = this.#nextId('reading');
    this.#observationStore = observationStore;
    this.#sessionStore = sessionStore;
    this.#persistIntervalMs = Number.isFinite(persistIntervalMs) ? persistIntervalMs : DEFAULT_PERSIST_INTERVAL_MS;
  }

  /**
   * Take back the sessions that were open when this process last wrote.
   *
   * Awaited by composition BEFORE the first request is served, so a card tap
   * that lands during boot cannot open a second session for a room that already
   * has one.
   *
   * REHYDRATED, NOT RESUMED. Nothing is broadcast and no ceremony is re-run: the
   * screen is already showing whatever it was showing, and replaying a
   * presentation at it would restart a story that never stopped. The session is
   * simply back in the Map, where the sweep, the pick lookup and teardown can
   * all find it again.
   *
   * A session restored into a room that has since emptied is not a problem this
   * has to solve — `lastActivityAt` comes back with it, so the idle sweep tears
   * a stale one down on its next pass exactly as it would a live one.
   */
  async hydrate() {
    if (!this.#sessionStore?.load) return this;
    let rows = [];
    try {
      rows = await this.#sessionStore.load();
    } catch (err) {
      this.#log('warn', 'school.reading.sessions-load-failed', { error: err?.message ?? String(err) });
      return this;
    }
    let restored = 0;
    for (const row of rows) {
      if (this.#sessions.has(row.location)) continue;
      this.#sessions.set(row.location, Object.freeze({ ...row }));
      restored += 1;
    }
    if (restored) {
      this.#log('info', 'school.reading.sessions-restored', {
        count: restored,
        locations: rows.map((row) => row.location),
        states: rows.map((row) => row.state ?? null),
        note: 'a restart no longer costs the room its session',
      });
    }
    return this;
  }

  /** Mark the set changed; the persist timer writes it within the interval. */
  #persistSoon() { this.#dirty = true; }

  /**
   * Write the set now. Structural changes — a session opening or closing — do
   * not wait for the timer, because those are the ones a restart landing in the
   * next four seconds would most obviously get wrong.
   */
  #persistNow() {
    this.#dirty = false;
    if (!this.#sessionStore?.save) return;
    // Never awaited by a caller: persistence is a side effect of the room
    // changing, and a slow disk must not hold up a card tap.
    Promise.resolve(this.#sessionStore.save([...this.#sessions.values()]))
      .catch((err) => this.#log('warn', 'school.reading.sessions-save-failed', { error: err?.message ?? String(err) }));
  }

  /**
   * Arm the idle sweep. Idempotent: composition calls it once at boot, and a
   * second call must not leave a second timer running against the same Map.
   */
  start() {
    // The persist timer is armed even when the idle timeout is off: a household
    // that would rather leave the TV on than risk a false teardown still wants
    // its sessions to survive a deploy.
    if (this.#sessionStore?.save && !this.#cancelPersist && this.#persistIntervalMs > 0) {
      this.#cancelPersist = this.#scheduler.every(this.#persistIntervalMs, () => {
        if (this.#dirty) this.#persistNow();
      });
    }
    if (this.#cancelSweep || !this.#idleTimeoutMs) return this;
    this.#cancelSweep = this.#scheduler.every(this.#sweepIntervalMs, () => {
      // Never let a rejected sweep become an unhandled rejection on a timer
      // nobody is awaiting. `sweep` already swallows its own teardown errors;
      // this is the belt to that braces.
      Promise.resolve(this.sweep()).catch((err) => {
        this.#log('warn', 'school.reading.sweep-failed', { error: err?.message ?? String(err) });
      });
    });
    return this;
  }

  /** Disarm the sweep. Safe to call twice, and safe to call having never started. */
  stop() {
    if (this.#cancelPersist) {
      this.#cancelPersist();
      this.#cancelPersist = null;
      // One last write on the way down. A graceful shutdown is the one restart
      // whose timing we DO control, so it should not be the one that loses the
      // last few seconds of the room.
      if (this.#dirty) this.#persistNow();
    }
    if (!this.#cancelSweep) return this;
    this.#cancelSweep();
    this.#cancelSweep = null;
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
    const now = this.#clock().getTime();

    // Playback is special: unlike a prompt, it has a heartbeat.  A failed
    // ended callback must not leave a fake story suppressing room teardown,
    // but a duration wall clock would cut off a perfectly healthy audiobook.
    // Reset only on the absence of observed progress (or an unclosed terminal
    // sample), and never award a read here.
    for (const session of this.#sessions.values()) {
      if (session.state !== 'reading' || !session.progress) continue;
      const progressAt = Date.parse(session.progress.at);
      const age = now - (Number.isFinite(progressAt) ? progressAt : session.lastActivityAt);
      const terminal = Number.isFinite(session.progress.durationSec)
        && session.progress.durationSec > 0
        && Number.isFinite(session.progress.positionSec)
        && session.progress.positionSec >= session.progress.durationSec - 1;
      const expired = terminal ? age > TERMINAL_PROGRESS_GRACE_MS
        : session.progress.paused ? age > PAUSED_PLAYBACK_TIMEOUT_MS
          : age > PLAYBACK_STALL_MS;
      if (!expired) continue;
      this.beginReturn(session.location, {
        reason: terminal ? 'terminal-without-read' : session.progress.paused ? 'paused-too-long' : 'progress-stalled',
      });
      this.#log('warn', 'school.reading.playback-recovered', { location: session.location, learnerId: session.learnerId, terminal, age });
    }

    // STUCK DETECTION RUNS FIRST, AND ABOVE THE IDLE-TIMEOUT GUARD.
    //
    // It sat below `if (!this.#idleTimeoutMs) return closed` in its first
    // version, which quietly disabled the watchdog for any household that had
    // turned the idle timeout off — and a household that would rather leave the
    // TV on than risk a false teardown is EXACTLY the one that needs to be told
    // its living-room session has been parked in `reading` since this morning.
    // A detector switched off by the same setting that creates its failure mode
    // is the quiet-failure pattern this whole watchdog exists to break.
    //
    // Reported, never torn down — see STUCK_READING_MS. Once per session,
    // because the sweep runs every 15s and a warning that repeats 240 times an
    // hour is one nobody reads.
    for (const session of this.#sessions.values()) {
      if (session.state !== 'reading') continue;
      if (now - session.lastActivityAt <= STUCK_READING_MS) continue;
      if (this.#stuckReported.has(session.location)) continue;
      this.#stuckReported.add(session.location);
      this.#log('warn', 'school.reading.session-stuck', {
        location: session.location,
        learnerId: session.learnerId,
        state: session.state,
        idleMs: now - session.lastActivityAt,
        openedAt: session.openedAt,
        consequence: 'idle teardown is exempt here and end: tv-off stays suppressed',
      });
    }

    if (!this.#idleTimeoutMs) return closed;
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

  /**
   * The session torn down at this reader moments ago, or null.
   *
   * READ ONLY WHEN `current()` IS NULL — this is the gap between a teardown and
   * the tap that was already on its way. See `REOPEN_GRACE_MS`.
   *
   * THIS RETURNS EVERY TEARDOWN, and the caller must not treat them alike.
   * Only `reason === 'timeout'` is safe to reopen: that is the sweep cutting a
   * child off mid-action, which is precisely the mistake worth undoing. A
   * `day-done` close is a finished child whose closing ceremony already ran —
   * reopening it re-arms a ceremony that has happened. A bare `close()` records
   * `reason: null` and is likewise not a reopen. The check belongs to the
   * caller, not here, because a diagnostic reader legitimately wants to see
   * what closed at a reader whatever the reason.
   *
   * The window is the instance's effective grace (`#reopenGraceMs`); it is not
   * a parameter, so no caller can widen it.
   *
   * @returns {{session: object, reason: string|null, closedAt: number}|null}
   *   a frozen record, or null if nothing closed here inside the grace.
   */
  recentlyClosed(location) {
    const record = this.#recentlyClosed.get(location) ?? null;
    if (!record) return null;
    if (this.#clock().getTime() - record.closedAt > this.#reopenGraceMs()) return null;
    return record;
  }

  /**
   * The learner this reader was LAST OCCUPIED BY, or null once the room has
   * stopped being theirs.
   *
   * Same record as `recentlyClosed`, read with a second and longer tolerance,
   * because the two answer different questions. `recentlyClosed` measures a
   * FLIGHT TIME: the seconds between a teardown and a book card that was
   * already on its way to the reader, which is a walk to the shelf. This
   * measures how long a child who has been IGNORED keeps trying, which is a
   * different human behaviour and a repeating one. On 2026-09-11 the learner
   * re-tapped 39s after the close and again at 101s; a window tuned for the
   * walk answers the first and not the second.
   *
   * The window is the room's OWN `idleTimeoutMs` — the household's declared
   * answer to "how long does a quiet room still belong to whoever was last in
   * it?", which is precisely the question being asked here, and which retunes
   * itself when that timeout is retuned. It is FLOORED at `REOPEN_GRACE_MS`
   * rather than clamped to it: a child must never get less time to reclaim
   * their room than a book gets to reclaim their session, and a household that
   * disabled the sweep entirely (`0`) still tears sessions down by other roads.
   *
   * LIKE `recentlyClosed`, THIS REPORTS EVERY TEARDOWN and the caller must not
   * treat them alike — see that method's note. The one caller today,
   * `makeReadingSessionHandler`, honours only the reasons that mean the SYSTEM
   * took the room away from a child (`timeout`, `reopen-abandoned`,
   * `presentation-unacknowledged`), never the ones that mean the child handed
   * it back (`day-done`) or that state no provenance at all (`null`).
   *
   * The window is not a parameter, so no caller can widen it.
   *
   * @returns {{session: object, reason: string|null, closedAt: number}|null}
   *   the same frozen record `recentlyClosed` hands out, or null if this room
   *   has stopped belonging to whoever last left it.
   */
  recentlyDeparted(location) {
    const record = this.#recentlyClosed.get(location) ?? null;
    if (!record) return null;
    if (this.#clock().getTime() - record.closedAt > this.#departureGraceMs()) return null;
    return record;
  }

  /**
   * How long a departed learner keeps first claim on the room they left.
   *
   * `Math.max`, deliberately, where `#reopenGraceMs` uses `Math.min`: the
   * reopen grace is a FRACTION of the timeout and must stay one, while this is
   * the timeout itself with the reopen grace as its floor. The two windows are
   * therefore never inverted — a child can always reclaim a room for at least
   * as long as a book can reclaim a session in it.
   */
  #departureGraceMs() {
    return Math.max(this.#idleTimeoutMs > 0 ? this.#idleTimeoutMs : 0, REOPEN_GRACE_MS);
  }

  /**
   * The reopen grace this instance actually honours.
   *
   * Clamped to `idleTimeoutMs` so the grace stays a fraction of the timeout
   * even when a household shortens it. A disabled timeout (`0`) keeps the FULL
   * grace rather than `Math.min(45_000, 0)`: turning the sweep off must not
   * silently turn the reopen off too — a manual `close(…, 'timeout')` in such a
   * household is still a tap worth catching.
   */
  #reopenGraceMs() {
    return this.#idleTimeoutMs > 0
      ? Math.min(REOPEN_GRACE_MS, this.#idleTimeoutMs)
      : REOPEN_GRACE_MS;
  }

  /** A replay-safe read for a screen that mounted or reconnected mid-session. */
  snapshot(location) {
    const key = typeof location === 'string' ? location.trim() : '';
    return Object.freeze({
      location: key,
      session: this.#sessions.get(key) ?? null,
      revision: this.#revisions.get(key) ?? 0,
      serverEpoch: this.#serverEpoch,
    });
  }

  /** Whether the face currently on the launch card is a safe hand-off point. */
  isSwitchable(location) {
    const session = this.#sessions.get(location) ?? null;
    return Boolean(session
      && session.state === PROMPT
      && session.presentedAt
      && !session.pendingPresentation
      && !session.pick
      && !session.playing);
  }

  /**
   * Commit only the exact face presentation the screen says it rendered.
   * A string remains accepted for legacy committed snapshots; new clients
   * send the full compare-and-swap identity.
   */
  acknowledge(location, proof) {
    const session = this.#sessions.get(location) ?? null;
    if (!session) return null;
    const legacySessionId = typeof proof === 'string' ? proof : null;
    const expected = session.pendingPresentation ?? {
      presentationId: session.presentationId,
      sessionId: session.sessionId,
      learnerId: session.learnerId,
      revision: session.revision,
      serverEpoch: session.serverEpoch,
      reason: 'replay',
    };
    const exact = legacySessionId
      ? expected.sessionId === legacySessionId
      : proof
        && expected.presentationId === proof.presentationId
        && expected.sessionId === proof.sessionId
        && expected.learnerId === proof.learnerId
        && expected.revision === proof.revision
        && expected.serverEpoch === proof.serverEpoch;
    if (!exact) return null;

    // Re-ACKing a committed prompt after reconnect is intentionally idempotent.
    if (!session.pendingPresentation && session.state === PROMPT && session.presentedAt) {
      this.#resolveAcknowledgement(expected);
      return session;
    }
    if (!session.pendingPresentation || ![PRESENTING, RETURNING].includes(session.state)) return null;

    const at = this.#clock();
    const presentation = session.pendingPresentation;
    const committed = Object.freeze({
      ...session,
      learnerId: presentation.learnerId,
      target: presentation.target ?? session.target ?? null,
      sessionId: presentation.sessionId,
      state: PROMPT,
      revision: presentation.revision,
      serverEpoch: presentation.serverEpoch,
      presentationId: presentation.presentationId,
      presentedAt: at.toISOString(),
      acknowledgedAt: at.toISOString(),
      pendingPresentation: null,
      openedAt: presentation.reason === 'switch' ? at.toISOString() : session.openedAt,
      lastActivityAt: at.getTime(),
    });
    this.#sessions.set(location, committed);
    this.#persistSoon();
    this.#observe('presentation-acknowledged', committed, {
      presentationId: presentation.presentationId, reason: presentation.reason,
    });
    this.#log('info', 'school.reading.session-switch-rendered', {
      location, learnerId: committed.learnerId, sessionId: committed.sessionId,
      presentationId: committed.presentationId, reason: presentation.reason,
    });
    this.#broadcast(location, { event: 'session-open', ...committed });
    this.#resolveAcknowledgement(presentation);
    return committed;
  }

  /** Wait for the screen that applied a snapshot to prove it is listening. */
  waitForAcknowledgement(token, timeoutMs = 8_000) {
    if (!token) return Promise.resolve(false);
    if ([...this.#sessions.values()].some((session) => session.presentedAt
      && (session.presentationId === token || session.sessionId === token))) {
      return Promise.resolve(true);
    }
    const acknowledgement = new Promise((resolve) => this.#ackWaiters.set(token, resolve));
    return this.#scheduler.withDeadline(acknowledgement, {
      milliseconds: timeoutMs, description: `reading acknowledgement ${token}`,
    }).catch(() => false).finally(() => this.#ackWaiters.delete(token));
  }

  /** Replay the exact presentation; snapshots make this safe for a reload. */
  reannounce(location, token) {
    const session = this.#sessions.get(location) ?? null;
    if (!session) return null;
    const presentation = session.pendingPresentation;
    if (presentation && [presentation.presentationId, presentation.sessionId].includes(token)) {
      this.#broadcast(location, { event: 'session-present', location, ...presentation });
      this.#observe('presentation-reannounced', session, { presentationId: presentation.presentationId });
      return session;
    }
    if (![session.presentationId, session.sessionId].includes(token)) return null;
    this.#broadcast(location, { event: 'session-open', ...session });
    this.#observe('reannounced', session, { sessionId: session.sessionId });
    return session;
  }

  /** A compact, queryable transition timeline for live diagnosis. */
  observations(location, { limit = 50 } = {}) {
    const key = typeof location === 'string' ? location.trim() : '';
    const max = Math.max(1, Math.min(Number(limit) || 50, DEFAULT_OBSERVATION_LIMIT));
    return this.#observations.filter((event) => event.location === key).slice(-max);
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
  open({ location, learnerId, target = null, state = PROMPT } = {}) {
    if (typeof location !== 'string' || !location.trim()) {
      throw new Error('ReadingSessionService.open requires a location');
    }
    if (typeof learnerId !== 'string' || !learnerId.trim()) {
      throw new Error('ReadingSessionService.open requires a learnerId');
    }
    const previous = this.#sessions.get(location) ?? null;
    const at = this.#clock();
    const directPrompt = state === PROMPT;
    const presentationId = directPrompt ? this.#nextId('rp') : null;
    const session = Object.freeze({
      location: location.trim(),
      learnerId: learnerId.trim(),
      target,
      sessionId: this.#nextId('rs'),
      revision: this.#nextRevision(location.trim()),
      serverEpoch: this.#serverEpoch,
      state,
      presentationId,
      // `open(..., prompt)` is retained as a trusted fixture/restore seam.
      // The production card workflow always reserves STARTING and reaches
      // prompt only through a rendered presentation acknowledgement.
      presentedAt: directPrompt ? at.toISOString() : null,
      acknowledgedAt: directPrompt ? at.toISOString() : null,
      pendingPresentation: null,
      openedAt: at.toISOString(),
      // Epoch ms, not an ISO string: the idle sweep compares it on every pass
      // and a re-parse per session per sweep buys nothing. Every tap moves it
      // (see `update`), so a child picking a book is never counted as idle.
      lastActivityAt: at.getTime(),
      // Published so the launch card can DRAW the window it is being judged
      // against. A constant duplicated in the frontend drifts the first time
      // this is tuned, and the screen would then lie about how long a child has.
      idleTimeoutMs: this.#idleTimeoutMs,
    });
    this.#sessions.set(session.location, session);
    // A fresh session at this reader is a fresh chance to get stuck.
    this.#stuckReported.delete(session.location);
    // A live session is never "recently closed" — the reopen grace exists for
    // the gap between sessions and must not survive into one.
    this.#recentlyClosed.delete(session.location);
    this.#log('info', 'school.reading.session-open', {
      location: session.location,
      learnerId: session.learnerId,
      sessionId: session.sessionId,
      revision: session.revision,
      replaced: previous?.learnerId ?? null,
    });
    this.#persistNow();
    this.#observe(state === STARTING ? 'reserved' : 'opened', session, { replacedSessionId: previous?.sessionId ?? null });
    this.#broadcast(session.location, { event: state === STARTING ? 'session-starting' : 'session-open', ...session });
    return session;
  }

  /** Ask the screen to paint a reserved learner; prompt follows its ACK. */
  activate(location, sessionId) {
    const session = this.#sessions.get(location) ?? null;
    if (!session || session.sessionId !== sessionId || session.state !== STARTING) return null;
    const revision = this.#nextRevision(session.location);
    const presentation = Object.freeze({
      presentationId: this.#nextId('rp'), sessionId: session.sessionId,
      learnerId: session.learnerId, target: session.target ?? null,
      revision, serverEpoch: this.#serverEpoch, reason: 'initial',
    });
    const active = Object.freeze({
      ...session, state: PRESENTING, revision,
      presentedAt: null, acknowledgedAt: null, pendingPresentation: presentation,
      lastActivityAt: this.#clock().getTime(),
    });
    this.#sessions.set(location, active);
    this.#persistSoon();
    this.#observe('presentation-requested', active, { presentationId: presentation.presentationId, reason: 'initial' });
    this.#broadcast(location, { event: 'session-present', location, ...presentation });
    return active;
  }

  /** Begin an atomic learner hand-off from an already rendered launch card. */
  beginSwitch({ location, learnerId, target = null } = {}) {
    const session = this.#sessions.get(location) ?? null;
    if (!session || !this.isSwitchable(location)) return null;
    if (typeof learnerId !== 'string' || !learnerId.trim()) return null;
    if (session.learnerId === learnerId.trim()) {
      this.reannounce(location, session.presentationId ?? session.sessionId);
      return Object.freeze({ noChange: true, session, presentation: null });
    }
    const revision = this.#nextRevision(location);
    const presentation = Object.freeze({
      presentationId: this.#nextId('rp'), sessionId: this.#nextId('rs'),
      learnerId: learnerId.trim(), target,
      revision, serverEpoch: this.#serverEpoch, reason: 'switch',
    });
    const pending = Object.freeze({
      ...session, state: PRESENTING, revision,
      pendingPresentation: presentation, lastActivityAt: this.#clock().getTime(),
    });
    this.#sessions.set(location, pending);
    this.#persistSoon();
    this.#observe('switch-requested', pending, {
      presentationId: presentation.presentationId,
      requestedLearnerId: presentation.learnerId,
    });
    this.#log('info', 'school.reading.session-switch-requested', {
      location, currentLearnerId: session.learnerId,
      requestedLearnerId: presentation.learnerId,
      currentSessionId: session.sessionId, requestedSessionId: presentation.sessionId,
      presentationId: presentation.presentationId,
    });
    this.#broadcast(location, { event: 'session-present', location, ...presentation });
    return Object.freeze({ noChange: false, session: pending, presentation });
  }

  /** A finished/recovered story is not switchable until its face returns. */
  beginReturn(location, { reason = 'story-finished' } = {}) {
    const session = this.#sessions.get(location) ?? null;
    if (!session) return null;
    const revision = this.#nextRevision(location);
    const presentation = Object.freeze({
      presentationId: this.#nextId('rp'), sessionId: session.sessionId,
      learnerId: session.learnerId, target: session.target ?? null,
      revision, serverEpoch: this.#serverEpoch, reason: 'return', returnReason: reason,
    });
    const returning = Object.freeze({
      ...session, state: RETURNING, revision,
      pick: null, playing: null, progress: null, onDeck: null,
      presentedAt: null, acknowledgedAt: null,
      pendingPresentation: presentation,
      recovery: reason === 'story-finished' ? session.recovery ?? null : { reason, at: this.#clock().toISOString() },
      lastActivityAt: this.#clock().getTime(),
    });
    this.#sessions.set(location, returning);
    this.#persistSoon();
    this.#observe('return-requested', returning, { presentationId: presentation.presentationId, reason });
    this.#broadcast(location, { event: 'session-present', location, ...presentation });
    return Object.freeze({ session: returning, presentation });
  }

  /** Restore the prior face if a candidate was never visibly acknowledged. */
  rollbackPresentation(location, presentationId) {
    const session = this.#sessions.get(location) ?? null;
    const failed = session?.pendingPresentation ?? null;
    if (!session || failed?.presentationId !== presentationId || failed.reason !== 'switch') return null;
    const revision = this.#nextRevision(location);
    const rollback = Object.freeze({
      presentationId: this.#nextId('rp'), sessionId: session.sessionId,
      learnerId: session.learnerId, target: session.target ?? null,
      revision, serverEpoch: this.#serverEpoch, reason: 'rollback',
    });
    const restoring = Object.freeze({
      ...session, state: PRESENTING, revision, pendingPresentation: rollback,
      lastActivityAt: this.#clock().getTime(),
    });
    this.#sessions.set(location, restoring);
    this.#persistSoon();
    this.#observe('switch-rollback-requested', restoring, {
      failedPresentationId: presentationId, presentationId: rollback.presentationId,
    });
    this.#log('error', 'school.reading.session-switch-unacknowledged', {
      location, currentLearnerId: session.learnerId,
      requestedLearnerId: failed.learnerId, presentationId,
    });
    this.#broadcast(location, { event: 'session-present', location, ...rollback });
    return rollback;
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
    const updated = Object.freeze({
      ...session, ...safe, revision: this.#nextRevision(session.location),
      serverEpoch: this.#serverEpoch, lastActivityAt: this.#clock().getTime(),
    });
    this.#sessions.set(session.location, updated);
    // Throttled, not immediate: `update` carries the 10 Hz playback position.
    this.#persistSoon();
    this.#observe('updated', updated, { state: updated.state, progress: updated.progress ?? null });
    this.#broadcast(session.location, { event: 'session-update', ...updated });
    return updated;
  }

  /**
   * ON DECK: a second book, tapped mid-story in browsing mode, waiting to play.
   *
   * THE QUEUE IS USER-SCOPED. The Player's on-deck slot knows a title; it does
   * not know a child. Before this, a book queued during a story played to the
   * end with nobody's name on it and was never credited: the screen's
   * attribution was frozen to the first pick (rightly — D4), and the second
   * story finished into a guard that had already fired. So the session keeps
   * the scope itself:
   *
   *   - queued  → scoped to the CURRENT learner by default (whoever is at the
   *               reader now — the most recent card);
   *   - a card tapped while it waits RE-SCOPES it to that child (the playing
   *               story keeps its own attribution untouched, D4 holds);
   *   - the moment it starts playing it is frozen into `pick`, like any pick.
   *
   * The pick id is minted here, at queue time, so a re-scope never changes
   * the identity of the thing being re-scoped.
   *
   * @param {string} location
   * @param {{contentId: string, title?: string|null, target?: string|null, learnerId?: string|null}} a
   * @returns {object|null} the updated session, or null with no session
   */
  queueNext(location, { contentId, title = null, target = null, learnerId = null } = {}) {
    const session = this.#sessions.get(location) ?? null;
    if (!session || typeof contentId !== 'string' || !contentId) return null;
    const onDeck = Object.freeze({
      pickId: this.#nextId('pk'), contentId, title,
      learnerId: (typeof learnerId === 'string' && learnerId) ? learnerId : session.learnerId,
      target: target ?? session.target ?? null,
      queuedAt: this.#clock().toISOString(), rescopedAt: null,
    });
    const updated = this.update(location, { onDeck });
    this.#log('info', 'school.reading.on-deck', {
      location, contentId, learnerId: onDeck.learnerId, pickId: onDeck.pickId, sessionId: session.sessionId,
    });
    this.#broadcast(location, { event: 'on-deck', location, sessionId: session.sessionId, ...onDeck });
    return updated;
  }

  /**
   * A card tapped while a book waits on deck: the waiting book becomes that
   * child's. Nothing about the playing story moves.
   * @returns {object|null} the updated session, or null when nothing is on deck
   */
  rescopeOnDeck(location, learnerId) {
    const session = this.#sessions.get(location) ?? null;
    if (!session?.onDeck || typeof learnerId !== 'string' || !learnerId) return null;
    const onDeck = Object.freeze({ ...session.onDeck, learnerId, rescopedAt: this.#clock().toISOString() });
    const updated = this.update(location, { onDeck });
    this.#log('info', 'school.reading.on-deck-rescoped', {
      location, contentId: onDeck.contentId, pickId: onDeck.pickId,
      learnerId, from: session.onDeck.learnerId, sessionId: session.sessionId,
    });
    this.#broadcast(location, { event: 'on-deck-rescoped', location, sessionId: session.sessionId, ...onDeck });
    return updated;
  }

  /**
   * The waiting book takes the stage: the on-deck scope becomes the session's
   * pick — frozen from here, exactly as a countdown pick is — and the session
   * stays open for it rather than returning to the launch card.
   * @returns {object|null} the pick now in force, or null when nothing was on deck
   */
  advanceToOnDeck(location) {
    const session = this.#sessions.get(location) ?? null;
    if (!session?.onDeck) return null;
    const { queuedAt: _q, rescopedAt: _r, ...scope } = session.onDeck;
    const pick = Object.freeze({
      ...scope, studyDay: session.pick?.studyDay ?? null, at: this.#clock().toISOString(),
    });
    const updated = this.update(location, { state: 'confirm', pick, playing: null, progress: null, onDeck: null });
    this.#log('info', 'school.reading.on-deck-advanced', {
      location, contentId: pick.contentId, learnerId: pick.learnerId, pickId: pick.pickId, sessionId: session.sessionId,
    });
    this.#broadcast(location, { event: 'on-deck-advanced', location, sessionId: session.sessionId, ...pick });
    return updated ? pick : null;
  }

  /**
   * Close the session at a reader.
   *
   * @returns {object|null} the session that was closed, or null if none was open
   */
  /**
   * Close a session AND apply the reader's end policy — the same one the idle
   * sweep applies, deliberately.
   *
   * The day-done wind-down and the 2-minute idle timeout are the same event
   * from the TV's point of view ("nobody is using this room any more"), so they
   * must not grow two ways to turn it off. `#onTimeout` is that one path:
   * `makeReadingTimeoutHandler` reads the location's declared `end` policy and
   * calls `tv.turnOff`. The only difference is the reason, which is why the
   * ceremony can end a day in twenty seconds instead of waiting two minutes for
   * a child who has already walked away.
   *
   * @returns {object|null} the session that was closed, or null if none was open
   */
  async end(location, { reason = 'day-done' } = {}) {
    const gone = this.close(location, { reason });
    if (!gone) return null;
    try {
      await this.#onTimeout?.(gone);
    } catch (err) {
      this.#log('warn', 'school.reading.teardown-failed', {
        location: gone.location, reason, error: err?.message ?? String(err),
      });
    }
    return gone;
  }

  close(location, { reason = null } = {}) {
    const session = this.#sessions.get(location) ?? null;
    if (!session) return null;
    this.#sessions.delete(location);
    // Frozen at the point of record, like every other object this class hands
    // out: the reader returns this exact object, and a caller who could write
    // `closedAt` could resurrect an expired session from outside the class.
    this.#recentlyClosed.set(location, Object.freeze({
      session, reason, closedAt: this.#clock().getTime(),
    }));
    this.#ackWaiters.get(session.sessionId)?.(false);
    this.#ackWaiters.get(session.presentationId)?.(false);
    this.#ackWaiters.get(session.pendingPresentation?.sessionId)?.(false);
    this.#ackWaiters.get(session.pendingPresentation?.presentationId)?.(false);
    const revision = this.#nextRevision(session.location);
    this.#stuckReported.delete(location);
    this.#persistNow();
    this.#observe('closed', session, { reason });
    this.#log('info', 'school.reading.session-close', {
      location: session.location, learnerId: session.learnerId, reason,
    });
    this.#broadcast(session.location, {
      event: 'session-close', ...session, revision, serverEpoch: this.#serverEpoch, reason,
    });
    return session;
  }

  #broadcast(location, payload) {
    try {
      const { event: kind, ...announcement } = payload;
      this.#realtime?.readingRoomChanged?.(location, { kind, ...announcement });
    } catch (err) {
      this.#log('warn', 'school.reading.broadcast-failed', {
        location, event: payload?.event ?? null, error: err?.message ?? String(err),
      });
    }
  }

  #nextRevision(location) {
    const next = (this.#revisions.get(location) ?? 0) + 1;
    this.#revisions.set(location, next);
    return next;
  }

  #nextId(prefix) {
    if (this.#idFactory) return this.#idFactory(prefix);
    this.#idSequence += 1;
    return `${prefix}_${this.#clock().getTime().toString(36)}_${this.#idSequence.toString(36)}`;
  }

  #resolveAcknowledgement(presentation) {
    for (const token of [presentation?.presentationId, presentation?.sessionId]) {
      const waiter = token ? this.#ackWaiters.get(token) : null;
      if (waiter) waiter(true);
    }
  }

  #observe(type, session, extra = {}) {
    if (!session?.location) return;
    const at = this.#clock().toISOString();
    this.#observations.push(Object.freeze({
      at, type, location: session.location, sessionId: session.sessionId ?? null,
      learnerId: session.learnerId ?? null, state: session.state ?? null,
      revision: session.revision ?? null, ...extra,
    }));
    if (this.#observations.length > DEFAULT_OBSERVATION_LIMIT) this.#observations.splice(0, this.#observations.length - DEFAULT_OBSERVATION_LIMIT);
    const event = this.#observations.at(-1);
    Promise.resolve(this.#observationStore?.append?.(event)).catch((err) => this.#log('warn', 'school.reading.timeline-write-failed', { error: err?.message ?? String(err) }));
  }

  /** A broken log transport must not become a broken tap. */
  #log(level, event, data) {
    try { this.#logger?.[level]?.(event, data); } catch { /* the tap outranks the log line */ }
  }
}

export default ReadingSessionService;
