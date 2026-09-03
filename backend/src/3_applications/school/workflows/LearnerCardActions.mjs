/**
 * learnerCardActions — the handlers registered into the trigger pipeline's
 * `learnerActions` registry, one per `learner_action` a reader can declare.
 *
 * Layer: APPLICATION. It coordinates School with the injected trigger
 * pipeline while remaining independent of transport and concrete adapters.
 * The trigger registry knows op names and nothing about School,
 * and this is what keeps it that way. Extracted from an inline arrow in
 * `app.mjs` so it can be tested without booting the app — the contract it holds
 * is worth more than the four lines it saves.
 *
 * @module applications/school/workflows/LearnerCardActions
 */

/**
 * The `print-agenda` learner action: School's ResolvePersonalCard, plus the
 * on-screen acknowledgement a cooldown-suppressed tap depends on.
 *
 * THE BROADCAST IS NOT OPTIONAL. A repeat tap inside the print cooldown gets no
 * paper, and this is that tap's ONLY feedback — without it a child who taps and
 * gets nothing just taps harder, which is the exact behaviour the cooldown
 * exists to stop. It rides the `omr` topic because `useScanCeremony.js` already
 * subscribes there; no new transport. It used to be broadcast by
 * `nfcTapIngress`, which is now transport-only and could not know a print had
 * been suppressed.
 *
 * IT IS ALSO BEST-EFFORT, AND THE OUTCOME IS NOT. `responseHandlers.learner`
 * turns a throw into `{ status: 'failed', retryable: true }` — so a broken bus
 * or a broken log transport would report a successful suppression as a failed
 * tap AND release the debounce, printing on the very next tap. Both are
 * swallowed here for that reason.
 *
 * @param {object} deps
 * @param {{execute: Function}} deps.resolvePersonalCard School use case
 * @param {import('../ports/ISchoolRealtimeGateway.mjs').ISchoolRealtimeGateway} [deps.realtime]
 * @param {object} [deps.logger]
 * @returns {(args: {learnerId: string, location?: string}) => Promise<object>}
 */
export function makePrintAgendaHandler({ resolvePersonalCard, realtime, clock = () => new Date(), logger = console } = {}) {
  return async ({ learnerId, location } = {}) => {
    const result = await resolvePersonalCard.execute({ learnerId });

    try {
      logger?.info?.('nfc.tap.school_card', {
        location, learnerId, status: result?.status ?? null, printed: result?.printed ?? null,
      });
    } catch { /* the tap outranks the log line */ }

    if (result?.status === 'agenda_suppressed') {
      try {
        realtime?.printAgendaReady?.({
          learnerId,
          // Null rather than absent: the panel would rather render "you already
          // have today's agenda" without a countdown than render nothing.
          sinceMinutes: result.sinceMinutes ?? null,
          cooldownMinutes: result.cooldownMinutes ?? null,
          timestamp: clock().getTime(),
        });
      } catch (err) {
        try { logger?.warn?.('nfc.tap.ack_failed', { location, learnerId, error: err?.message }); } catch { /* ignore */ }
      }
    }

    // `print_failed` is the one status that tells the child to scan again —
    // ResolvePersonalCard REPORTS it rather than throwing, so nothing else would
    // release the 30s trigger debounce and the retry it asked for would be
    // swallowed with the handler never invoked. Every other status is a finished
    // answer: a printed agenda and a cooldown suppression both WANT the lockout,
    // and an unknown learner is no more known on the next tap.
    if (result?.status === 'print_failed') return { ...result, retryable: true };

    return result ?? { status: 'unknown' };
  };
}

