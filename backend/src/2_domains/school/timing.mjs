/**
 * Time-sensitive School planning — pure normalization, materialization, and
 * agenda priority. No clock reads or persistence: callers inject the household
 * study day so an agenda preview and a printed agenda make the same decision.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITY = Object.freeze({ low: 4, medium: 3, high: 2, urgent: 1, in_progress: 0 });

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isDay = (value) => typeof value === 'string' && DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const dayMs = 86_400_000;
const addDays = (day, offset) => new Date(Date.parse(`${day}T00:00:00Z`) + offset * dayMs).toISOString().slice(0, 10);
const compareDay = (left, right) => left.localeCompare(right);

export function studyDate(instant, timezone = null, boundaryHour = 4) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  // The agenda's "today" begins at 4am. Shifting before formatting gives
  // timing the same date boundary without coupling this pure module to a clock.
  const studyInstant = new Date(date.getTime() - boundaryHour * 3_600_000);
  if (!timezone) return studyInstant.toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(studyInstant);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const year = get('year'); const month = get('month'); const day = get('day');
  return year && month && day ? `${year}-${month}-${day}` : null;
}

/** A deliberately small, strict shape for already-materialized plan timing. */
export function normalizeTiming(raw) {
  if (raw == null) return { timing: null, errors: [] };
  const errors = [];
  if (!isObject(raw)) return { timing: null, errors: ['timing must be a mapping'] };

  const availability = isObject(raw.availability) ? raw.availability : {};
  const target = isObject(raw.target) ? raw.target : null;
  const agenda = isObject(raw.agenda) ? raw.agenda : {};
  const opensOn = availability.opensOn ?? null;
  const closesOn = availability.closesOn ?? null;
  const dueOn = target?.dueOn ?? null;
  const basePriority = raw.basePriority ?? 'medium';
  const flexibility = raw.flexibility ?? 'protected';
  const normalBlocks = agenda.normalBlocks ?? 1;
  const urgentBlocks = agenda.urgentBlocks ?? normalBlocks;
  const urgencyLeadDays = raw.urgencyLeadDays ?? 7;

  if (raw.schema !== undefined && raw.schema !== 'school.timing/v1') errors.push('timing.schema must be school.timing/v1');
  if (opensOn !== null && !isDay(opensOn)) errors.push('timing.availability.opensOn must be YYYY-MM-DD');
  if (closesOn !== null && !isDay(closesOn)) errors.push('timing.availability.closesOn must be YYYY-MM-DD');
  if (isDay(opensOn) && isDay(closesOn) && compareDay(opensOn, closesOn) > 0) errors.push('timing availability closes before it opens');
  if (dueOn !== null && !isDay(dueOn)) errors.push('timing.target.dueOn must be YYYY-MM-DD');
  if (target && !['firm', 'aspirational'].includes(target.strength ?? 'firm')) errors.push('timing.target.strength must be firm|aspirational');
  if (!Object.hasOwn(PRIORITY, basePriority) || ['urgent', 'in_progress'].includes(basePriority)) errors.push('timing.basePriority must be low|medium|high');
  if (!['protected', 'flexible'].includes(flexibility)) errors.push('timing.flexibility must be protected|flexible');
  if (!Number.isInteger(normalBlocks) || normalBlocks < 1) errors.push('timing.agenda.normalBlocks must be a positive integer');
  if (!Number.isInteger(urgentBlocks) || urgentBlocks < normalBlocks) errors.push('timing.agenda.urgentBlocks must be an integer >= normalBlocks');
  if (!Number.isInteger(urgencyLeadDays) || urgencyLeadDays < 0) errors.push('timing.urgencyLeadDays must be a non-negative integer');
  if (errors.length) return { timing: null, errors };

  return {
    errors: [],
    timing: {
      schema: 'school.timing/v1',
      ...(isObject(raw.anchor) ? { anchor: structuredClone(raw.anchor) } : {}),
      availability: { ...(opensOn ? { opensOn } : {}), ...(closesOn ? { closesOn } : {}) },
      ...(dueOn ? { target: { dueOn, strength: target?.strength ?? 'firm' } } : {}),
      basePriority, flexibility, agenda: { normalBlocks, urgentBlocks }, urgencyLeadDays,
    },
  };
}

