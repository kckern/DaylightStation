/**
 * Which work a day-off tier still asks for (pure domain).
 *
 * A household break carries a tier (`schoolCalendar.mjs`). The tier decides
 * WHETHER the day is a school day; this module decides WHAT is still owed on
 * it. Each tier has a keep-list of selectors, each naming a curriculum
 * `subject` or a `program` id. An agenda entry the list does not keep is
 * excused for the day (`day_off`).
 *
 * Config: `school.yml → dayOffTiers`, top level, e.g.
 *
 *   dayOffTiers:
 *     stay-home:
 *       keep:
 *         - subject: scripture
 *         - program: piano-course
 *
 * A configured tier replaces that tier's default list whole; a tier left out
 * keeps its default. `normal` is never consulted (it is a school day) and
 * `away` keeps nothing unless configured otherwise.
 */
import { SUBJECT_IDS } from "./curriculum/unitValidation.mjs";
import { DAY_OFF_TIERS } from "./schoolCalendar.mjs";

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const STAY_HOME_KEEP = Object.freeze([
  Object.freeze({ subject: 'scripture' }),
  Object.freeze({ program: 'story-time' }),
  Object.freeze({ program: 'book-log' }),
  Object.freeze({ program: 'flashcards' }),
  Object.freeze({ program: 'sentence-ladder' }),
  Object.freeze({ program: 'piano-course' }),
]);

export const DEFAULT_DAY_OFF_POLICY = Object.freeze({
  'stay-home': Object.freeze({ keep: STAY_HOME_KEEP }),
  enrichment: Object.freeze({ keep: STAY_HOME_KEEP }),
  'major-holiday': Object.freeze({ keep: Object.freeze([Object.freeze({ subject: 'scripture' })]) }),
  away: Object.freeze({ keep: Object.freeze([]) }),
});

const CONFIGURABLE_TIERS = DAY_OFF_TIERS.filter((tier) => tier !== 'normal');

function readSelector(raw, where, errors) {
  if (!isObject(raw)) { errors.push(`${where} must be a {subject} or {program} mapping`); return null; }
  const hasSubject = raw.subject !== undefined;
  const hasProgram = raw.program !== undefined;
  if (hasSubject === hasProgram || Object.keys(raw).length !== 1) {
    errors.push(`${where} must name exactly one of subject or program`);
    return null;
  }
  if (hasSubject) {
    if (!SUBJECT_IDS.includes(raw.subject)) { errors.push(`${where} names an unknown subject: ${raw.subject}`); return null; }
    return { subject: raw.subject };
  }
  if (typeof raw.program !== 'string' || !raw.program.trim()) { errors.push(`${where} program must be an id`); return null; }
  return { program: raw.program.trim() };
}

/**
 * Validate `school.yml → dayOffTiers`. A bad block fails to the DEFAULTS, not
 * to "keep everything": a typo must not turn Christmas into a full school day.
 *
 * @returns {{errors: string[], policy: object}}
 */
export function readDayOffPolicy(raw) {
  if (raw === undefined || raw === null) return { errors: [], policy: DEFAULT_DAY_OFF_POLICY };
  if (!isObject(raw)) return { errors: ['dayOffTiers must be a mapping'], policy: DEFAULT_DAY_OFF_POLICY };
  const errors = [];
  const policy = { ...DEFAULT_DAY_OFF_POLICY };
  Object.entries(raw).forEach(([tier, body]) => {
    if (!CONFIGURABLE_TIERS.includes(tier)) {
      errors.push(`dayOffTiers has an unknown tier: ${tier} (expected one of ${CONFIGURABLE_TIERS.join(', ')})`);
      return;
    }
    if (!isObject(body) || !Array.isArray(body.keep)) {
      errors.push(`dayOffTiers.${tier}.keep must be a list`);
      return;
    }
    const unknownKeys = Object.keys(body).filter((key) => key !== 'keep');
    if (unknownKeys.length) errors.push(`dayOffTiers.${tier} has unknown keys: ${unknownKeys.join(', ')}`);
    const keep = body.keep.map((selector, index) => readSelector(selector, `dayOffTiers.${tier}.keep[${index}]`, errors));
    policy[tier] = { keep: keep.filter(Boolean) };
  });
  if (errors.length) return { errors, policy: DEFAULT_DAY_OFF_POLICY };
  return { errors, policy };
}

/**
 * Does this tier still ask for this agenda entry?
 *
 * A date-bound entry (an enrichment swap or a holiday activity) is the day's
 * special and is always kept, except on an away day, where nothing is.
 */
export function keepsEntry(policy, tier, entry) {
  if (entry?.dateBound) return tier !== 'away';
  const keep = (policy ?? DEFAULT_DAY_OFF_POLICY)[tier]?.keep ?? [];
  return keep.some((selector) => (selector.subject !== undefined
    ? selector.subject === entry?.subject
    : selector.program === entry?.program));
}

const nextDay = (day) => new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
const spanCovers = (spans, day) => (spans ?? []).some((span) => {
  const from = typeof span === 'string' ? span : span?.from;
  const to = typeof span === 'string' ? span : span?.to;
  return day >= from && day <= to;
});

/**
 * What a grown-up should fix in the household calendar, found once at boot:
 *
 * - `untiered`: labels of breaks with no tier. They still work (as `away`),
 *   but an untagged break is a decision nobody made.
 * - `missingAssignments`: enrichment / major-holiday breaks whose `assignment`
 *   is not a published unit whose `onDays` covers EVERY day of the break (and,
 *   for enrichment, whose subject is the one `replaces` names). The day still
 *   works as a stay-home day; the special just is not there.
 *
 * @param {{schedule: object|null, units?: Array<object>|null}} args
 *   `schedule` already normalized by `validateSchedule`; `units` the
 *   publishable catalog (omit to skip the assignment check).
 */
export function checkDayOffCalendar({ schedule, units = null } = {}) {
  const spans = schedule?.except ?? [];
  const untiered = spans.filter((span) => !span.tier).map((span) => span.label ?? `${span.from}..${span.to}`);
  if (!Array.isArray(units)) return { untiered, missingAssignments: [] };
  const byId = new Map(units.filter(Boolean).map((unit) => [unit.unitId, unit]));
  const missingAssignments = spans.filter((span) => span.assignment).filter((span) => {
    const unit = byId.get(span.assignment);
    if (!unit || !Array.isArray(unit.onDays)) return true;
    if (span.tier === 'enrichment' && span.replaces && unit.subject !== span.replaces) return true;
    for (let day = span.from; day <= span.to; day = nextDay(day)) {
      if (!spanCovers(unit.onDays, day)) return true;
    }
    return false;
  }).map((span) => ({ label: span.label ?? `${span.from}..${span.to}`, assignment: span.assignment }));
  return { untiered, missingAssignments };
}
