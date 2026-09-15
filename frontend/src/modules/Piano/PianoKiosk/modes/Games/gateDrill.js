/**
 * gateDrill — the three-by-three scale drill, standing at the game gate.
 *
 * The drill itself is not new and nothing here re-implements it. It is
 * `scale-drill-3x3` in `shared/music/learningPrograms.mjs`: three sets, one key
 * and one hand each (G right, D left, A both), three reps a set, every rep the
 * whole gesture — bottom to top and back, fifteen notes. A set is a program
 * step, `required_passes: 3` IS the rep counter, and `projectProgram` already
 * turns a learner's attempts into passed/current/upcoming with a `pass_count`
 * per set. All of it shipped, with tests, and none of it ever reached a child:
 * the gate handed `AskSession` a level and a spec and never a program, so the
 * run got one instance, once, with no pills and nothing to carry forward. This
 * module is the wire, not the drill.
 *
 * TWO THINGS IT ADDS, AND ONLY TWO.
 *
 * 1. **The day boundary.** `projectProgram` counts every attempt ever, which is
 *    right for a program somebody enrolled in and finishes once. As the price of
 *    a game it has to be re-earned, or the ninth lifetime pass would retire the
 *    gate's only ask forever. So the projection is fed the attempts from THIS
 *    study day and no others, and the row is empty again each morning.
 *
 *    The day is `clientStudyDate`'s, not `created_at`'s UTC day — the same 4am
 *    boundary the budget and every other gate event uses. A UTC day would roll
 *    the drill over at 5pm local, mid-evening, with three banked reps vanishing
 *    out from under whoever was standing at the piano.
 *
 * 2. **Which set is being asked.** The first set that has not banked its three
 *    reps; when all nine are in, the drill is complete and the gate says so.
 *
 * Pure apart from the two fetches in `resolveGateDrill`. Nothing here throws:
 * every failure answers with a reason string in the gate's own decline
 * vocabulary, because a gate that cannot resolve its material must fail OPEN —
 * a child does not lose a game to an outage in the thing that measures them.
 */
import {
  attemptExerciseId, attemptPurpose, projectProgram, SCALE_DRILL_PROGRAM_ID,
} from '../../../../../../../shared/music/learningPrograms.mjs';
import { pianoLearningApi } from '../Exercises/pianoLearningApi.js';
import { clientStudyDate } from '../../clientStudyDate.js';
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
 * The attempts that belong to a study day.
 *
 * `created_at` is a UTC instant; the study day is local and starts at 4am. The
 * conversion goes through `clientStudyDate` so there is exactly one definition
 * of "today" in the kiosk — see the note at the top of this file for why a
 * UTC-day filter is not merely imprecise but actively destructive here.
 *
 * An attempt with no parseable `created_at` is DROPPED rather than kept. A rep
 * this cannot date cannot be shown to belong to today, and counting it would
 * bank a rep a child did not play today; omitting one only ever asks them to
 * play the scale again, which is the drill.
 */
export function attemptsOnStudyDate(attempts, studyDate) {
  if (!Array.isArray(attempts)) return [];
  return attempts.filter((attempt) => {
    const stamp = Date.parse(attempt?.created_at ?? '');
    if (!Number.isFinite(stamp)) return false;
    return clientStudyDate(new Date(stamp)) === studyDate;
  });
}

/**
 * Today's standing in the drill.
 *
 * `projectProgram` does the whole of the work; this only chooses what it is
 * shown. The result is a normal projection — `steps[]` with `state`,
 * `pass_count` and `passed`, plus `current_step` — so `DrillProgress` renders
 * it without knowing it was scoped to a day.
 */
export function projectGateDrill({ program, attempts, studyDate }) {
  if (!program?.steps?.length) return null;
  return projectProgram(program, attemptsOnStudyDate(attempts, studyDate));
}

/**
 * The set to ask for.
 *
 * The current step while one exists. When the day's nine reps are all banked
 * there is no current step, and the answer is the LAST set rather than null:
 * the child has finished the drill and is opening another game, and the right
 * thing to put in front of them is the hardest thing they proved today, not an
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
 * names fewer), each needing `reps` passes. It banks exactly like the drill —
 * one rep per passed gate, counted over the study day — so every scale rung
 * draws the same row of pills, and a child works through the nine across the
 * day's launches instead of paying for one game with all of them.
 *
 * Only the counts come from the YAML. Everything else — the day boundary, which
 * set is asked, the pills — is the drill's, unchanged.
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
 * Today's standing on a rung drill, in the shape `DrillProgress` reads.
 *
 * Not `projectProgram`, for two reasons. A rep is a PASSED gate — the verdict
 * the ladder itself moves on — where the program requirement counts any
 * completed challenge that clears its criteria, and a rung names none. And a
 * rung with fewer roots than sets repeats a key: `roots: [C]` with `sets: 3` is
 * three sets of C major, and evidence counted per exercise id would bank all
 * three the moment the first did. Passes are dealt out in set order instead, so
 * the fourth C major is the first rep of the second set.
 */
