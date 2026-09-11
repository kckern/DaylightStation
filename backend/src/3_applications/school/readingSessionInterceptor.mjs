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
export const CLAIMED_BY = 'reading-session';

/** The states in which a story is on screen and the mode split applies. */
const MID_STORY = new Set(['reading']);

/**
 * Neither `assignment` nor `browsing`: the obligation could not be READ. It is
 * played like browsing and reported like a fault — see `#modeFor`.
 */
const MODE_UNREADABLE = 'unreadable';

export class ReadingSessionInterceptor {
  #sessions; #storyTime; #realtime; #wakeScreen; #clock; #logger; #idFactory; #idSequence = 0;

  /**
   * @param {object} config
   * @param {import('./ReadingSessionService.mjs').ReadingSessionService} config.sessions
   * @param {{status: (a:{userId:string}) => Promise<object>}} [config.storyTime]
   *   the story-time launcher, asked for `{error, enrolled, count, target}`.
   *   Absent means browsing, silently; `error` (or a throw) means browsing WITH
   *   a `session-error` on screen. See `#modeFor`.
   * @param {(a: {target: string, location: string}) => Promise<object>} [config.wakeScreen]
   *   power the reader's screen on and bring the kiosk forward. Used by ONE
   *   path — `#reopenIfJustClosed` — and read its header for why. Deliberately
   *   NOT a content load: the reading widget is already mounted, and reloading
   *   the page would drop the very WebSocket carrying the `session-open` the
   *   reopen just broadcast to it. Absent means no wake, exactly as before.
   */
  constructor({ sessions, storyTime = null, realtime = null, wakeScreen = null, clock = () => new Date(), idFactory = null, logger = console } = {}) {
    if (!sessions) throw new Error('ReadingSessionInterceptor requires a sessions store');
    this.#sessions = sessions;
    this.#storyTime = storyTime;
    this.#realtime = realtime;
    this.#wakeScreen = wakeScreen;
    this.#clock = clock;
    this.#idFactory = idFactory;
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
    // `reopened` is held separately from `session` because it is the ONLY one
    // this call is allowed to undo. A session that was already open belongs to
    // a child standing at the reader and survives any answer given here.
    const current = this.#sessions.current(location);
    const reopened = current ? null : this.#reopenIfJustClosed(location, response?.target ?? null);
    const session = current ?? reopened;
    if (!session) return null;

    const contentId = response.expression?.contentId ?? null;
    const { learnerId } = session;

    if (['starting', 'presenting', 'returning'].includes(session.state)) {
      this.#broadcast(location, {
        event: 'book-refused', reason: 'launch-card-not-ready', learnerId, location, contentId,
        at: this.#clock().toISOString(),
      });
      return { claimed: true, by: CLAIMED_BY, refused: true, reason: 'launch-card-not-ready', learnerId, contentId };
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
        // Browsing: the book goes to the Player's queue, unclaimed — but the
        // session records WHOSE it is. The queue is user-scoped: it belongs to
        // whoever is at the reader now, a later card can re-scope it, and it
        // freezes when it starts. Without this the second story played and
        // finished with nobody's name on it.
        this.#sessions.queueNext?.(location, { contentId, target: response.target ?? null });
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
      pickId: this.#nextPickId(), learnerId, contentId, target: response.target ?? null,
      studyDay: this.#storyTime?.studyDay?.() ?? null, at: this.#clock().toISOString(),
    };
    // The only `return null` a REOPENED session can reach: its state is always
    // PROMPT, so neither the not-ready branch nor the mid-story branch above is
    // reachable from here. If that ever changes, they need this rollback too.
    if (!this.#broadcast(location, { event: 'book-selected', learnerId, location, sessionId: session.sessionId, ...pick })) {
      this.#abandonReopen(reopened, location);
      return null;
    }
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
   * THE NINE-SECOND GAP. A child scans their card, walks to the shelf, picks a
   * book and scans it — one act, which the idle sweep can land in the middle
   * of. When it does, the book card arrives at a reader with no session and
   * dispatches as ordinary content: the story plays, and the obligation does
   * not move. That is exactly what happened on 2026-09-11 at 17:13:23, a
   * second after a teardown.
   *
   * ONLY A TIMEOUT IS REOPENED. A session closed because the DAY was done is a
   * finished child, and a book tapped after that is browsing — reopening it
   * would re-arm a ceremony that already ran. `REOPEN_GRACE_MS` bounds it, and
   * the bound belongs to the store: there is no option here to widen it.
   *
   * Reopening broadcasts `session-open`, so the screen puts the launch card
   * back before the caller's own `book-selected` lands on it.
   *
   * THE STORE AND THIS CLASS MUST SHARE ONE REALTIME GATEWAY. That is an
   * invariant of composition, not an accident of it, and nothing enforces it:
   * `ReadingSessionService.#broadcast` swallows its own failures and returns
   * nothing, so `open()` reports success whether or not the screen was told.
   * Wired to two gateways — or hit by a transient failure on the `session-open`
   * send alone — this produces a CLAIMED tap whose widget never restored the
   * launch card, which is the single outcome the header of this file forbids.
   * The `book-selected` send below is the only failure this can see, and it is
   * what the rollback hangs off.
   *
   * IT REACHES `prompt` WITHOUT A RENDERED ACK, and that is a deliberate
   * exception. `ReadingSessionService.open`'s default `state = PROMPT` mints a
   * presentationId and stamps `presentedAt`/`acknowledgedAt` as of now; its own
   * comment calls that a trusted fixture/restore seam, because the production
   * card path reaches prompt only through a screen that says it painted. A
   * synchronous claim cannot wait for an ACK — the book tap is already being
   * dispatched — so the reopen asserts the launch card rather than proving it.
   * The bet is small (the card was rendered moments ago and the widget is still
   * mounted) but it is a bet, and it COUPLES this path to that seam: anyone
   * tightening `open()` to require an acknowledgement kills the reopen, and no
   * test here would fail.
   *
   * AND IT IS THE ONLY CLAIM THAT ASKS FOR THE SCREEN BACK. An ordinary claim
   * lands on a session already open on a lit screen; this one lands on a
   * session the sweep just tore down, and the sweep's teardown at the
   * living-room reader IS `end: tv-off`. On 2026-09-11 `tv.turnOff.start`
   * fired at 17:13:22.109 and the book arrived at 17:13:23.293 with that
   * turnOff still in flight (the TV only reported off at 17:13:30.165). The
   * single thing that re-lit the room was `wake-and-load`, on the UNCLAIMED
   * path — and claiming the tap is precisely what takes that away, because a
   * claimed book plays in an overlay on the already-mounted widget and nothing
   * in that path powers a display on. So the reopen asks, and only the reopen.
   *
   * @param {string} location
   * @param {string|null} target the device the tap was aimed at, for the wake
   * @returns {object|null} the reopened session, or null to let the book
   *   dispatch as it does today.
   */
  #reopenIfJustClosed(location, target = null) {
    const record = this.#sessions.recentlyClosed?.(location) ?? null;
    if (!record || record.reason !== 'timeout') return null;
    // ONE target value. The session records the device the wake actually asks
    // for, because a session carrying a device nobody woke would ride that
    // stale target into every later `activate()` / `beginSwitch()`
    // presentation. The tap's own target wins: it names the screen this book
    // was aimed at, and the closed session may have carried none at all.
    const wakeTarget = target ?? record.session.target ?? null;
    const wakeRequested = Boolean(this.#wakeScreen && wakeTarget);
    const reopened = this.#sessions.open({
      location, learnerId: record.session.learnerId, target: wakeTarget,
    });
    const sinceCloseMs = this.#clock().getTime() - record.closedAt;
    this.#log('info', 'school.reading.session-reopened', {
      location,
      learnerId: record.session.learnerId,
      sessionId: reopened?.sessionId ?? null,
      closedSessionId: record.session.sessionId,
      sinceCloseMs,
      // Whether the screen was ASKED for; whether it came back is the
      // `reopen-wake` line, which carries the same `sinceCloseMs` so the two
      // read together. Diagnosing a dark screen needs both halves — and see
      // `#wakeForReopen` for why even `ok: true` is not proof of a lit room.
      wakeRequested,
      consequence: 'the book that arrived just after a teardown keeps its credit',
    });
    if (wakeRequested) this.#wakeForReopen(location, wakeTarget, sinceCloseMs);
    return reopened;
  }

  /**
   * Undo a reopen whose screen could not be told, and leave the room exactly as
   * the sweep left it.
   *
   * A reopened session that outlives its own abandoned claim is a PHANTOM, and
   * it is not inert: `suppressEnd` asks only whether a session is open at this
   * reader, so the phantom would cancel the room's `end: tv-off` for the very
   * dispatch about to play the book — the story ends, and nothing is left to
   * turn the living room off. That is the 2026-08-28 fault arriving by a new
   * road.
   *
   * IT SPENDS THE GRACE, deliberately. The close writes a `reopen-abandoned`
   * record, so the next tap inside the window will not try again: a bus that
   * could not carry `book-selected` cannot carry a launch card either, and a
   * retry would only mint a second phantom.
   */
  #abandonReopen(reopened, location) {
    if (!reopened) return;
    // Only ever close the session THIS call opened. Nothing awaits between the
    // reopen and the broadcast, so this holds today; it is asserted rather than
    // assumed because an await introduced above would silently break it.
    if (this.#sessions.current(location)?.sessionId !== reopened.sessionId) return;
    this.#sessions.close(location, { reason: 'reopen-abandoned' });
    this.#log('warn', 'school.reading.reopen-abandoned', {
      location,
      learnerId: reopened.learnerId,
      sessionId: reopened.sessionId,
      consequence: 'the book dispatches as ordinary content, and the room keeps its own teardown',
    });
  }

  /**
   * Ask for the reader's screen, and never let the asking cost the claim.
   *
   * FIRE AND FORGET, on purpose. `prepareForContent` took 6.9 seconds in the
   * field on 2026-09-11; awaiting it here would hold the NFC dispatch open for
   * that long before the child's launch card came back. And `claim()`'s whole
   * contract is that a claim is a promise the screen will handle the tap — a
   * wake that throws, rejects or hangs must not turn a good claim into a dead
   * one, so every outcome lands in a log line and none of them propagate.
   *
   * `ok: true` IS NOT PROOF THE ROOM CAME BACK — do not read it as one. This
   * fires a power-on INTO a teardown that is still running, and the two verify
   * against DIFFERENT entities. From the 2026-09-11 window:
   *
   *   17:13:22.147  script.turn_on   the OFF script (the sweep's teardown)
   *   17:13:23.303  script.turn_on   the ON script (this)
   *   17:13:23.307  living_room_tv_POWER = on    elapsedMs=3   ← this reports ok
   *   17:13:30.165  living_room_tv_STATE = off   elapsedMs=8018 ← 7s LATER
   *
   * The power-on verified in 3ms against a sensor that had not yet caught up
   * with the off script, while the teardown was waiting on a different one that
   * reached `off` seven seconds after this would have logged success. Whether
   * the child's room ended up lit is UNVERIFIED: nobody has watched the actual
   * TV through this sequence, and that item was audio. A re-wake after the
   * teardown settles is the obvious candidate, and it is deliberately NOT built
   * here — it is speculation about hardware behaviour that has to be tested on
   * the real TV first. Until someone does that, this narrows the window; it
   * does not close it.
   */
  #wakeForReopen(location, target, sinceCloseMs) {
    const say = (ok, error) => this.#log(ok ? 'info' : 'warn', 'school.reading.reopen-wake', {
      location, target, sinceCloseMs, ok, error: error ?? null,
      caveat: ok ? 'verified against the power sensor, not the one the teardown drives' : null,
    });
    // Two named paths rather than one predicate, because `new Error()` has an
    // EMPTY message: `??` does not catch it, and a wake that threw would have
    // been logged as a success at info — in the one line a dark-screen
    // investigation actually leans on.
    const failed = (err) => say(false, err?.message || String(err ?? '') || 'wake failed without a message');
    try {
      Promise.resolve(this.#wakeScreen({ target, location }))
        .then((result) => (result?.ok === false ? say(false, result?.error ?? null) : say(true, null)))
        .catch(failed);
    } catch (err) {
      failed(err);
    }
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
      if (!this.#realtime?.readingRoomChanged) throw new Error('no realtime gateway');
      const { event: kind, ...announcement } = payload;
      this.#realtime.readingRoomChanged(location, { kind, ...announcement });
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

  #nextPickId() {
    if (this.#idFactory) return this.#idFactory('pick');
    this.#idSequence += 1;
    return `pick_${this.#clock().getTime().toString(36)}_${this.#idSequence.toString(36)}`;
  }
}

export default ReadingSessionInterceptor;
