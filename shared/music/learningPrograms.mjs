import { expandSeed, instanceId } from './exerciseBank.mjs';

export const HANON_PROGRAM_ID = 'hanon-virtuoso-pianist';
export const LEARNING_SCHEMA_VERSION = 1;

const clone = (value) => structuredClone(value);
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

export function hanonRequirement(seedId, bpm = 60) {
  return {
    exercise_id: instanceId(seedId, {
      root: 'C', direction: 'up-then-down', span_octaves: 2,
    }),
    mode: 'cued',
    rubric: {
      id: 'hanon-steady-clean-v1',
      version: '1',
      criteria: { completeness: 1, cleanliness: 1, placement: 0.8 },
    },
    gates: { pace: { target_bpm: bpm } },
    required_passes: 1,
  };
}

export function buildLearningPrograms(exerciseBank) {
  if (!exerciseBank?.available?.()) return [];
  const category = exerciseBank.getCategory('drills/hanon');
  const ids = exerciseBank.listSeeds('drills/hanon');
  const steps = ids.map((seedId, index) => {
    const seed = exerciseBank.getSeed(seedId);
    if (!seed) return null;
    const requirement = hanonRequirement(seedId, finite(seed.tempo?.start_bpm) ?? 60);
    // Refuse a broken canonical reference at projection time. The authored
    // program must never hand a learner a dead route.
    if (!expandSeed(seed).some((instance) => instance.id === requirement.exercise_id)) return null;
    return {
      id: `hanon-${String(index + 1).padStart(2, '0')}`,
      order: index + 1,
      title: seed.title,
      subtitle: seed.subtitle ?? seed.focus ?? null,
      seed_id: seedId,
      requirement,
      mastery_bpm: [72, 84, 96, finite(seed.tempo?.target_bpm) ?? 108]
        .filter((value, position, list) => value > requirement.gates.pace.target_bpm && list.indexOf(value) === position),
    };
  }).filter(Boolean);

  if (!steps.length) return [];
  return [{
    schema_version: LEARNING_SCHEMA_VERSION,
    id: HANON_PROGRAM_ID,
    title: category?.title ?? 'Hanon — The Virtuoso Pianist',
    subtitle: category?.subtitle ?? 'Exercises 1–30',
    description: 'Thirty progressive studies for evenness, finger independence, and control.',
    featured: true,
    ordered: true,
    steps,
  }];
}

export function normalizeRequirement(input) {
  if (!input || typeof input !== 'object') return null;
  const exerciseId = input.exercise_id ?? input.exerciseId;
  if (typeof exerciseId !== 'string' || !exerciseId) return null;
  const rubric = input.rubric && typeof input.rubric === 'object' ? input.rubric : {};
  const criteria = rubric.criteria ?? input.criteria ?? {};
  const pace = input.gates?.pace ?? (input.pace_bpm != null ? { target_bpm: input.pace_bpm } : null);
  return {
    exercise_id: exerciseId,
    mode: input.mode ?? 'free',
    rubric: {
      id: rubric.id ?? 'exercise-pass-v1',
      version: String(rubric.version ?? '1'),
      criteria: Object.fromEntries(Object.entries(criteria)
        .map(([name, threshold]) => [name, finite(threshold)])
        .filter(([, threshold]) => threshold !== null)),
    },
    ...(pace ? { gates: { pace: { target_bpm: finite(pace.target_bpm ?? pace.targetBpm) } } } : {}),
    required_passes: Math.max(1, Math.floor(finite(input.required_passes ?? input.requiredPasses) ?? 1)),
  };
}

export function attemptExerciseId(attempt) {
  return attempt?.prompt?.exercise_id ?? attempt?.exercise_id ?? null;
}

export function attemptPurpose(attempt) {
  if (attempt?.purpose) return attempt.purpose;
  // Existing Gaming attempts predate the purpose field. They were deliberate
  // challenges, not free-play sessions, so retain their eligibility when they
  // carry enough criterion evidence.
  return attempt?.challenge_id ? 'challenge' : 'practice';
}

export function attemptSatisfies(attempt, requirementInput) {
  const requirement = normalizeRequirement(requirementInput);
  if (!requirement || attempt?.status !== 'completed' || attemptPurpose(attempt) !== 'challenge') return false;
  if (attemptExerciseId(attempt) !== requirement.exercise_id) return false;
  const criteria = attempt.criteria && typeof attempt.criteria === 'object' ? attempt.criteria : {};
  for (const [name, threshold] of Object.entries(requirement.rubric.criteria)) {
    if (!Number.isFinite(criteria[name]) || criteria[name] < threshold) return false;
  }
  const paceTarget = requirement.gates?.pace?.target_bpm;
  if (Number.isFinite(paceTarget)) {
    const actual = finite(attempt.gates?.pace?.actual)
      ?? finite(attempt.diagnostics?.achieved_bpm)
      ?? finite(attempt.metrics?.tempoBpm);
    if (!Number.isFinite(actual) || actual < paceTarget) return false;
  }
  return true;
}

