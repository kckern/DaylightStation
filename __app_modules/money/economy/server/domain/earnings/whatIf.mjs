/**
 * A week's facts, as if one subject were done on one day. Pure: the earnings
 * preview prices the result against the same rules, so "what is this sheet
 * worth" can never disagree with "what did the week earn".
 *
 * It never decides on its own whether a DAY is green — that is School's
 * term-verdict judgement. The caller says so (`finishesDay`).
 */
const ON_TIME = 'on-time';

export function withSubjectDone(facts, { day, subject, unitId = null, courseId = null, finishesDay = false } = {}) {
  const f = { sectionDays: [], days: [], week: null, units: [], ...(facts ?? {}) };
  let found = false;
  const sectionDays = f.sectionDays.map((row) => {
    if (row.day !== day || row.subject !== subject) return row;
    found = true;
    return { ...row, state: 'served' };
  });
  if (!found) sectionDays.push({ day, subject, state: 'served', reason: null, timeliness: ON_TIME });
  const units = unitId
    ? [...f.units, { day, unitId, subject, courseId, result: 'passed', timeliness: ON_TIME }]
    : [...f.units];
  let days = [...f.days];
  if (finishesDay) {
    const has = days.some((d) => d.day === day);
    days = has
      ? days.map((d) => (d.day === day ? { ...d, state: 'met' } : d))
      : [...days, { day, state: 'met', reason: null, timeliness: ON_TIME }];
  }
  return { ...f, sectionDays, days, units };
}
