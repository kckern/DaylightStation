/**
 * The evidence a weekly earnings preview prices. Implemented by the producing
 * contexts (School, Fitness) and injected by composition — the economy never
 * reads their files. Fact vocabularies are the term grid's, verbatim.
 *
 * ISchoolEarningEvidence.schoolWeek({learnerId, week: {from, to}}) → {
 *   sectionDays: [{day, subject, state: served|obligated|excused|faulted, reason, timeliness}],
 *   days:        [{day, state: met|partial|none|exempt|unknown, reason, timeliness}],
 *   week:        {weekId, state, reason, open} | null,
 *   units:       [{day, unitId, subject, courseId, timeliness}],
 * }
 *
 * IRingEvidence.standings({learnerIds, fromMs, toMs}) → [{learnerId, rings}]
 *   every learner's rings from fitness sessions STARTED in [fromMs, toMs) — the award week.
 */
export class ISchoolEarningEvidence {
  // eslint-disable-next-line no-unused-vars
  async schoolWeek(args) { throw new Error('ISchoolEarningEvidence.schoolWeek must be implemented'); }
}

export class IRingEvidence {
  // eslint-disable-next-line no-unused-vars
  async standings(args) { throw new Error('IRingEvidence.standings must be implemented'); }
}
