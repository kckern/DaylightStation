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
 *   debriefs:    [{day, state: completed|excused|rejected|open|missed|unknown, timeliness, substantive, quiz:{right,graded}, quizPassed}],
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

/**
 * IAchievementEvidence.week(args) → {
 *   learners:    { [learnerId]: { days: {activity: [studyDay]}, milestones: {activity: [{key, day, label}]} } },
 *   contests:    { [activity]: { standings: [{learnerId, score}], closed } },
 *   unavailable: [activity],   // a provider that failed: its activities read indeterminate
 * }
 * args: { learnerIds, week: {from, to}, schoolMs: {fromMs, toMs}, ringMs: {fromMs, toMs},
 *         contestClosed, today, studyDay: (ms) => 'YYYY-MM-DD' }
 *
 * Achievements are the household's other activities (cycle races, Skyline
 * Glider, board games, piano, flashcards, reading, worksheets) for the
 * activity-days / activity-contest / milestone earn rules. Each producing
 * module implements a provider; `CompositeAchievementEvidence` merges them.
 */
export class IAchievementEvidence {
  // eslint-disable-next-line no-unused-vars
  async week(args) { throw new Error('IAchievementEvidence.week must be implemented'); }
}
