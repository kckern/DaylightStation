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
  #realtime; #clock; #logger; #idFactory; #idSequence = 0;
  #idleTimeoutMs; #sweepIntervalMs; #onTimeout; #scheduler; #cancelSweep = null;

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
  }

  /**
   * Arm the idle sweep. Idempotent: composition calls it once at boot, and a
   * second call must not leave a second timer running against the same Map.
   */
  start() {
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
    });
    this.#sessions.set(session.location, session);
    // A fresh session at this reader is a fresh chance to get stuck.
    this.#stuckReported.delete(session.location);
    this.#log('info', 'school.reading.session-open', {
      location: session.location,
      learnerId: session.learnerId,
      sessionId: session.sessionId,
      revision: session.revision,
      replaced: previous?.learnerId ?? null,
    });
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
      pick: null, playing: null, progress: null,
      presentedAt: null, acknowledgedAt: null,
      pendingPresentation: presentation,
      recovery: reason === 'story-finished' ? session.recovery ?? null : { reason, at: this.#clock().toISOString() },
      lastActivityAt: this.#clock().getTime(),
    });
    this.#sessions.set(location, returning);
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
    this.#observe('updated', updated, { state: updated.state, progress: updated.progress ?? null });
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
    this.#ackWaiters.get(session.sessionId)?.(false);
    this.#ackWaiters.get(session.presentationId)?.(false);
    this.#ackWaiters.get(session.pendingPresentation?.sessionId)?.(false);
    this.#ackWaiters.get(session.pendingPresentation?.presentationId)?.(false);
    const revision = this.#nextRevision(session.location);
    this.#stuckReported.delete(location);
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
