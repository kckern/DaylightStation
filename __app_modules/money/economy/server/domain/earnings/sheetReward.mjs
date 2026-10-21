/**
 * What printing and finishing ONE sheet would add to a learner's week, read
 * off that week's preview. Pure: the priced week in, `{silver, gems}` or null
 * out. Null is the common answer, and it means "the economy cannot say", never
 * "nothing": a kid is shown an amount only when it is the amount the payout
 * would mint.
 *
 * Which rules a sheet can be credited with (the unit's subject, course and id
 * against each rule's `match`):
 *   unit          its per-unit price — every graded unit pays
 *   section-day   one day's price, while today's section is still obligated;
 *                 null once today's section is served (another sheet adds nothing)
 *   section-week  the week's price, only when today is the last thing left:
 *                 Friday or later, every earlier day served or excused, today
 *                 obligated, nothing after it, the line still pending
 *   day-met, week-met, ring-threshold, ring-contest
 *                 never: they pay for a day, a week or rings, not a sheet
 *
 * Null when the economy is not `live` (dry-run coins are not real), the school
 * evidence is not `ok`, no rule matches, more than one does, a match cannot be
 * decided (no subject on the unit, a rule keyed by a course the unit does not
 * name), the matched rule carries a learner override, or the price is zero.
 */

const SHEET_KINDS = new Set(['unit', 'section-day', 'section-week']);
const ADDS_UP = new Set(['served', 'excused']);
const UNDECIDED = Symbol('undecided');

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** true, false, or UNDECIDED when the unit does not carry what the rule keys on. */
function matches(line, unit) {
  const match = line.match ?? {};
  if (match.subject && unit.subject !== match.subject) return false;
  if (match.unitId && !String(unit.unitId ?? '').startsWith(match.unitId)) return false;
  if (match.courseId) {
    if (!unit.courseId) return UNDECIDED;
    if (unit.courseId !== match.courseId) return false;
  }
  return true;
}

/** One occurrence at the learner's rate, as `evaluate.mjs#price` prices it. */
function oneOccurrence(line) {
  const reward = line.priced?.reward;
  if (!reward) return null;
  const multiplier = line.priced.multiplier ?? 1;
  const amount = { silver: Math.round((reward.silver ?? 0) * multiplier), gems: reward.gems ?? 0 };
  return amount.silver > 0 || amount.gems > 0 ? amount : null;
}

function sectionDay(line, week) {
  const todays = (line.evidence ?? []).filter((e) => e.day === week.today);
  if (todays.length !== 1 || todays[0].state !== 'obligated') return null;
  return oneOccurrence(line);
}

function sectionWeek(line, week) {
  if (line.status !== 'pending') return null;
  const monday = week.windows?.school?.from;
  if (!monday || week.today < addDays(monday, 4)) return null;
  if ((week.work?.days ?? []).some((d) => d.state === 'unknown')) return null;
  const evidence = line.evidence ?? [];
  if (evidence.some((e) => e.state === 'faulted')) return null;
  if (evidence.some((e) => e.day > week.today && e.state === 'obligated')) return null;
  if (!evidence.filter((e) => e.day < week.today).every((e) => ADDS_UP.has(e.state))) return null;
  const todays = evidence.filter((e) => e.day === week.today);
  if (todays.length !== 1 || todays[0].state !== 'obligated') return null;
  return oneOccurrence(line);
}

function unitRule(line) {
  if (line.status !== 'earned' && line.status !== 'none') return null;
  return oneOccurrence(line);
}

/**
 * @param {object} args
 * @param {object|null} args.week - `EarningsPreviewService#preview`'s result (lines, today, windows, evidence, work)
 * @param {{unitId?: string, subject?: string|null, courseId?: string|null}} args.unit - the sheet
 * @param {string} [args.mode] - `catalog().mode`; anything but `live` is null
 * @returns {{silver: number, gems: number}|null}
 */
export function sheetReward({ week, unit, mode } = {}) {
  if (mode !== 'live' || !week || !unit || !unit.subject || !week.today) return null;
  if (week.evidence?.school !== 'ok') return null;
  const candidates = [];
  for (const line of week.lines ?? []) {
    if (!SHEET_KINDS.has(line.kind) || line.status === 'disabled') continue;
    const m = matches(line, unit);
    if (m === UNDECIDED) return null;
    if (m) candidates.push(line);
  }
  if (candidates.length !== 1) return null;
  const [line] = candidates;
  if (line.overridden) return null;
  if (line.kind === 'section-day') return sectionDay(line, week);
  if (line.kind === 'section-week') return sectionWeek(line, week);
  return unitRule(line);
}
