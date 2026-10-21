/**
 * What printing and finishing ONE sheet (if passed) would add to a learner's
 * week, read off that week's preview. Pure: the priced week in,
 * `{silver, gems}` or null out. Null is the common answer, and it means "the
 * economy cannot say", never "nothing": a kid is shown an amount only when it
 * is the amount the payout would mint.
 *
 * The amount is what the line's TOTAL gains: the evaluator rounds
 * `count × silver × multiplier` for the whole line and a payout mints
 * `round(total) − paid`, so one more occurrence adds
 * `round((n+1)·s·m) − round(n·s·m)`, which under a fractional multiplier is
 * not `round(s·m)`.
 *
 * Which rules a sheet can be credited with:
 *   unit          its per-unit price, while the rule is in effect today —
 *                 every graded unit pays; matched on subject, unit-id prefix
 *                 and course, as `evaluate.mjs#matchesUnit` does
 *   section-day   one more day, while today's section is still obligated;
 *                 null once today's section is served (another sheet adds
 *                 nothing). Matched on subject only, as the evaluator does
 *   section-week  the week's price, only when today is the last thing left:
 *                 Friday or later, every earlier day served or excused, today
 *                 obligated, nothing after it, the line still pending.
 *                 Subject only
 *   day-met, week-met, ring-threshold, ring-contest
 *                 never: they pay for a day, a week or rings, not a sheet
 *
 * "Obligated today" assumes the sheet is required work and is passed; a unit
 * marked `elective` is null. A learner's override is priced as the payout
 * prices it (the line carries the resolved reward and multiplier).
 *
 * Null when the economy is not `live` (dry-run coins are not real), the school
 * evidence is not `ok`, no rule matches, more than one does, a match cannot be
 * decided (no subject on the unit, a unit rule keyed by a course the unit does
 * not name), or one more occurrence adds no silver and no gems.
 */

const SHEET_KINDS = new Set(['unit', 'section-day', 'section-week']);
const ADDS_UP = new Set(['served', 'excused']);
const UNDECIDED = Symbol('undecided');

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);

const inEffect = (effective, day) => !effective
  || ((!effective.from || day >= effective.from) && (!effective.to || day <= effective.to));

/**
 * `evaluate.mjs#matchesUnit`, plus UNDECIDED when the unit does not carry what
 * the rule keys on. Section rules match on subject only, as the evaluator does.
 */
function matchesSheet(line, unit) {
  const match = line.match ?? {};
  if (match.subject && unit.subject !== match.subject) return false;
  if (line.kind !== 'unit') return true;
  if (match.unitId && !String(unit.unitId ?? '').startsWith(match.unitId)) return false;
  if (match.courseId) {
    if (!unit.courseId) return UNDECIDED;
    if (unit.courseId !== match.courseId) return false;
  }
  return true;
}

/** What one more occurrence adds to the line's rounded total (`evaluate.mjs#price`). */
function oneMore(line) {
  const reward = line.priced?.reward;
  if (!reward) return null;
  const multiplier = line.priced.multiplier ?? 1;
  const n = Number.isInteger(line.count) && line.count >= 0 ? line.count : 0;
  const total = (count) => Math.round(count * (reward.silver ?? 0) * multiplier);
  const amount = { silver: total(n + 1) - total(n), gems: reward.gems ?? 0 };
  return amount.silver > 0 || amount.gems > 0 ? amount : null;
}

function sectionDay(line, week) {
  const todays = (line.evidence ?? []).filter((e) => e.day === week.today);
  if (todays.length !== 1 || todays[0].state !== 'obligated') return null;
  return oneMore(line);
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
  return oneMore(line);
}

function unitRule(line, week) {
  if (line.status !== 'earned' && line.status !== 'none') return null;
  if (!inEffect(line.effective, week.today)) return null;
  return oneMore(line);
}

/**
 * @param {object} args
 * @param {object|null} args.week - `EarningsPreviewService#preview`'s result (lines, today, windows, evidence, work)
 * @param {{unitId?: string, subject?: string|null, courseId?: string|null, elective?: boolean}} args.unit - the sheet
 * @param {string} [args.mode] - `catalog().mode`; anything but `live` is null
 * @returns {{silver: number, gems: number}|null}
 */
export function sheetReward({ week, unit, mode } = {}) {
  if (mode !== 'live' || !week || !unit || !unit.subject || !week.today) return null;
  if (unit.elective === true) return null;
  if (week.evidence?.school !== 'ok') return null;
  const candidates = [];
  for (const line of week.lines ?? []) {
    if (!SHEET_KINDS.has(line.kind) || line.status === 'disabled') continue;
    const m = matchesSheet(line, unit);
    if (m === UNDECIDED) return null;
    if (m) candidates.push(line);
  }
  if (candidates.length !== 1) return null;
  const [line] = candidates;
  if (line.kind === 'section-day') return sectionDay(line, week);
  if (line.kind === 'section-week') return sectionWeek(line, week);
  return unitRule(line, week);
}