/** Validate reusable syllabus timing before an anchor is chosen. */
export function normalizeTimingTemplate(raw) {
  if (raw == null) return { timingTemplate: null, errors: [] };
  if (!isObject(raw)) return { timingTemplate: null, errors: ['timingTemplate must be a mapping'] };
  const errors = [];
  const integer = (key, fallback = undefined) => raw[key] ?? fallback;
  const defaultAnchorId = raw.defaultAnchorId ?? null;
  const opensBeforeDays = integer('opensBeforeDays');
  const closesAfterDays = integer('closesAfterDays', 0);
  const targetOffsetDays = integer('targetOffsetDays');
  const targetStrength = raw.targetStrength ?? 'firm';
  const basePriority = raw.basePriority ?? 'medium';
  const flexibility = raw.flexibility ?? 'protected';
  const normalBlocks = integer('normalBlocks', 1);
  const urgentBlocks = integer('urgentBlocks', normalBlocks);
  const urgencyLeadDays = integer('urgencyLeadDays', 7);
  if (raw.schema !== undefined && raw.schema !== 'school.timing-template/v1') errors.push('timingTemplate.schema must be school.timing-template/v1');
  if (defaultAnchorId !== null && (typeof defaultAnchorId !== 'string' || !defaultAnchorId.trim())) errors.push('timingTemplate.defaultAnchorId must be a non-empty string');
  for (const [key, value] of Object.entries({ opensBeforeDays, closesAfterDays, targetOffsetDays, urgencyLeadDays })) {
    if (value !== undefined && (!Number.isInteger(value) || (key !== 'targetOffsetDays' && value < 0))) errors.push(`timingTemplate.${key} must be an integer${key === 'targetOffsetDays' ? '' : ' >= 0'}`);
  }
  if (!['firm', 'aspirational'].includes(targetStrength)) errors.push('timingTemplate.targetStrength must be firm|aspirational');
  if (!['low', 'medium', 'high'].includes(basePriority)) errors.push('timingTemplate.basePriority must be low|medium|high');
  if (!['protected', 'flexible'].includes(flexibility)) errors.push('timingTemplate.flexibility must be protected|flexible');
  if (!Number.isInteger(normalBlocks) || normalBlocks < 1) errors.push('timingTemplate.normalBlocks must be a positive integer');
  if (!Number.isInteger(urgentBlocks) || urgentBlocks < normalBlocks) errors.push('timingTemplate.urgentBlocks must be an integer >= normalBlocks');
  if ((opensBeforeDays !== undefined || targetOffsetDays !== undefined || closesAfterDays !== 0) && !defaultAnchorId) {
    errors.push('timingTemplate requires defaultAnchorId when it has date offsets');
  }
  if (errors.length) return { timingTemplate: null, errors };
  return {
    timingTemplate: {
      schema: 'school.timing-template/v1',
      ...(defaultAnchorId ? { defaultAnchorId } : {}),
      ...(opensBeforeDays !== undefined ? { opensBeforeDays } : {}),
      ...(closesAfterDays !== 0 ? { closesAfterDays } : {}),
      ...(targetOffsetDays !== undefined ? { targetOffsetDays } : {}),
      ...(targetOffsetDays !== undefined ? { targetStrength } : {}),
      basePriority, flexibility, normalBlocks, urgentBlocks, urgencyLeadDays,
    },
    errors: [],
  };
}

/** Resolve a stored fixed or annual anchor to its next useful occurrence. */
export function resolveTimingAnchor(anchor, { today, closesAfterDays = 0 } = {}) {
  if (!isObject(anchor) || !isDay(today)) throw new Error('resolveTimingAnchor requires an anchor and today YYYY-MM-DD');
  if (anchor.kind === 'fixed_date' && isDay(anchor.date)) return anchor.date;
  if (anchor.kind !== 'annual_date' || !Number.isInteger(anchor.month) || !Number.isInteger(anchor.day)) {
    throw new Error(`invalid timing anchor '${anchor?.anchorId ?? 'unknown'}'`);
  }
  const year = Number(today.slice(0, 4));
  const candidate = `${year}-${String(anchor.month).padStart(2, '0')}-${String(anchor.day).padStart(2, '0')}`;
  if (!isDay(candidate)) throw new Error(`invalid annual timing anchor '${anchor.anchorId ?? 'unknown'}'`);
  return compareDay(addDays(candidate, closesAfterDays), today) < 0
    ? `${year + 1}-${String(anchor.month).padStart(2, '0')}-${String(anchor.day).padStart(2, '0')}`
    : candidate;
}

