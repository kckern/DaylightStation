// backend/src/3_applications/fitness/usecases/LogStrengthRun.mjs
//
// A finished strength run lands in the SAME record a cycle ride does.
//
// WHY THIS USE CASE EXISTS
// ------------------------
// Session detail, the recap sweep, the longitudinal widget and Strava reconciliation all
// read `data/household/history/fitness/{date}/{id}.yml`. Writing a workout anywhere else
// would create a second history that none of them display — the run would be "logged" and
// still invisible. So this use case takes the runner's report, reduces it to a strength
// block, and hangs it off the existing session through the existing save path. Nothing
// downstream needs new plumbing to notice a workout happened.
//
// WHAT IT REFUSES TO DO
// ---------------------
// - It does not invent a session BEHIND THE CLIENT'S BACK. A run reported against an id the
//   client believes already exists, when it does not, is a bug worth surfacing rather than a
//   reason to fabricate a record that no HR data, media or recap will ever join to. That is
//   still the default and every existing caller gets it.
//
//   `openSession: true` is the one way past it, and it is a DIFFERENT request: the client is
//   not claiming the session exists, it is asking for one to be opened for this run. That
//   exists because a strength workout frequently happens with no session at all, and the
//   frontend cannot open one for it:
//
//     * `FitnessSession` starts a session from SENSOR traffic crossing a pre-session buffer.
//       Strength work is routinely strapless, so nothing ever crosses it.
//     * `PersistenceManager.validateSessionPayload` then refuses to write any session with an
//        empty roster, under 60s, under 3 ticks, or with no non-zero HR series — a
//        strength-only session fails four of those gates by construction. Those gates are
//        right; they are what keeps sensor flap out of history. They just mean the browser
//        physically cannot produce this record.
//     * `POST /save_session` is additionally gated on `session_write_whitelist`, so only the
//       garage kiosk may write a whole session at all.
//
//   So "no session" would otherwise mean "a completed strength workout is unrecordable",
//   which is the one outcome this whole feature exists to prevent. The session opened here is
//   minimal and honest: it starts when the run started, ends when it finished, and carries no
//   participants, because nobody was identified. It is a real workout that really happened.
//
//   A session opened this way can duplicate one the kiosk already had open on another device.
//   That is a merge (`POST /sessions/merge`), and a duplicate that can be merged is strictly
//   better than a workout that was never recorded.
// - It does not resolve identity. Attribution comes from the session's OWN `participants`
//   block — the ids the existing save path already resolved and every report joins on. A
//   second identity path here could disagree with the first, and a workout attributed to
//   somebody who was not there is worse than one attributed to nobody.
// - It does not trust the report's counts. The plan comes from the repository (the workout
//   as authored) and the completions come from the runner; the block is derived from the
//   two, so a client cannot post "I did 4 sets" for a workout that prescribes 3, and the
//   plan can never masquerade as performance.

import {
  makeStrengthRun,
  presentParticipantIds,
} from '#domains/fitness/workout/strengthLog.mjs';

export class LogStrengthRun {
  #sessionService;
  #workoutRepository;
  #logger;
  #now;

  /**
   * @param {Object} deps
   * @param {Object} deps.sessionService SessionService — owns the session record.
   * @param {Object} deps.workoutRepository YamlWorkoutRepository — `get(id, householdId)`.
   * @param {Object} [deps.logger]
   * @param {Function} [deps.now] Clock seam; returns epoch ms.
   */
  constructor({ sessionService, workoutRepository, logger = null, now = () => Date.now() } = {}) {
    if (!sessionService) throw new Error('LogStrengthRun requires sessionService');
    if (!workoutRepository) throw new Error('LogStrengthRun requires workoutRepository');
    this.#sessionService = sessionService;
    this.#workoutRepository = workoutRepository;
    this.#logger = logger;
    this.#now = now;
  }

