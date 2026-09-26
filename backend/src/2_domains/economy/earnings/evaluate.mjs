/**
 * What a learner's week earns under the household's earn rules. Pure and
 * deterministic: facts in, priced lines out. Nothing here reads a clock or a
 * file; the caller windows the facts (school week Mon–Sun, ring award week
 * Mon 04:00 → Sat 12:00) and says whether the ring contest has closed.
 *
 * A line's status is one of:
 *   earned        the evidence pays (amount > 0)
 *   none          the evidence is complete and does not pay
 *   pending       the period is still open (a week under way, the contest before its close)
 *   indeterminate evidence is missing or faulted — never shown as "earned nothing" (H9)
 *   disabled      the rule is switched off for this learner
 *
 * Every line carries `ref` — learner + rule + period + timeliness — the
 * idempotency key a future payout uses. The rules revision is recorded on the
 * line (`priced`), never in the ref, so a rate edit cannot pay a week twice.
 */
import { resolveRules } from './ruleset.mjs';

const ZERO = Object.freeze({ silver: 0, gems: 0 });
const SCHOOL_KINDS = new Set(['unit', 'section-day', 'section-week', 'day-met', 'week-met']);

/** The payout idempotency key. `timeliness` is reserved for makeup work (D14). */
export function earningRef({ learnerId, ruleId, period, timeliness = 'on-time' }) {
  return `earn:${learnerId}:${ruleId}:${period}:${timeliness}`;
}

const inEffect = (effective, day) => !effective
  || ((!effective.from || day >= effective.from) && (!effective.to || day <= effective.to));

const overlaps = (effective, window) => !effective || !window
  || ((!effective.from || effective.from <= window.to) && (!effective.to || effective.to >= window.from));

const matchesUnit = (match, unit) => (!match.subject || unit.subject === match.subject)
  && (!match.courseId || unit.courseId === match.courseId)
  && (!match.unitId || String(unit.unitId ?? '').startsWith(match.unitId));

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);

const byDay = (a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0);

function price(rule, count) {
  return {
    silver: Math.round(count * rule.reward.silver * rule.multiplier),
    gems: count * rule.reward.gems,
  };
}

const paid = (amount) => amount.silver > 0 || amount.gems > 0;

function sectionDay(rule, facts, ctx) {
  const matched = facts.sectionDays.filter((f) => f.subject === rule.match.subject && inEffect(rule.effective, f.day)).sort(byDay);
  const served = matched.filter((f) => f.state === 'served');
  const faulted = matched.filter((f) => f.state === 'faulted');
  const amount = price(rule, served.length);
  const evidence = matched.map((f) => ({ day: f.day, state: f.state, reason: f.reason ?? null, ref: ctx.ref(f.day) }));
  if (served.length) return { status: 'earned', count: served.length, amount, evidence, note: faulted.length ? `${faulted.length} day(s) could not be checked` : null };
  if (faulted.length) return { status: 'indeterminate', count: 0, amount: ZERO, evidence, note: 'Could not check this subject' };
  return { status: 'none', count: 0, amount: ZERO, evidence, note: matched.length ? 'Not done this week' : 'Not on the plan this week' };
}

function sectionWeek(rule, facts, ctx) {
  const matched = facts.sectionDays.filter((f) => f.subject === rule.match.subject && inEffect(rule.effective, f.day)).sort(byDay);
  const evidence = matched.map((f) => ({ day: f.day, state: f.state, reason: f.reason ?? null }));
  if (matched.some((f) => f.state === 'faulted')) return { status: 'indeterminate', count: 0, amount: ZERO, evidence, note: 'A day could not be checked' };
  const missed = matched.filter((f) => f.state === 'obligated');
  const served = matched.filter((f) => f.state === 'served');
  if (!ctx.weekdaysCovered) {
    return { status: 'pending', count: 0, amount: ZERO, evidence, note: missed.length ? `Still to do: ${missed.map((f) => f.day).join(', ')}` : 'The week is still going' };
  }
  if (!missed.length && served.length) return { status: 'earned', count: 1, amount: price(rule, 1), evidence, note: null };
  const note = missed.length ? `Not done: ${missed.map((f) => f.day).join(', ')}` : 'Not done this week';
  return { status: 'none', count: 0, amount: ZERO, evidence, note };
}