export function requirementEvidence(attempts, requirement) {
  const matching = (attempts ?? []).filter((attempt) => attemptSatisfies(attempt, requirement));
  const needed = normalizeRequirement(requirement)?.required_passes ?? 1;
  return { passed: matching.length >= needed, passes: matching.length, required_passes: needed, attempts: matching };
}

function masteryFor(step, attempts) {
  const base = normalizeRequirement(step.requirement);
  if (!base) return null;
  let best = base.gates?.pace?.target_bpm ?? null;
  for (const bpm of step.mastery_bpm ?? []) {
    const requirement = clone(base);
    requirement.gates = { pace: { target_bpm: bpm } };
    if (requirementEvidence(attempts, requirement).passed) best = bpm;
  }
  return best;
}

export function projectProgram(program, attempts = []) {
  let priorPassed = true;
  let currentAssigned = false;
  const steps = program.steps.map((step) => {
    const evidence = requirementEvidence(attempts, step.requirement);
    const unlocked = priorPassed;
    const state = evidence.passed ? 'passed' : unlocked && !currentAssigned ? 'current' : 'upcoming';
    if (state === 'current') currentAssigned = true;
    priorPassed = priorPassed && evidence.passed;
    const masteryBpm = evidence.passed ? masteryFor(step, attempts) : null;
    const targetBpm = step.mastery_bpm?.at(-1) ?? null;
    return {
      ...clone(step), state, unlocked, passed: evidence.passed,
      mastery_bpm: masteryBpm,
      mastered: Number.isFinite(targetBpm) && masteryBpm >= targetBpm,
      pass_count: evidence.passes,
    };
  });
  const passed = steps.filter((step) => step.passed).length;
  return {
    ...clone(program), steps, passed_steps: passed, total_steps: steps.length,
    percent: steps.length ? Math.round((passed / steps.length) * 100) : 0,
    complete: steps.length > 0 && passed === steps.length,
    current_step: steps.find((step) => step.state === 'current') ?? null,
  };
}

export function buildLearningSummary({ programs = [], attempts = [], enrollments = [], assignment = null, legacyProgress = null } = {}) {
  const assignedIds = (assignment?.programs ?? []).map((entry) => typeof entry === 'string' ? entry : entry?.programId).filter(Boolean);
  const enrolledIds = (enrollments ?? []).map((entry) => typeof entry === 'string' ? entry : entry?.programId).filter(Boolean);
  const legacyHanon = Boolean(legacyProgress?.collections?.hannon || legacyProgress?.collections?.hanon);
  const activeIds = [...new Set([...assignedIds, ...enrolledIds, ...(legacyHanon ? [HANON_PROGRAM_ID] : [])])];
  const byId = new Map(programs.map((program) => [program.id, program]));
  const active = activeIds.map((id) => byId.get(id)).filter(Boolean).map((program) => ({
    ...projectProgram(program, attempts),
    required: assignedIds.includes(program.id),
    enrolled: enrolledIds.includes(program.id) || legacyHanon && program.id === HANON_PROGRAM_ID,
    legacy_enrollment: legacyHanon && program.id === HANON_PROGRAM_ID && !enrolledIds.includes(program.id),
  }));
  const next = active.find((program) => program.required && program.current_step)
    ?? active.find((program) => program.current_step)
    ?? null;
  const attemptedSeeds = new Map();
  for (const attempt of attempts) {
    const id = attemptExerciseId(attempt);
    if (!id) continue;
    const seedId = id.split('@')[0];
    const row = attemptedSeeds.get(seedId) ?? { attempts: 0, passed: false, best_score: null };
    row.attempts += 1;
    row.passed ||= attemptPurpose(attempt) === 'challenge' && attempt?.verdict?.passed === true;
    if (Number.isFinite(attempt.score)) row.best_score = Math.max(row.best_score ?? 0, attempt.score);
    attemptedSeeds.set(seedId, row);
  }
  return {
    programs: active,
    available_programs: programs.map((program) => ({
      id: program.id, title: program.title, subtitle: program.subtitle, description: program.description,
      featured: Boolean(program.featured), steps: program.steps.length,
      active: activeIds.includes(program.id), required: assignedIds.includes(program.id),
    })),
    next_up: next ? { program_id: next.id, program_title: next.title, step: next.current_step } : null,
    catalog_progress: Object.fromEntries(attemptedSeeds),
    assignment: assignment ?? { programs: [], updatedAt: null, assignedBy: null },
  };
}

export default {
  HANON_PROGRAM_ID,
  buildLearningPrograms,
  buildLearningSummary,
  normalizeRequirement,
  attemptSatisfies,
  requirementEvidence,
  projectProgram,
};