  /**
   * @param {Object} input
   * @param {string} input.sessionId The session this run belongs to.
   * @param {string} input.workoutId The workout that was run.
   * @param {Array<Object>} input.completedSteps Work steps the runner finished — a subset
   *   of `expandWorkout`'s output, each carrying at least `{groupIndex, slug}`.
   * @param {string|null} [input.householdId]
   * @param {string} [input.completedAt] ISO timestamp; defaults to the injected clock.
   * @param {boolean} [input.openSession] Open `sessionId` if it does not exist yet. See the
   *   header — this is a request, not a claim, and it is off by default.
   * @param {string} [input.startedAt] ISO timestamp the run began. Only read when a session
   *   is opened, where it becomes the session's start.
   * @returns {Promise<{ok: true, sessionId: string, strength: Object}
   *          |{ok: false, error: string, reason: string}>}
   */
  async execute({
    sessionId,
    workoutId,
    completedSteps,
    householdId = null,
    completedAt = null,
    openSession = false,
    startedAt = null,
  } = {}) {
    if (!sessionId) {
      return { ok: false, reason: 'missing_session', error: 'sessionId is required' };
    }
    if (!workoutId) {
      return { ok: false, reason: 'missing_workout', error: 'workoutId is required' };
    }

    const workout = this.#workoutRepository.get(workoutId, householdId);
    if (!workout) {
      this.#logger?.warn?.('fitness.strength.log.unknown_workout', { sessionId, workoutId });
      return { ok: false, reason: 'unknown_workout', error: `unknown workout "${workoutId}"` };
    }

    const finishedAt = completedAt || new Date(this.#now()).toISOString();

    // The session must already exist, unless the caller explicitly asked for one to be
    // opened — see the header. Loading it here also gives us the identity block the run is
    // attributed to.
    let session = await this.#sessionService.getSession(sessionId, householdId, { decodeTimeline: false });
    let openedSession = false;
    if (!session) {
      if (!openSession) {
        this.#logger?.warn?.('fitness.strength.log.unknown_session', { sessionId, workoutId });
        return { ok: false, reason: 'unknown_session', error: `unknown session "${sessionId}"` };
      }
      const startMs = Number.isFinite(Date.parse(startedAt)) ? Date.parse(startedAt) : this.#now();
      try {
        session = await this.#sessionService.createSession({ sessionId, startTime: startMs }, householdId);
      } catch (err) {
        // A malformed id is the client's bug, and inventing a different one would file the
        // run somewhere nobody is looking for it.
        this.#logger?.warn?.('fitness.strength.log.open_failed', {
          sessionId, workoutId, error: err?.message,
        });
        return { ok: false, reason: 'unknown_session', error: `could not open session "${sessionId}"` };
      }
      openedSession = true;
      this.#logger?.info?.('fitness.strength.log.session_opened', { sessionId, workoutId, startMs });
    }

    // Attribution: the cheap id-only presence query over the session's own participants
    // block. NOT the roster — that is a display projection (names, anonymous device
    // placeholders) and joining reports on it corrupts the record.
    const participants = presentParticipantIds(session.participants);

    const run = makeStrengthRun({
      workout,
      completedSteps,
      participants,
      completedAt: finishedAt,
    });

    if (!run) {
      // Opening the runner and walking away is not a workout. Reported as handled, so a
      // client that posts an empty run does not retry forever against a 500.
      this.#logger?.info?.('fitness.strength.log.empty', { sessionId, workoutId });
      return { ok: false, reason: 'nothing_completed', error: 'no completed sets to log' };
    }

    let saved = await this.#sessionService.recordStrengthRun(sessionId, run, householdId);

    // A session opened FOR this run also ends with it. Without an end time the record has no
    // duration, and every reader that sizes a workout by its duration would show it as zero.
    // A session that was already live is left alone — its own lifecycle ends it.
    if (openedSession) {
      const endMs = Number.isFinite(Date.parse(finishedAt)) ? Date.parse(finishedAt) : this.#now();
      saved = await this.#sessionService.endSession(sessionId, householdId, endMs);
    }

    this.#logger?.info?.('fitness.strength.log.ok', {
      sessionId,
      workoutId,
      openedSession,
      setsCompleted: run.setsCompleted,
      setsPlanned: run.setsPlanned,
      groups: run.groups.length,
      participants: participants.length,
      runs: saved.getStrengthRuns().length,
    });

    return {
      ok: true,
      sessionId: saved.sessionId?.toString?.() ?? String(sessionId),
      openedSession,
      strength: saved.strength,
      run,
    };
  }
}

export default LogStrengthRun;