function dayMet(rule, facts, ctx) {
  const matched = facts.days.filter((f) => inEffect(rule.effective, f.day)).sort(byDay);
  const met = matched.filter((f) => f.state === 'met');
  const unknown = matched.filter((f) => f.state === 'unknown');
  const evidence = matched.map((f) => ({ day: f.day, state: f.state, reason: f.reason ?? null, ref: ctx.ref(f.day) }));
  if (met.length) return { status: 'earned', count: met.length, amount: price(rule, met.length), evidence, note: unknown.length ? `${unknown.length} day(s) not worked out yet` : null };
  if (unknown.length) return { status: 'indeterminate', count: 0, amount: ZERO, evidence, note: 'Days not worked out yet' };
  return { status: 'none', count: 0, amount: ZERO, evidence, note: 'No green day yet' };
}

/**
 * A green week: every study day green AND the term grid's weekly row
 * satisfied (taxonomy §5). The week row alone covers weekly-cadence work only
 * — it reads `exempt / no_weekly_work` for a learner with none, however the
 * days went — so the days are folded here. Pays once the facts reach Friday
 * (Saturday is payday, D1), never earlier in the week.
 */
function weekMet(rule, facts, ctx) {
  const week = facts.week;
  if (!week) return { status: 'indeterminate', count: 0, amount: ZERO, evidence: [], note: 'No week verdict' };
  const schoolDays = facts.days.filter((d) => inEffect(rule.effective, d.day) && d.state !== 'exempt').sort(byDay);
  const evidence = [
    ...schoolDays.map((d) => ({ day: d.day, state: d.state, reason: d.reason ?? null })),
    { week: week.weekId, state: week.state, reason: week.reason ?? null },
  ];
  if (week.state === 'unknown' || schoolDays.some((d) => d.state === 'unknown')) {
    return { status: 'indeterminate', count: 0, amount: ZERO, evidence, note: 'Week not worked out yet' };
  }
  if (!ctx.weekdaysCovered) return { status: 'pending', count: 0, amount: ZERO, evidence, note: 'The week is still going' };
  const notGreen = schoolDays.filter((d) => d.state !== 'met');
  if (notGreen.length) return { status: 'none', count: 0, amount: ZERO, evidence, note: `Not green: ${notGreen.map((d) => d.day).join(', ')}` };
  if (!schoolDays.length) return { status: 'none', count: 0, amount: ZERO, evidence, note: 'No school days this week' };
  if (!['met', 'exempt'].includes(week.state)) {
    return week.open
      ? { status: 'pending', count: 0, amount: ZERO, evidence, note: 'Weekly work still to do' }
      : { status: 'none', count: 0, amount: ZERO, evidence, note: 'Weekly work not finished' };
  }
  return { status: 'earned', count: 1, amount: price(rule, 1), evidence, note: null };
}

function unit(rule, facts, ctx) {
  const matched = facts.units.filter((u) => matchesUnit(rule.match, u) && inEffect(rule.effective, u.day)).sort(byDay);
  const evidence = matched.map((u) => ({ day: u.day, unitId: u.unitId, subject: u.subject ?? null, ref: ctx.ref(u.unitId) }));
  if (!matched.length) return { status: 'none', count: 0, amount: ZERO, evidence, note: 'None this week' };
  return { status: 'earned', count: matched.length, amount: price(rule, matched.length), evidence, note: null };
}

function ringThreshold(rule, facts) {
  const rings = facts.rings;
  if (!Number.isFinite(rings)) return { status: 'indeterminate', count: 0, amount: ZERO, evidence: [], note: 'Rings unavailable' };
  const crossed = rule.thresholds.filter((t) => rings >= t.at);
  const next = rule.thresholds.find((t) => rings < t.at);
  const amount = {
    silver: Math.round((Math.floor(rings / rule.rate.rings) * rule.rate.silver + crossed.reduce((s, t) => s + t.reward.silver, 0)) * rule.multiplier),
    gems: crossed.reduce((s, t) => s + t.reward.gems, 0),
  };
  const evidence = rule.thresholds.map((t) => ({ threshold: t.at, reached: rings >= t.at }));
  const note = next ? `${next.at - rings} more to ${next.at}` : (rule.thresholds.length ? 'Every threshold reached' : null);
  return { status: paid(amount) ? 'earned' : 'none', count: rings, amount, evidence, note };
}

