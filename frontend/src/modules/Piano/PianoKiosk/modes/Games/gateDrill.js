/**
 * gateDrill — the three-by-three scale drill, standing at the game gate.
 *
 * The drill itself is not new and nothing here re-implements it. It is
 * `scale-drill-3x3` in `shared/music/learningPrograms.mjs`: three sets, one key
 * and one hand each (G right, D left, A both), three reps a set, every rep the
 * whole gesture — bottom to top and back, fifteen notes. A set is a program
 * step and `required_passes: 3` IS the rep counter. This module is the wire
 * between that shape and the gate, not the drill.
 *
 * THE GATE IS THE WHOLE DRILL. Every set and every rep is played at the gate
 * the child is standing at, and the game opens when the last one lands. The
 * reps are counted from what was passed at THIS gate and from nothing else:
 * not the learner's attempt ledger, not this morning's reps, not yesterday's.
 * It used to bank one rep per passed gate and carry the row across launches
 * over the study day — which meant a single G major opened the game, and the
 * "three sets of three" the pills promised was a fiction a child could walk
 * through one rep at a time. The ledger is still written by the run (every
 * rep is a recorded attempt); it is simply not what the gate reads.
 *
 * Two things this module answers, and only two:
 *
 * 1. **The program.** A `{ kind: 'drill' }` spec names one by id and it is
 *    fetched; a scale rung carrying `sets`/`reps` IS one and is built in place.
 * 2. **Which set is being asked**, given the reps passed so far at this gate:
 *    the first set that has not banked its reps; when all are in, the drill is
 *    complete and the gate says so.
 *
 * Pure apart from the one fetch in `resolveGateDrill`. Nothing here throws:
 * every failure answers with a reason string in the gate's own decline
 * vocabulary, because a gate that cannot resolve its material must fail OPEN —
 * a child does not lose a game to an outage in the thing that measures them.
 */
import { SCALE_DRILL_PROGRAM_ID } from '../../../../../../../shared/music/learningPrograms.mjs';
import { pianoLearningApi } from '../Exercises/pianoLearningApi.js';
import { rootsOf, scaleInstanceId } from './gateMaterial.js';

/** The material kind a level writes to ask for a drill. */
export const DRILL_MATERIAL_KIND = 'drill';

/** What `{ kind: 'drill' }` means with no `drill:` key beside it. */
export const DEFAULT_DRILL_ID = SCALE_DRILL_PROGRAM_ID;

/** A level's spec asking for a drill. */
export function isDrillSpec(spec) {
  return spec?.kind === DRILL_MATERIAL_KIND;
}

/** Which drill a spec names. `{ kind: 'drill' }` alone means the scale drill. */
export function drillIdOf(spec) {
  const named = spec?.drill ?? spec?.programId ?? spec?.program_id;
  return typeof named === 'string' && named ? named : DEFAULT_DRILL_ID;
}

/**
 * The set to ask for.
 *
 * The current step while one exists. When every rep is banked there is no
 * current step, and the answer is the LAST set rather than null: the drill is
 * complete, the gate is about to open, and a caller that still needs a step —
 * the pills under the curtain — is handed the hardest one rather than an
 * error. `complete` travels beside it so a caller can say so.
 */
export function drillStepFor(projection) {
  if (!projection?.steps?.length) return null;
  return projection.current_step ?? projection.steps[projection.steps.length - 1];
}

/**
 * A SCALE LEVEL THAT NAMES ITS OWN SETS AND REPS.
 *
 * `{ kind: exercise, collection: scales, roots: [G, D, F], sets: 3, reps: 3 }`
 * is the drill's shape written on the rung rather than in a program: `sets`
 * sets, one key each, taken from the level's roots in order (cycling when it
 * names fewer), each needing `reps` passes. It is played exactly like the
 * drill — every set and every rep at the gate, the game on the last one — so
 * every scale rung draws the same row of pills and costs the same nine.
 *
 * Only the counts come from the YAML. Everything else — which set is asked,
 * how a rep banks, the pills — is the drill's, unchanged.
 */
const RUNG_COUNT_MAX = 9;

function rungCount(value) {
  const count = Math.floor(Number(value));
  return Number.isFinite(count) && count >= 1 ? Math.min(count, RUNG_COUNT_MAX) : null;
}

/** A scale level carrying `sets` or `reps`, not yet resolved to one instance. */
export function isRungDrillSpec(spec) {
  return spec?.kind === 'exercise'
    && !(typeof spec.instanceId === 'string' && spec.instanceId)
    && rootsOf(spec).length > 0
    && Boolean(rungCount(spec.sets) || rungCount(spec.reps));
}

/** Whether a spec depends on the learner's standing before it can be asked. */
export function needsDrillResolution(spec) {
  return isDrillSpec(spec) || isRungDrillSpec(spec);
}

/**
 * The program a rung's `sets` × `reps` describes. Steps carry no `display.key`
 * on purpose: the run at the gate draws pills and never a name.
 */
export function rungDrillProgram(spec, levelId = null) {
  const roots = rootsOf(spec);
  if (!roots.length) return null;
  const sets = rungCount(spec.sets) ?? 1;
  const reps = rungCount(spec.reps) ?? 1;
  return {
    id: `rung:${levelId ?? 'level'}`,
    ordered: true,
    steps: Array.from({ length: sets }, (_, index) => {
      const root = roots[index % roots.length];
      return {
        id: `set-${index + 1}`,
        order: index + 1,
        requirement: { exercise_id: scaleInstanceId(root, spec), required_passes: reps },
        display: { root, reps },
      };
    }),
  };
}

