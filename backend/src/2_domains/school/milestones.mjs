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