/** Materialize a syllabus policy plus a resolved anchor into immutable plan dates. */
export function materializeTiming(template, anchor, { today } = {}) {
  const { timingTemplate, errors } = normalizeTimingTemplate(template);
  if (errors.length) throw new Error(`invalid timingTemplate: ${errors.join('; ')}`);
  if (!timingTemplate) throw new Error('timingTemplate is required');
  template = timingTemplate;
  const closesAfterDays = template.closesAfterDays ?? 0;
  const resolvedOn = resolveTimingAnchor(anchor, { today, closesAfterDays });
  const raw = {
    schema: 'school.timing/v1',
    anchor: { anchorId: anchor.anchorId, label: anchor.label ?? anchor.anchorId, resolvedOn },
    availability: {
      ...(Number.isInteger(template.opensBeforeDays) ? { opensOn: addDays(resolvedOn, -template.opensBeforeDays) } : {}),
      ...(Number.isInteger(closesAfterDays) ? { closesOn: addDays(resolvedOn, closesAfterDays) } : {}),
    },
    ...(Number.isInteger(template.targetOffsetDays) ? {
      target: { dueOn: addDays(resolvedOn, template.targetOffsetDays), strength: template.targetStrength ?? 'firm' },
    } : {}),
    basePriority: template.basePriority ?? 'medium',
    flexibility: template.flexibility ?? 'protected',
    agenda: { normalBlocks: template.normalBlocks ?? 1, urgentBlocks: template.urgentBlocks ?? template.normalBlocks ?? 1 },
    urgencyLeadDays: template.urgencyLeadDays ?? 7,
  };
  const { timing, errors: timingErrors } = normalizeTiming(raw);
  if (timingErrors.length) throw new Error(`invalid materialized timing: ${timingErrors.join('; ')}`);
  return timing;
}

/**
 * Decide an entry's timing state. Invalid parent-authored timing fails closed:
 * it remains dormant with a reason instead of silently changing a child's day.
 */
export function evaluateTiming(raw, { today, inProgress = false } = {}) {
  if (!isDay(today)) throw new Error('evaluateTiming requires today YYYY-MM-DD');
  const { timing, errors } = normalizeTiming(raw);
  if (!timing) {
    return raw == null
      ? { timing: null, state: 'available', priority: PRIORITY.medium, reasons: ['default_priority'] }
      : { timing: null, state: 'dormant', priority: PRIORITY.low, reasons: ['invalid_timing', ...errors] };
  }
  if (inProgress) return { timing, state: 'in_progress', priority: PRIORITY.in_progress, reasons: ['in_progress'] };
  const opensOn = timing.availability.opensOn;
  const closesOn = timing.availability.closesOn;
  if (opensOn && compareDay(today, opensOn) < 0) return { timing, state: 'upcoming', priority: PRIORITY[timing.basePriority], reasons: ['opens_later'] };
  if (closesOn && compareDay(today, closesOn) > 0) return { timing, state: 'dormant', priority: PRIORITY[timing.basePriority], reasons: ['availability_closed'] };
  const target = timing.target;
  if (target && compareDay(today, target.dueOn) > 0 && target.strength === 'firm') {
    return { timing, state: 'dormant', priority: PRIORITY[timing.basePriority], reasons: ['firm_target_missed'] };
  }
  if (target && compareDay(today, target.dueOn) > 0) {
    return { timing, state: 'missed_target', priority: PRIORITY[timing.basePriority], reasons: ['aspirational_target_missed'] };
  }
  if (target && compareDay(today, addDays(target.dueOn, -timing.urgencyLeadDays)) >= 0) {
    return { timing, state: 'urgent', priority: PRIORITY.urgent, reasons: [`due_on_${target.dueOn}`] };
  }
  return { timing, state: 'available', priority: PRIORITY[timing.basePriority], reasons: [`${timing.basePriority}_base_priority`] };
}

export const TIMING_PRIORITY = PRIORITY;