/** Apply the reader's declared end policy when its reading session expires. */
export function makeReadingTimeoutHandler({ locations = () => ({}), tv = null, logger = console } = {}) {
  return async (session) => {
    const source = locations()?.[session?.location] ?? {};
    if (source.end !== 'tv-off') {
      logger?.info?.('school.reading.timeout-idle', { location: session?.location ?? null, end: source.end ?? null });
      return { action: 'idle' };
    }
    if (!tv?.turnOff) return { action: 'tv-off-unavailable' };
    await tv.turnOff(source.end_location ?? session.location);
    return { action: 'tv-off', location: source.end_location ?? session.location };
  };
}

/**
 * The `reading-session` learner action: a preschooler's own card at the
 * living-room reader opens a session scoped to them, and wakes the screen so
 * they can see it.
 *
 * D2 — A READING SESSION NEVER SEIZES THE TV. If unrelated content is already
 * playing at that reader's target, the tap is REFUSED: no session opens,
 * nothing touches the TV, and the movie somebody else is watching keeps
 * playing. The refusal is broadcast so the screen can say something, because
 * the quiet failure here is as bad as the loud one — a child who taps and sees
 * nothing taps harder (invariant 5).
 *
 * "UNRELATED" IS "NO SESSION OPEN AT THIS READER". Once a reading session is
 * open, its launch card is the only hand-off point: confirmation, loading,
 * playback, celebration, and return all refuse learner cards without changing
 * the authoritative session or its frozen pick.
 *
 * EVERY DEGRADED PATH OPENS THE SESSION. No playback source wired, a source
 * that throws, a TV that will not wake — all of them let the child in. The only
 * thing that refuses is a POSITIVE answer that content is playing: refusing a
 * four-year-old on a guess is worse than the guess being wrong.
 *
 * @param {object} deps
 * @param {import('#apps/school/ReadingSessionService.mjs').ReadingSessionService} deps.sessions
 * @param {(target: string) => boolean} [deps.isPlaying] - the live "is real
 *   content up on this device" read (`ScreenContentTracker`). Absent means
 *   "nobody can say", which opens the session.
 * @param {(a: {target: string, location: string}) => Promise<object>} [deps.wakeScreen]
 *   - power the reader's screen on and bring the kiosk forward. Deliberately
 *   NOT a content load: the reading widget is already mounted on that screen,
 *   and reloading the page would drop the WebSocket that carries the
 *   presentation request this tap produced.
 * @returns {(args: {learnerId: string, location?: string, target?: string}) => Promise<object>}
 */