/**
 * Where the drill stands, in the shape `DrillProgress` reads, given the
 * exercise ids passed at this gate so far.
 *
 * Not `projectProgram`: that reads attempt records against each step's rubric,
 * and a gate rep is simpler than that — it is a PASSED gate, the verdict the
 * ladder itself moves on. And a rung with fewer roots than sets repeats a key:
 * `roots: [C]` with `sets: 3` is three sets of C major, and evidence counted
 * per exercise id would bank all three the moment the first did. Passes are
 * dealt out in set order instead, so the fourth C major is the first rep of
 * the second set.
 *
 * @param {object} program Steps with `requirement.exercise_id` and
 *   `requirement.required_passes`.
 * @param {string[]} passes The exercise ids passed at this gate, in order.
 */
export function projectDrill(program, passes = []) {
  if (!program?.steps?.length) return null;
  const pool = new Map();
  for (const id of passes ?? []) {
    if (typeof id !== 'string' || !id) continue;
    pool.set(id, (pool.get(id) ?? 0) + 1);
  }
  let currentTaken = false;
  const steps = program.steps.map((step) => {
    const id = step.requirement.exercise_id;
    const needed = step.requirement.required_passes;
    const available = pool.get(id) ?? 0;
    const taken = Math.min(available, needed);
    pool.set(id, available - taken);
    const passed = taken >= needed;
    const current = !passed && !currentTaken;
    if (current) currentTaken = true;
    return {
      ...step,
      pass_count: taken,
      passed,
      unlocked: passed || current,
      state: passed ? 'passed' : current ? 'current' : 'upcoming',
    };
  });
  const passedSteps = steps.filter((step) => step.passed).length;
  return {
    ...program,
    steps,
    passed_steps: passedSteps,
    total_steps: steps.length,
    complete: passedSteps === steps.length,
    current_step: steps.find((step) => step.state === 'current') ?? null,
  };
}

/**
 * The one pair of numbers an adult reading the log wants: how far through the
 * drill this child is. Summed from the steps rather than assumed to be three a
 * set — a rung drill's reps come from the YAML.
 */
export function drillStanding(projection) {
  const steps = projection?.steps ?? [];
  return {
    banked: steps.reduce(
      (sum, step) => sum + Math.min(step.pass_count ?? 0, step.requirement?.required_passes ?? 1), 0,
    ),
    total: steps.reduce((sum, step) => sum + (step.requirement?.required_passes ?? 1), 0),
  };
}

/** The gate's view of a program at its first rep: the shape every serve returns. */
function serveDrill(program) {
  const projection = projectDrill(program, []);
  const step = drillStepFor(projection);
  const instanceId = step?.requirement?.exercise_id ?? null;
  if (!instanceId) return { ok: false, error: 'drill-unknown' };
  return {
    ok: true,
    // An ordinary exercise spec from here on. Everything downstream —
    // `resolveSpec`, `loadAskSources`, the run — is untouched by the drill
    // existing, which is the point: the drill decides WHICH scale, and nothing
    // else in the chain needs to learn a new shape.
    spec: { kind: 'exercise', instanceId },
    programId: projection.id,
    stepId: step.id,
    projection,
    complete: Boolean(projection.complete),
    // The gate re-projects from this after every rep, without another fetch.
    program,
  };
}

/**
 * Resolve a drill spec into something the rest of the gate already understands:
 * an exercise spec naming one instance, plus the program coordinates the run's
 * chrome reads, plus the program itself so the gate can deal the next rep.
 *
 * A rung drill needs no network at all — the rung IS the program. A named
 * drill fetches its program, and nothing else: there is no ledger read,
 * because the reps that count are the ones passed at this gate.
 *
 * @param {object} args
 * @param {object} args.spec The level's drill spec.
 * @param {string|null} [args.levelId] Names a rung drill's program.
 * @returns {Promise<{ok:true, spec:object, programId:string, stepId:string,
 *                     projection:object, complete:boolean, program:object}
 *                  | {ok:false, error:string}>}
 */
export async function resolveGateDrill({ spec, levelId = null }) {
  if (isRungDrillSpec(spec)) return serveDrill(rungDrillProgram(spec, levelId));
  const programId = drillIdOf(spec);
  let programResponse;
  try {
    programResponse = await pianoLearningApi.program(programId);
  } catch {
    // A thrown fetch is the same thing a 502 is. Named with the vocabulary's
    // word for an outage so the gate classifies it as one and fails open.
    return { ok: false, error: 'instance-unavailable' };
  }
  // A program that exists but could not be fetched is an outage and keeps the
  // outage word. A drill id that does not exist — or a program with nothing
  // in it — is a CONFIG mistake, and saying so is what lets the gate
  // substitute rather than hand out a free match: `drill-unknown` is in
  // `CONFIG_DECLINE_REASONS`.
  if (!programResponse?.ok) {
    return { ok: false, error: programResponse?.status === 404 ? 'drill-unknown' : 'instance-unavailable' };
  }
  if (!programResponse.data?.steps?.length) return { ok: false, error: 'drill-unknown' };
  return serveDrill(programResponse.data);
}

export default resolveGateDrill;
