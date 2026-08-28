/**
 * askResolution — turning "what a host wants asked" into the four things a run
 * surface needs in front of it: an INSTANCE (or a SCORE document), and the
 * REQUIREMENT it is judged by.
 *
 * Moved verbatim from `ExerciseRun.loadInstance` and its load effect (task 3 of
 * the ask-platform SP1 plan). It lives here rather than inside `AskSession.jsx`
 * for one reason: `AskSession` renders `ExerciseRun`, so `ExerciseRun` cannot
 * import from it without a cycle — and until every host has migrated (tasks
 * 4-5) `ExerciseRun` keeps a compatibility path that must run THIS code rather
 * than a second copy of it. One implementation, two callers, for one task.
 *
 * No React and no state: an async function that answers with a value. Logging
 * is passed in, so the caller's own component name stays on the event.
 */
import { pianoLearningApi } from '../PianoKiosk/modes/Exercises/pianoLearningApi.js';
import { resolveGateMaterial } from '../PianoKiosk/modes/Games/gateMaterial.js';

/** Nothing loaded yet. `undefined` = "still loading"; `null` = "loaded, and there is none". */
export const PENDING_SOURCES = Object.freeze({
  instance: undefined, score: undefined, requirement: null, step: null,
});

/**
 * Load whatever a material descriptor points at, or — with no descriptor — the
 * bank instance named by `instanceId`.
 *
 * A score resolves to a DOCUMENT, not an instance. It travels in its own field
 * rather than being dressed up as one: an instance with no events is a shape
 * every derivation downstream would have to special-case anyway, and one that
 * forgot to would silently grade an empty ask as complete.
 */
async function loadInstance({ material, instanceId, logger }) {
  if (!material) return pianoLearningApi.instance(instanceId);
  const resolved = await resolveGateMaterial(material);
  if (resolved.ok && resolved.kind === 'score') return { ok: true, data: null, score: resolved.score };
  if (resolved.ok) return { ok: true, data: resolved.instance, score: null };
  // Material that could not be resolved (a bad id, an unreachable score) is
  // reported, not thrown: the run shows "Exercise not found" and the gate
  // host moves on — which for a gate means failing open.
  logger?.warn('piano.exercise-material-unresolved', { kind: material.kind ?? null, error: resolved.error });
  return { ok: false, data: null, score: null };
}

/**
 * The instance/score/requirement a run is mounted on, plus the program STEP
 * they came from (the framing a program host writes is read off its title).
 *
 * The two loads run together because they are independent and a child waits for
 * both: the material, and the program the step belongs to.
 *
 * A load that fails answers `{ instance: null, score: null }` — settled with
 * nothing — which is what a run surface reads as "not found". Both halves,
 * because `instance === null` alone would report a resolved SCORE as a missing
 * exercise.
 *
 * @param {object} args
 * @param {object|null} [args.material] A resolved material descriptor
 *   (`{kind:'keys'|'exercise'|'score', …}`). When present it REPLACES
 *   `instanceId` as the load source.
 * @param {string|null} [args.instanceId] Exercise-bank instance to load.
 * @param {string|null} [args.programId] The program whose step is being passed.
 * @param {string|null} [args.stepId] Which step of it.
 * @param {object|null} [args.requirementOverride] A host-authored requirement,
 *   which WINS over the step's own. Returned by identity — a host that memoized
 *   it gets the same object back.
 * @param {{warn:Function}|null} [args.logger]
 * @returns {Promise<{instance:object|null, score:object|null, requirement:object|null, step:object|null}>}
 */
export async function loadAskSources({
  material = null, instanceId = null, programId = null, stepId = null,
  requirementOverride = null, logger = null,
}) {
  const [instanceResponse, programResponse] = await Promise.all([
    loadInstance({ material, instanceId, logger }),
    programId ? pianoLearningApi.program(programId) : Promise.resolve({ ok: false, data: null }),
  ]);
  if (!instanceResponse.ok) return { instance: null, score: null, requirement: null, step: null };
  const step = programResponse.ok ? programResponse.data.steps?.find((entry) => entry.id === stepId) : null;
  return {
    instance: instanceResponse.data,
    score: instanceResponse.score ?? null,
    requirement: requirementOverride ?? step?.requirement ?? null,
    step: step ?? null,
  };
}

export default loadAskSources;