export function projectRungDrill(program, attempts = []) {
  if (!program?.steps?.length) return null;
  const pool = new Map();
  for (const attempt of attempts ?? []) {
    if (attempt?.status !== 'completed' || attemptPurpose(attempt) !== 'challenge') continue;
    if (attempt?.verdict?.passed !== true) continue;
    const id = attemptExerciseId(attempt);
    if (id) pool.set(id, (pool.get(id) ?? 0) + 1);
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
 * A rung drill needs no program fetch — the rung IS the program — so its only
 * network read is the ledger, and a ledger that cannot be read stands the child
 * at set one, rep one rather than costing them the game.
 */
async function resolveRungDrill({ spec, learnerId, studyDate, levelId }) {
  let attempts = [];
  if (learnerId) {
    try {
      const response = await pianoLearningApi.attempts(learnerId);
      if (response?.ok) attempts = response.data?.attempts ?? [];
    } catch {
      // Chrome and position only; the scale is served either way.
    }
  }
  const projection = projectRungDrill(rungDrillProgram(spec, levelId), attemptsOnStudyDate(attempts, studyDate));
  const step = drillStepFor(projection);
  return {
    ok: true,
    spec: { kind: 'exercise', instanceId: step.requirement.exercise_id },
    programId: projection.id,
    stepId: step.id,
    projection,
    complete: Boolean(projection.complete),
  };
}

/**
 * Resolve a `{ kind: 'drill' }` spec into something the rest of the gate
 * already understands: an exercise spec naming one instance, plus the program
 * coordinates the run's chrome reads.
 *
 * The two fetches run together because they are independent and a child is
 * waiting for both.
 *
 * @param {object} args
 * @param {object} args.spec The level's drill spec.
 * @param {string|null} args.learnerId Whose reps these are. A guest has no
 *   attempt ledger, so their drill is simply always at set one, rep one — which
 *   is a true answer and not a degraded one.
 * @param {string} [args.studyDate] Defaults to the client study date.
 * @returns {Promise<{ok:true, spec:object, programId:string, stepId:string,
 *                     projection:object, complete:boolean}
 *                  | {ok:false, error:string}>}
 */
export async function resolveGateDrill({ spec, learnerId, studyDate = clientStudyDate(), levelId = null }) {
  if (isRungDrillSpec(spec)) return resolveRungDrill({ spec, learnerId, studyDate, levelId });
  const programId = drillIdOf(spec);
  let programResponse;
  let attemptsResponse;
  try {
    [programResponse, attemptsResponse] = await Promise.all([
      pianoLearningApi.program(programId),
      // A guest has no ledger and the endpoint answers `{attempts: []}` for
      // them anyway; skipping the call keeps a signed-out kiosk off the wire.
      learnerId ? pianoLearningApi.attempts(learnerId) : Promise.resolve({ ok: true, data: { attempts: [] } }),
    ]);
  } catch {
    // A thrown fetch is the same thing a 502 is. Named with the vocabulary's
    // word for an outage so the gate classifies it as one and fails open.
    return { ok: false, error: 'instance-unavailable' };
  }

  if (!programResponse?.ok || !programResponse.data?.steps?.length) {
    // A drill id that does not exist is a CONFIG mistake, and saying so is what
    // lets the gate substitute rather than hand out a free match: `drill-unknown`
    // is in `CONFIG_DECLINE_REASONS`. A program that exists but could not be
    // fetched is an outage and keeps the outage word.
    return { ok: false, error: programResponse?.status === 404 ? 'drill-unknown' : 'instance-unavailable' };
  }

  // Attempts are chrome-and-position, not the ask. A ledger that could not be
  // read leaves the drill at set one rep one rather than failing the gate: the
  // child plays a scale either way, and the alternative is losing a game
  // because a list could not be fetched.
  const attempts = attemptsResponse?.ok ? (attemptsResponse.data?.attempts ?? []) : [];
  const projection = projectGateDrill({ program: programResponse.data, attempts, studyDate });
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
  };
}

export default resolveGateDrill;
