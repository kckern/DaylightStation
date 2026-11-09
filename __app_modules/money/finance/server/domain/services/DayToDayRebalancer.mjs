/**
 * DayToDayRebalancer
 *
 * Plans the retags that keep day-to-day spending on its burn-down line. Some
 * purchases are fungible: an Amazon order can honestly be filed as day-to-day
 * (`dayTag`, e.g. Shopping) or under a short-term bucket (`swingTag`, e.g.
 * Housewares). Over pace → move day-to-day swing buys out to the bucket; under
 * pace → move the bucket's swing buys back in. Every other tag (Groceries,
 * Fuel, …) is not fungible and is never touched. When no fungible purchases
 * exist the plan has no moves — there is no wiggle room, and that is reported,
 * not forced.
 *
 * Rule — budget.config.yml `dayToDay.rebalance`:
 *   { dayTag: 'Shopping', swingTag: 'Housewares', payees?: ['Amazon'], tolerance?: 67, closedTolerance?: 5 }
 * `payees` limits swing buys to those descriptions (case-insensitive substring);
 * omit it to treat every purchase with the tag as fungible. `tolerance` is the
 * dollar gap left alone in the running month, default one day of budget;
 * `closedTolerance` is the same for the month just closed, default $5.
 *
 * Pure: `today` (YYYY-MM-DD) comes from the caller.
 *
 * @module domains/finance/services/DayToDayRebalancer
 */

const round2 = (n) => Math.round(n * 100) / 100;
const pad2 = (n) => String(n).padStart(2, '0');

function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** @returns {string} 'YYYY-MM' of the month before `month` */
export function previousMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`;
}

/**
 * Largest first: retag the biggest swing buy, re-measure, then the next
 * biggest, until the remaining gap is within `tolerance`. A buy that would
 * carry the balance past the line by more than `tolerance` is skipped in
 * favour of the next smaller one — overshooting would put the month off pace
 * the other way, and the next hourly sync would move buys straight back.
 * @param {number[]} amounts - integer cents
 * @param {number} need - integer cents
 * @param {number} [tolerance=0] - integer cents
 * @param {number} [room=Infinity] - integer cents the destination can still absorb
 * @returns {number[]} indices into amounts, in the order taken
 */
export function largestFirst(amounts, need, tolerance = 0, room = Infinity) {
  const order = amounts.map((c, i) => i).sort((a, b) => amounts[b] - amounts[a]);
  const picked = [];
  let remaining = need;
  let left = room;
  for (const i of order) {
    if (Math.abs(remaining) <= tolerance) break;
    const c = amounts[i];
    if (c <= 0 || c > remaining + tolerance || c > left) continue;
    picked.push(i);
    remaining -= c;
    left -= c;
  }
  return picked;
}

/**
 * @param {Object} args
 * @param {string} args.month - 'YYYY-MM'
 * @param {Object} args.monthData - compiled dayToDayBudget[month]
 * @param {Object} [args.shortTermBuckets] - compiled shortTermBuckets
 * @param {Object|null} args.rule - dayToDay.rebalance
 * @param {string} args.today - 'YYYY-MM-DD'
 * @param {number} [args.swingRoom] - dollars left in the short-term bucket that owns
 *   `swingTag`; caps what an over-pace month may move into it. Omit for no cap.
 * @returns {Object|null} null without a rule, without balances, or for a month not yet started
 */
export function planDayToDayRebalance({ month, monthData, shortTermBuckets, rule, today, swingRoom }) {
  if (!rule?.dayTag || !rule?.swingTag) return null;
  const dailyBalances = monthData?.dailyBalances;
  if (!dailyBalances || !Object.keys(dailyBalances).length) return null;

  const currentMonth = today.slice(0, 7);
  if (month > currentMonth) return null;

  const days = daysInMonth(month);
  const elapsed = month === currentMonth ? Number(today.slice(8, 10)) : days;
  const asOf = `${month}-${pad2(elapsed)}`;

  const budget = dailyBalances[`${month}-start`]?.startingBalance ?? monthData.budget ?? 0;
  const balance = dailyBalances[asOf]?.endingBalance ?? budget;
  const target = round2(budget * (1 - elapsed / days));
  const gap = round2(balance - target); // + under pace, − over pace
  // A running month moves every day, so it is left alone within a day of budget;
  // a closed month cannot drift, so it is closed out tight.
  const tolerance = month === currentMonth
    ? (rule.tolerance ?? round2(budget / days))
    : (rule.closedTolerance ?? 5);

  const base = { month, asOf, budget, balance, target, gap, tolerance, moves: [], movedTotal: 0, balanceAfter: balance };
  if (Math.abs(gap) <= tolerance) return { ...base, status: 'on-pace' };

  const overspent = gap < 0;
  // The target is today's close, so the running month reads up to a day under
  // pace before the day's spending lands. Pull buys back in only past twice the
  // tolerance, or a quiet day would drag swing buys in and the next grocery run
  // would push them straight back out.
  if (!overspent && month === currentMonth && gap <= 2 * tolerance) return { ...base, status: 'on-pace' };
  const from = overspent ? rule.dayTag : rule.swingTag;
  const to = overspent ? rule.swingTag : rule.dayTag;
  const pool = overspent
    ? (monthData.transactions || [])
    : Object.values(shortTermBuckets || {}).flatMap((b) => b.transactions || []);
  const payees = (rule.payees || []).map((p) => String(p).toLowerCase());
  const amountOf = (t) => t.expenseAmount ?? t.amount;

  const seen = new Set();
  const candidates = pool
    .filter((t) => {
      if (t.id == null || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    })
    .filter((t) => t.date >= `${month}-01` && t.date <= asOf)
    .filter((t) => amountOf(t) > 0)
    // Single-tag rows only: a row tagged [Shopping, Groceries] would stay in
    // day-to-day after the Shopping tag moved, so the "move" would not move it.
    .filter((t) => t.tagNames?.length === 1 && t.tagNames[0] === from)
    .filter((t) => !payees.length || payees.some((p) => (t.description || '').toLowerCase().includes(p)));

  // Over pace, the swing bucket must have room: moving an overspend into a
  // bucket that is already spent only hides it. Under pace there is no cap.
  const room = overspent && swingRoom != null ? Math.max(0, Math.round(swingRoom * 100)) : Infinity;
  const moves = largestFirst(
    candidates.map((t) => Math.round(amountOf(t) * 100)),
    Math.round(Math.abs(gap) * 100),
    Math.round(tolerance * 100),
    room
  )
    .map((i) => candidates[i])
    .map((t) => ({
      id: t.id,
      date: t.date,
      description: t.description,
      amount: amountOf(t),
      from,
      to,
      tags: [to],
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const movedTotal = round2(moves.reduce((sum, m) => sum + m.amount, 0));

  return {
    ...base,
    status: overspent ? 'overspent' : 'underspent',
    from,
    to,
    candidateCount: candidates.length,
    swingRoom: overspent && swingRoom != null ? swingRoom : null,
    moves,
    movedTotal,
    balanceAfter: round2(overspent ? balance + movedTotal : balance - movedTotal),
  };
}
