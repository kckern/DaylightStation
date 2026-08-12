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
// - It does not invent a session. The garage session is opened by the fitness app's normal
//   lifecycle; a run reported against an id that does not exist is a bug worth surfacing,
//   not a reason to fabricate a record that no HR data, media or recap will ever join to.
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
   * @returns {Promise<{ok: true, sessionId: string, strength: Object}
   *          |{ok: false, error: string, reason: string}>}
   */
  async execute({ sessionId, workoutId, completedSteps, householdId = null, completedAt = null } = {}) {
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

    // The session must already exist — see the header. Loading it here also gives us the
    // identity block the run is attributed to.
    const session = await this.#sessionService.getSession(sessionId, householdId, { decodeTimeline: false });
    if (!session) {
      this.#logger?.warn?.('fitness.strength.log.unknown_session', { sessionId, workoutId });
      return { ok: false, reason: 'unknown_session', error: `unknown session "${sessionId}"` };
    }

    // Attribution: the cheap id-only presence query over the session's own participants
    // block. NOT the roster — that is a display projection (names, anonymous device
    // placeholders) and joining reports on it corrupts the record.
    const participants = presentParticipantIds(session.participants);

    const run = makeStrengthRun({
      workout,
      completedSteps,
      participants,
      completedAt: completedAt || new Date(this.#now()).toISOString(),
    });

    if (!run) {
      // Opening the runner and walking away is not a workout. Reported as handled, so a
      // client that posts an empty run does not retry forever against a 500.
      this.#logger?.info?.('fitness.strength.log.empty', { sessionId, workoutId });
      return { ok: false, reason: 'nothing_completed', error: 'no completed sets to log' };
    }

    const saved = await this.#sessionService.recordStrengthRun(sessionId, run, householdId);

    this.#logger?.info?.('fitness.strength.log.ok', {
      sessionId,
      workoutId,
      setsCompleted: run.setsCompleted,
      setsPlanned: run.setsPlanned,
      groups: run.groups.length,
      participants: participants.length,
      runs: saved.getStrengthRuns().length,
    });

    return {
      ok: true,
      sessionId: saved.sessionId?.toString?.() ?? String(sessionId),
      strength: saved.strength,
      run,
    };
  }
}

export default LogStrengthRun;