export function makeReadingSessionHandler({
  sessions, isPlaying = null, wakeScreen = null, alertAdult = null, realtime = null,
  clock = () => new Date(), logger = console,
  ackTimeoutMs = 8_000, maxDeliveryAttempts = 2,
} = {}) {
  if (!sessions) throw new Error('makeReadingSessionHandler requires a sessions store');

  const log = (level, event, data) => {
    try { logger?.[level]?.(event, data); } catch { /* the tap outranks the log line */ }
  };
  const tell = (location, payload) => {
    try {
      const { event: kind, ...announcement } = payload;
      realtime?.readingRoomChanged?.(location, { kind, ...announcement });
    } catch (err) {
      log('warn', 'school.reading.ack-failed', {
        location, event: payload?.event ?? null, error: err?.message ?? String(err),
      });
    }
  };

  return async ({ learnerId, location, target = null } = {}) => {
    if (!location) {
      // A reader with no location cannot own a session, and a session with no
      // reader has no screen to render on. Named, not silently ignored.
      log('warn', 'school.reading.no-location', { learnerId, target });
      return { status: 'reading_session_failed', reason: 'no-location', learnerId: learnerId ?? null };
    }

    const existing = sessions.current(location);
    if (!existing) {
      let busy = false;
      try {
        busy = isPlaying?.(target) === true;
      } catch (err) {
        // Never a refusal on a broken read. See the header.
        log('warn', 'school.reading.playback-unreadable', { location, target, error: err?.message ?? String(err) });
      }
      if (busy) {
        tell(location, {
          event: 'session-refused', reason: 'content-playing', learnerId, location, target,
          at: clock().toISOString(),
        });
        log('info', 'school.reading.session-refused', { location, learnerId, target, reason: 'content-playing' });
        // Not retryable: the movie will still be playing on the next tap, and a
        // released debounce would only let a child tap through the refusal.
        return { status: 'reading_session_refused', reason: 'content-playing', learnerId, location };
      }
    }

    if (existing && !sessions.isSwitchable(location)) {
      tell(location, {
        event: 'session-switch-refused', reason: 'not-at-launch-card',
        learnerId, currentLearnerId: existing.learnerId,
        currentSessionId: existing.sessionId, state: existing.state,
        location, target, at: clock().toISOString(),
      });
      log('info', 'school.reading.session-switch-refused', {
        location, requestedLearnerId: learnerId,
        currentLearnerId: existing.learnerId,
        currentSessionId: existing.sessionId, state: existing.state,
        reason: 'not-at-launch-card',
      });
      return {
        status: 'reading_session_refused', reason: 'not-at-launch-card',
        learnerId, location, currentLearnerId: existing.learnerId,
        sessionId: existing.sessionId, state: existing.state,
      };
    }

    // A rendered prompt already owns a live screen. Present the new face now,
    // without the slow power/foreground path; the service keeps the old learner
    // authoritative until the exact candidate presentation is ACKed.
    if (existing) {
      const requested = sessions.beginSwitch({ location, learnerId, target });
      if (!requested) {
        return { status: 'reading_session_refused', reason: 'switch-raced', learnerId, location };
      }
      if (requested.noChange) {
        return {
          status: 'reading_session_open', learnerId: existing.learnerId,
          location, woke: null, sessionId: existing.sessionId,
        };
      }
      const { presentation } = requested;
      void (async () => {
        for (let attempt = 1; attempt <= maxDeliveryAttempts; attempt += 1) {
          if (await sessions.waitForAcknowledgement(presentation.presentationId, ackTimeoutMs)) {
            log('info', 'school.reading.session-switch-applied', {
              location, learnerId, sessionId: presentation.sessionId,
              presentationId: presentation.presentationId, attempt,
            });
            return;
          }
          if (attempt < maxDeliveryAttempts) sessions.reannounce(location, presentation.presentationId);
        }
        // The ACK can win the narrow race between the final deadline and this
        // rollback. Only alert when this exact candidate was still pending and
        // therefore really was rolled back.
        const rollback = sessions.rollbackPresentation(location, presentation.presentationId);
        if (!rollback) return;
        try {
          await alertAdult?.({
            location, target, learnerId, sessionId: presentation.sessionId,
            presentationId: presentation.presentationId, reason: 'switch-unacknowledged',
          });
        } catch (err) {
          log('warn', 'school.reading.delivery-alert-failed', { location, error: err?.message ?? String(err) });
        }
      })();
      return {
        status: 'reading_session_presenting', learnerId, location, woke: null,
        sessionId: presentation.sessionId, presentationId: presentation.presentationId,
      };
    }

    // No session exists: reserve the reader before the potentially long wake.
    // Book taps in this interval must not escape to ordinary playback.
    const session = sessions.open({ location, learnerId, target, state: 'starting' });

    let woke = null;
    let wakeMs = null;
    if (wakeScreen) {
      const wakeStartedAt = clock().getTime();
      try {
        woke = await wakeScreen({ target, location });
      } catch (err) {
        // §9: the card tap must still answer. The screen may well be on
        // already; a wake that failed is a log line and a flag on the answer,
        // never a refused session.
        log('warn', 'school.reading.wake-failed', { location, target, error: err?.message ?? String(err) });
        woke = { ok: false, error: err?.message ?? String(err) };
      }
      wakeMs = clock().getTime() - wakeStartedAt;
    }

    // A late wake from a superseded card must not revive the newer learner's
    // session. `activate` compares the reservation id before publishing.
    const active = sessions.activate(location, session.sessionId);

    // `wakeMs` is the wake CALL's latency, recorded plainly. The reservation
    // was created before this call, but the visible presentation is published
    // only by `activate` after wake returns. On 2026-08-28 wake took 19 seconds,
    // and the only way to know that was to subtract log timestamps by hand.
    //
    // IT IS NOT A VERDICT, AND AN EARLIER VERSION OF THIS LINE PRETENDED IT
    // WAS. A `broadcastLikelyMissed` boolean derived from a 1.5s threshold was
    // wrong on its face: `prepareForContent` spends ~13.5s on the HEALTHY path
    // (FKB foreground verification alone took 11.97s in the incident), so a TV
    // that was already on, already subscribed, and received the broadcast
    // perfectly would still have been flagged and warned about. A field that
    // fires on every ordinary tap teaches you to ignore it.
    //
    // Whether the screen actually painted that presentation is answered by
    // the compare-and-swap ACK below; until then this stays a measurement and
    // does not editorialise.
    log('info', 'school.reading.session-opened', {
      location, learnerId, target, replaced: null,
      wakeMs,
      woke: woke ? woke.ok !== false : null,
    });
    // The initial wake is intentionally outside this retry loop: power-on is
    // expensive and can disturb a person using the TV. Recovery replays the
    // exact presentation and re-foregrounds the already-selected reader a
    // bounded number of times. The card tap has already received its answer;
    // delivery continues without holding the trigger request open.
    if (active?.pendingPresentation?.presentationId) {
      void (async () => {
        const presentation = active.pendingPresentation;
        for (let attempt = 1; attempt <= maxDeliveryAttempts; attempt += 1) {
          if (await sessions.waitForAcknowledgement(presentation.presentationId, ackTimeoutMs)) {
            log('info', 'school.reading.delivery-acknowledged', {
              location, sessionId: presentation.sessionId,
              presentationId: presentation.presentationId, attempt,
            });
            return;
          }
          if (attempt === maxDeliveryAttempts) break;
          try { await wakeScreen?.({ target, location, prepareOnly: true }); } catch (err) {
            log('warn', 'school.reading.delivery-replay-wake-failed', { location, attempt: attempt + 1, error: err?.message ?? String(err) });
          }
          // Foreground first, replay second. A cold/reconnecting WebView can
          // miss a message sent just before it becomes runnable; the current
          // snapshot is still authoritative if foregrounding itself fails.
          sessions.reannounce(location, presentation.presentationId);
        }
        log('error', 'school.reading.delivery-unacknowledged', {
          location, learnerId, sessionId: presentation.sessionId,
          presentationId: presentation.presentationId, attempts: maxDeliveryAttempts,
        });
        // An initial session nobody ever saw is not allowed to linger as a
        // hidden authority. Close only if this exact presentation is current.
        const current = sessions.current(location);
        let closed = null;
        if (current?.pendingPresentation?.presentationId === presentation.presentationId) {
          closed = sessions.close(location, { reason: 'presentation-unacknowledged' });
        }
        // A late ACK may have committed between the deadline and this guard.
        // In that case there is no delivery failure left to alert about.
        if (!closed) return;
        try { await alertAdult?.({ location, target, learnerId, sessionId: presentation.sessionId }); } catch (err) {
          log('warn', 'school.reading.delivery-alert-failed', { location, error: err?.message ?? String(err) });
        }
      })();
    }
    return {
      status: 'reading_session_presenting',
      learnerId: (active ?? session).learnerId,
      location: (active ?? session).location,
      // `null` when nothing was asked to wake; `false` only when something was
      // asked and could not. The two are different answers.
      woke: wakeScreen ? woke?.ok !== false : null,
      sessionId: (active ?? session).sessionId,
      presentationId: active?.pendingPresentation?.presentationId ?? null,
    };
  };
}

export default { makePrintAgendaHandler, makeReadingSessionHandler, makeReadingTimeoutHandler };
