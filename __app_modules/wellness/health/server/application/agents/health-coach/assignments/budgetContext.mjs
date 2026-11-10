import { assessBudgetDay } from '../../../../../portable/contracts/health/budgetAssessment.mjs';
import { summarizeBudgetPeriod } from '../../../../../portable/contracts/health/budgetPeriod.mjs';
import { buildObservations } from '../../../coaching/observations.mjs';
import { renderObservation } from '../../../coaching/observationText.mjs';
import { OutputValidator } from '../../../../../../../../__capabilities/agent-runtime/server/application/framework/OutputValidator.mjs';
import { coachingMessageSchema } from '../schemas/coachingMessage.mjs';

// Shared by the health-coach assignments that judge a day.
//
// A day's totals are trustworthy only when the budget says `complete`: it
// reached the floor, or the user declared it done/fasted. The time of day
// never makes a day complete (an under-logged evening is missing data, not a
// deficit). The floor and top come from the budget's range — the numbers the
// Today bar shows — not from the older nutrition goals in the coach's config.

export const DEFAULT_TZ = 'America/Los_Angeles';

/** The user's calendar date, `offsetDays` from now, as YYYY-MM-DD. */
export function localDate(offsetDays = 0, tz = DEFAULT_TZ, now = Date.now()) {
  return new Date(now + offsetDays * 86400000).toLocaleDateString('en-CA', { timeZone: tz });
}

/** The user's local hour (0–23), for pacing and tone only — never completeness. */
export function localHour(tz = DEFAULT_TZ, now = new Date()) {
  return Number.parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }), 10) % 24;
}

/** Explicit units replace legacy calorie targets in model context. */
export function goalsWithRange(goals, day) {
  const doc = goals?.goals ? goals : { goals: goals || {} };
  const { calories_min: legacyMin, calories_max: legacyMax, calories: legacyCalories, ...otherGoals } = doc.goals;
  const { calories_min, calories_max, calories, ...nutrition } = doc.goals?.nutrition || {};
  const assessment = day?.assessment;
  return { ...doc, goals: { ...otherGoals, nutrition: { ...nutrition,
    logging_floor: assessment?.floorFood ?? null, plan_food: assessment?.planFood ?? null,
    base_plan_net: assessment?.basePlan ?? null, exercise_credit: assessment?.exercise ?? null,
    budget_assessment: assessment?.availability ?? 'unavailable', goal_basis: assessment?.goalBasis ?? null,
  } } };
}

/** No legacy-goal fallback: unavailable budgets have unknown boundaries. */
export function rangeOf(day) {
  return { floor: day?.assessment?.floorFood ?? null, top: day?.assessment?.planFood ?? null };
}

/** Adapt existing tool projections without reconstructing budget facts from legacy goals. */
export function assignmentEvidence(gathered = {}) {
  const today = gathered.todayNutrition?.today || gathered.nutrition?.today || gathered.nutritionHistory?.today || localDate();
  const normalize = (day, date = today) => ({ ...day, date: day?.date || date,
    assessment: day?.assessment || assessBudgetDay(null, { date: day?.date || date, today }),
    provenance: day?.provenance || 'logged' });
  const days = (Array.isArray(gathered.nutritionHistory?.days) ? gathered.nutritionHistory.days : []).map(day => normalize(day));
  const current = normalize(gathered.todayNutrition || gathered.nutrition);
  return { userId: gathered.userId ?? null, date: current.date, today, current, days,
    period: summarizeBudgetPeriod(days.map(day => day.assessment)) };
}

export function assignmentObservations(type, gathered) {
  const evidence = assignmentEvidence(gathered);
  if (type === 'morning-brief') evidence.days = evidence.days.filter(day => day.date < evidence.today);
  return buildObservations({ type, evidence,
    proteinGoal: gathered.goals?.goals?.nutrition?.protein_min,
    activity: gathered.activity, eventItems: gathered.eventItems || [] });
}

const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Preserve the framework lifecycle while replacing unrestricted model prose. */
export function canonicalCoachingResult(raw, gathered, type, logger) {
  let parsed;
  try { parsed = typeof raw?.output === 'string' ? JSON.parse(raw.output) : raw?.output; } catch { /* deterministic fallback */ }
  const valid = parsed && OutputValidator.validate(parsed, coachingMessageSchema).valid;
  if (valid && parsed.should_send === false) return { should_send: false };
  if (!valid) logger?.warn?.('coaching.assignment.output_fallback', { assignmentType: type });
  const observations = assignmentObservations(type, gathered);
  // Morning tools may have no history at all; absence is an unavailable fact, not silence.
  const facts = observations.map(renderObservation).filter(Boolean);
  const configuredCtas = [
    ...(gathered.complianceCtas || []).map(cta => cta.message),
    ...(gathered.detectedPatterns || []).map(pattern => pattern.recommendation),
    ...(gathered.staleCalibration ? ['Your DEXA calibration anchor is stale; schedule a re-scan.'] : []),
  ].filter(text => typeof text === 'string' && text.trim());
  const text = [facts.join('\n') || 'Calorie-budget evidence is unavailable.', ...configuredCtas].join('\n');
  return { should_send: true, text: escape(text), parse_mode: 'HTML' };
}

/** Keep programmatic gathering intact; automated reasoning cannot invoke tools or SDK memory. */
export function automatedAssignmentDeps(deps) {
  return { ...deps, agentRuntime: { execute: request => deps.agentRuntime.execute({ ...request, tools: [], memory: false }) } };
}
