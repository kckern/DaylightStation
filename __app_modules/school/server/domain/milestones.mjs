/**
 * Milestones — expected-progress targets (teacher-console spec B4): "unit X
 * passed by date D". Due dates are FIXED facts; enrichment excusal (spec C5)
 * is a presentation-time adjustment at report level, never stored here.
 * Status is derived on every read from passed-unit evidence.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/** @returns {{errors: string[], milestone: object|null}} */
export function validateMilestone(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { errors: ['milestone must be an object'], milestone: null };
  if (!isNonEmptyString(raw.id)) errors.push('id is required');
  if (!isNonEmptyString(raw.learnerId)) errors.push('learnerId is required');
  if (!isNonEmptyString(raw.courseId)) errors.push('courseId is required');
  if (!isNonEmptyString(raw.unitId)) errors.push('unitId is required');
  if (!isNonEmptyString(raw.dueBy) || !DATE_RE.test(raw.dueBy)) errors.push('dueBy must be YYYY-MM-DD');
  if (raw.label !== undefined && typeof raw.label !== 'string') errors.push('label must be a string');
  if (errors.length) return { errors, milestone: null };
  return {
    errors: [],
    milestone: {
      id: raw.id, learnerId: raw.learnerId, courseId: raw.courseId,
      unitId: raw.unitId, dueBy: raw.dueBy, ...(raw.label ? { label: raw.label } : {}),
    },
  };
}

/**
 * 'met' beats the calendar (a pass after the due date is still met — the
 * pacing story belongs to the report, not the status); 'behind' only strictly
 * PAST the due day; the due day itself is still 'upcoming'.
 */
export function milestoneStatus(milestone, { passedUnitIds, today }) {
  if (passedUnitIds.has(milestone.unitId)) return 'met';
  return today > milestone.dueBy ? 'behind' : 'upcoming';
}

/**
 * Enrichment-aware pacing (spec C5): a 'behind' milestone whose overdue
 * window is fully covered by the learner's enrichment days is 'excused' —
 * out-of-band learning excuses pacing, never reads as delinquency. Days are
 * whole calendar dates; the excusable set is the enrichment dates falling
 * strictly AFTER the due day and no later than today.
 */
const dayMs = 86_400_000;
const parseDay = (d) => Date.parse(`${d}T00:00:00Z`);

function enrichmentDaysBetween(entries, { after, until }) {
  const days = new Set();
  for (const entry of entries) {
    if (typeof entry?.from !== 'string') continue;
    const to = typeof entry.to === 'string' ? entry.to : entry.from;
    for (let t = parseDay(entry.from); t <= parseDay(to); t += dayMs) {
      const date = new Date(t).toISOString().slice(0, 10);
      if (date > after && date <= until) days.add(date);
    }
  }
  return days.size;
}

export function paceMilestones(milestones, enrichmentEntries, { today }) {
  return milestones.map((m) => {
    if (m.status !== 'behind') {
      return { ...m, overdueDays: 0, excusedDays: 0, effectiveStatus: m.status };
    }
    const overdueDays = Math.max(0, Math.round((parseDay(today) - parseDay(m.dueBy)) / dayMs));
    const excusedDays = enrichmentDaysBetween(enrichmentEntries, { after: m.dueBy, until: today });
    return {
      ...m,
      overdueDays,
      excusedDays,
      effectiveStatus: excusedDays >= overdueDays ? 'excused' : 'behind',
    };
  });
}