function ringContest(rule, facts, ctx) {
  const standings = ctx.standings;
  if (!Array.isArray(standings)) return { status: 'indeterminate', count: 0, amount: ZERO, evidence: [], note: 'Rings unavailable', leader: false };
  const best = Math.max(0, ...standings.map((s) => (Number.isFinite(s.rings) ? s.rings : 0)));
  const leaders = best > 0 ? standings.filter((s) => s.rings === best).map((s) => s.learnerId) : [];
  const leader = leaders.includes(ctx.learnerId);
  const mine = standings.find((s) => s.learnerId === ctx.learnerId)?.rings ?? facts.rings ?? 0;
  if (!leader) return { status: ctx.contestClosed ? 'none' : 'pending', count: mine, amount: ZERO, evidence: [], note: null, leader: false };
  if (leaders.length > 1 && rule.tie === 'none') return { status: ctx.contestClosed ? 'none' : 'pending', count: mine, amount: ZERO, evidence: [], note: 'Tied — this contest pays no tie', leader: true };
  const share = leaders.length > 1 && rule.tie === 'split' ? leaders.length : 1;
  const amount = {
    silver: Math.round(Math.floor(rule.reward.silver / share) * rule.multiplier),
    gems: Math.floor(rule.reward.gems / share),
  };
  if (!ctx.contestClosed) return { status: 'pending', count: mine, amount, evidence: [], note: 'Leading — decided Saturday noon', leader: true };
  return { status: paid(amount) ? 'earned' : 'none', count: mine, amount, evidence: [], note: leaders.length > 1 ? 'Tied for the most rings' : null, leader: true };
}

const EVALUATORS = {
  'section-day': sectionDay,
  'section-week': sectionWeek,
  'day-met': dayMet,
  'week-met': weekMet,
  unit,
  'ring-threshold': ringThreshold,
  'ring-contest': ringContest,
};

function windowDates(window) {
  if (!window) return null;
  return { from: String(window.from).slice(0, 10), to: String(window.to).slice(0, 10) };
}

/**
 * @param {object} args
 * @param {object} args.ruleset - validated (`validateRuleset`)
 * @param {string} args.learnerId
 * @param {{sectionDays: object[], days: object[], week: object|null, units: object[], rings: number|null}} args.facts
 * @param {Array<{learnerId: string, rings: number}>|null} args.standings - the roster's award-week rings (contest)
 * @param {boolean} args.contestClosed - the award week has closed
 * @param {{school: {from, to}, rings: {from, to}}} args.windows
 * @param {{school?: boolean}} [args.unavailable] - a whole evidence source failed:
 *   its lines are indeterminate, never read as "not done". (Rings signal the
 *   same with `rings: null` / `standings: null`.)
 */
export function evaluateEarnings({ ruleset, learnerId, facts, standings = null, contestClosed = false, windows, unavailable = {} }) {
  const f = { sectionDays: [], days: [], week: null, units: [], rings: null, ...(facts ?? {}) };
  const schoolDates = windowDates(windows?.school);
  // A week's verdict can only be final once its evidence reaches Friday (or
  // the week has closed): all-green-so-far on a Wednesday is still pending.
  const weekId = f.week?.weekId ?? schoolDates?.from ?? null;
  const friday = weekId ? addDays(weekId, 4) : null;
  const weekdaysCovered = f.week?.open === false
    || (friday != null && [...f.days, ...f.sectionDays].some((d) => d.day >= friday));
  const ringDates = windowDates(windows?.rings);
  const lines = [];
  for (const rule of resolveRules(ruleset, learnerId)) {
    const school = SCHOOL_KINDS.has(rule.kind);
    const dates = school ? schoolDates : ringDates;
    if (!overlaps(rule.effective, dates)) continue;
    const period = dates?.from ?? 'unknown';
    const ref = earningRef({ learnerId, ruleId: rule.id, period });
    const priced = {
      revision: ruleset.revision, reward: rule.reward, multiplier: rule.multiplier,
      ...(rule.kind === 'ring-threshold' ? { rate: rule.rate, thresholds: rule.thresholds } : {}),
    };
    const base = { ruleId: rule.id, label: rule.label, kind: rule.kind, match: rule.match, overridden: rule.overridden, priced, ref };
    if (rule.disabled) {
      lines.push({ ...base, status: 'disabled', count: 0, amount: ZERO, evidence: [], note: 'Off for this learner' });
      continue;
    }
    if (school && unavailable.school) {
      lines.push({ ...base, status: 'indeterminate', count: 0, amount: ZERO, evidence: [], note: 'School evidence unavailable' });
      continue;
    }
    const ctx = {
      learnerId, standings, contestClosed, weekdaysCovered,
      ref: (occurrence) => earningRef({ learnerId, ruleId: rule.id, period: occurrence }),
    };
    lines.push({ ...base, ...EVALUATORS[rule.kind](rule, f, ctx) });
  }
  const sum = (status) => lines.filter((l) => l.status === status)
    .reduce((t, l) => ({ silver: t.silver + l.amount.silver, gems: t.gems + l.amount.gems }), { silver: 0, gems: 0 });
  return {
    learnerId,
    currency: ruleset.currency ?? 'silver',
    rulesRevision: ruleset.revision,
    windows,
    totals: sum('earned'),
    pending: sum('pending'),
    lines,
  };
}
