/**
 * askResolution — turning "what a host wants asked" into the four things a run
 * surface needs in front of it: an INSTANCE (or a SCORE document), and the
 * REQUIREMENT it is judged by.
 *
 * Moved verbatim from `ExerciseRun.loadInstance` and its load effect (task 3 of
 * the ask-platform SP1 plan). It lives in its own module rather than inside
 * `AskSession.jsx` because `AskSession` renders `ExerciseRun`, so anything
 * `ExerciseRun` might have needed from it would have been a cycle. That is now
 * moot in the direction it was written for — `ExerciseRun`'s compatibility path
 * was deleted in task 6 and `AskSession` is the only caller — but a plain,
 * React-free module is still where this belongs: it is a load, not a screen.
 *
 * No React and no state: an async function that answers with a value. Logging
 * is passed in, so the caller's own component name stays on the event.
 */
import { pianoLearningApi } from '../PianoKiosk/modes/Exercises/pianoLearningApi.js';
import { resolveGateMaterial } from '../PianoKiosk/modes/Games/gateMaterial.js';

/** Nothing loaded yet. `undefined` = "still loading"; `null` = "loaded, and there is none". */
export const PENDING_SOURCES = Object.freeze({
  instance: undefined, score: undefined, requirement: null, step: null, decline: null,
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
  if (!material) {
    const res = await pianoLearningApi.instance(instanceId);
    // A bank that could not answer for a named id is the same outage the
    // material path calls `instance-unavailable`; naming it the same way is
    // what lets a host classify the two identically.
    return res?.ok ? res : { ...res, ok: false, error: 'instance-unavailable' };
  }
  const resolved = await resolveGateMaterial(material);
  if (resolved.ok && resolved.kind === 'score') return { ok: true, data: null, score: resolved.score };
  if (resolved.ok) return { ok: true, data: resolved.instance, score: null };
  // Material that could not be resolved (a bad id, an unreachable score) is
  // reported, not thrown: the run shows "Exercise not found" and the gate
  // host moves on — which for a gate means failing open.
  logger?.warn('piano.exercise-material-unresolved', { kind: material.kind ?? null, error: resolved.error });
  return { ok: false, data: null, score: null, error: resolved.error };
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
 * exercise. It also answers with a `decline`: the exact reason string, which is
 * what a HOST needs to tell a config mistake from an outage. The reason has
 * always existed; until now it only reached the log, where no component could
 * act on it.
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
 * @returns {Promise<{instance:object|null, score:object|null, requirement:object|null,
 *                    step:object|null, decline:{kind:string|null, reason:string}|null}>}
 */
export async function loadAskSources({
  material = null, instanceId = null, programId = null, stepId = null,
  requirementOverride = null, logger = null,
}) {
  const [instanceResponse, programResponse] = await Promise.all([
    loadInstance({ material, instanceId, logger }),
    programId ? pianoLearningApi.program(programId) : Promise.resolve({ ok: false, data: null }),
  ]);
  if (!instanceResponse.ok) {
    return {
      instance: null,
      score: null,
      requirement: null,
      step: null,
      decline: { kind: material?.kind ?? null, reason: instanceResponse.error ?? 'instance-unavailable' },
    };
  }
  const step = programResponse.ok ? programResponse.data.steps?.find((entry) => entry.id === stepId) : null;
  return {
    instance: instanceResponse.data,
    score: instanceResponse.score ?? null,
    requirement: requirementOverride ?? step?.requirement ?? null,
    step: step ?? null,
    decline: null,
  };
}

export default loadAskSources;
