// Eligible factual messages only. Budget assessments own all calorie judgments;
// this module never infers completeness, maintenance or exercise credit.
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function observationFingerprintOf(entry) {
  return entry?.observationFingerprint ?? entry?.fingerprint ?? null;
}

/** A combined message remembers each fact, so a later kind cannot repeat it. */
export function observationFingerprintsOf(entry) {
  const fingerprints = [observationFingerprintOf(entry), ...(entry?.observationFingerprints || [])];
  if (entry?.kind === 'within_plan' && entry.facts?.proteinGap > 0) fingerprints.push(`protein_gap:day:${entry.date}`);
  return [...new Set(fingerprints.filter(value => typeof value === 'string' && value))];
}

/**
 * Observation facts are plain data, never channel markup or model prose.
 * Daily facts: {finished, goalBasis}, with kind-specific fields:
 * logging_incomplete {status, eventFoods}; within_plan {protein?,proteinGoal?,proteinGap?};
 * over_plan {overPlanKcal, belowMaintenance}; energy_surplus {surplusKcal};
 * protein_gap {protein,proteinGoal,proteinGap}; exercise_budget {exercise,planFood}.
 * Period facts: {from,to,trustedDays,totalDays,goalBasis}, plus verdict counts
 * for period_summary. evidenceDates lists precisely the dates supporting a claim.
 */
export function buildObservations({ type, evidence, proteinGoal, recentObservations = [], eventItems = [], activity = null } = {}) {
  if (!evidence) return [];
  const result = [];
  const seen = new Set(recentObservations.flatMap(observationFingerprintsOf));
  const add = (kind, date, evidenceDates, facts, priority, subject = 'day') => {
    const fingerprint = `${kind}:${subject}:${date}`;
    if (!seen.has(fingerprint)) result.push({ id: fingerprint, kind, date, evidenceDates, facts, priority, fingerprint });
  };
  const days = evidence.days || [];
  const period = evidence.period;
  const totalDays = period?.coverage.total || 0;
  const trustedDays = period?.coverage.trustedFinished || 0;
  const periodDates = days.map(day => day.date).filter(Boolean).sort();
  const from = periodDates[0];
  const to = periodDates.at(-1);
  const periodFacts = { from, to, trustedDays, totalDays, goalBasis: period?.goalBasis ?? null };

  if (type === 'weekly-digest') {
    if (totalDays > 0 && trustedDays >= totalDays / 2 && from && to) {
      const eligibleDates = days.filter(day => day.assessment?.availability === 'available' && day.assessment.finished && day.assessment.trustworthy && day.provenance !== 'reconstructed').map(day => day.date).sort();
      add('period_summary', `${from}/${to}`, eligibleDates,
        { ...periodFacts, ...period.counts }, 100, 'period');
    }
    if (totalDays > trustedDays && from && to) {
      add('logging_incomplete', `${from}/${to}`, periodDates, { ...periodFacts, status: 'period' }, 70, 'period');
    }
  } else {
    const day = type === 'morning-brief'
      ? [...days].sort((a, b) => a.date.localeCompare(b.date)).at(-1)
      : evidence.current;
    const assessment = day?.assessment;
    if (day?.date && assessment) {
      const reconstructed = day.provenance === 'reconstructed';
      const available = assessment.availability === 'available';
      const trustworthy = available && assessment.trustworthy && !reconstructed;
      const facts = { finished: assessment.finished, goalBasis: assessment.goalBasis };
      const date = day.date;
      const eventFoods = type === 'post-report'
        ? eventItems.filter(item => typeof item?.name === 'string' && item.name.trim()).slice(0, 3).map(item => item.name.trim()) : [];
      if (!trustworthy) {
        const status = reconstructed ? 'reconstructed' : !available || day.provenance === 'unknown' ? 'unavailable' : day.status === 'unlogged' ? 'unlogged' : assessment.finished ? 'incomplete' : 'in_progress';
        add('logging_incomplete', date, [date], { ...facts, status, eventFoods }, 90);
      } else {
        const proteinKnown = assessment.finished && assessment.proteinKnown && finite(day.protein) && finite(proteinGoal) && proteinGoal > 0;
        const proteinGap = proteinKnown ? Math.max(0, proteinGoal - day.protein) : 0;
        const proteinFacts = proteinKnown && !seen.has(`protein_gap:day:${date}`) ? { protein: day.protein, proteinGoal, proteinGap } : {};
        if (assessment.planState === 'within') add('within_plan', date, [date], { ...facts, ...proteinFacts }, 90);
        if (assessment.planState === 'over' && finite(assessment.overPlanKcal)) {
          add('over_plan', date, [date], { ...facts, overPlanKcal: assessment.overPlanKcal, belowMaintenance: assessment.energyState === 'below-maintenance' }, 90);
        }
        if (assessment.energyState === 'surplus' && finite(assessment.surplusKcal) && assessment.surplusKcal > 0) {
          add('energy_surplus', date, [date], { ...facts, surplusKcal: assessment.surplusKcal }, 95);
        }
        if (proteinGap > 0 && (assessment.planState !== 'within' || seen.has(`within_plan:day:${date}`))) add('protein_gap', date, [date], { ...facts, ...proteinFacts }, 80);
      }
      // Webhook burn describes an activity, never additional budget credit.
      if (type === 'exercise-reaction' && activity) {
        const activityBurn = activity.calories ?? activity.caloriesBurned;
        const sessions = day.sessions || day.budget?.sessions || [];
        const synced = activity.id != null && sessions.some(session => session.id != null && String(session.id) === String(activity.id));
        if (finite(activityBurn)) add('activity_burn', date, [date], { ...facts, activityBurn, synced }, 110, `activity:${activity.id ?? 'unknown'}`);
      }
      // Exercise arithmetic is available even while food logging is partial.
      if (type === 'exercise-reaction' && available && finite(assessment.exercise) && assessment.exercise > 0 && finite(assessment.planFood)) {
        add('exercise_budget', date, [date], { ...facts, exercise: assessment.exercise, planFood: assessment.planFood }, 100);
      }
    }
  }
  return result.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}
