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
 *   { dayTag: 'Shopping', swingTag: 'Housewares', payees?: ['Amazon'], tolerance?: 67 }
 * `payees` limits swing buys to those descriptions (case-insensitive substring);
 * omit it to treat every purchase with the tag as fungible. `tolerance` is the
 * dollar gap left alone, default one day of budget.
 *
 * Pure: `today` (YYYY-MM-DD) comes from the caller.
 *
 * @module domains/finance/services/DayToDayRebalancer
 */

const MAX_CANDIDATES = 60;

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
 * 0/1 subset of `amounts` (integer cents) whose sum is closest to `need`.
 * Ties go to fewer items, then to the sum that does not overshoot.
 * @returns {number[]} indices into amounts, ascending
 */
export function closestSubset(amounts, need) {
  if (need <= 0 || !amounts.length) return [];
  const cap = need * 2; // a sum past 2×need is farther from need than taking nothing
  const INF = 0x7fff;
  const count = new Int16Array(cap + 1).fill(INF);
  count[0] = 0;
  const take = amounts.map(() => new Uint8Array(cap + 1));

  amounts.forEach((c, i) => {
    if (c <= 0 || c > cap) return;
    for (let s = cap; s >= c; s--) {
      if (count[s - c] !== INF && count[s - c] + 1 < count[s]) {
        count[s] = count[s - c] + 1;
        take[i][s] = 1;
      }
    }
  });

  let best = 0;
  for (let s = 1; s <= cap; s++) {
    if (count[s] === INF) continue;
    const d = Math.abs(s - need);
    const bd = Math.abs(best - need);
    if (d < bd
      || (d === bd && count[s] < count[best])
      || (d === bd && count[s] === count[best] && s <= need && best > need)) {
      best = s;
    }
  }

  // take[i][s] marks the last item that improved sum s, so walking items
  // backwards recovers the subset without reusing any of them.
  const picked = [];
  let s = best;
  for (let i = amounts.length - 1; i >= 0 && s > 0; i--) {
    if (take[i][s]) {
      picked.push(i);
      s -= amounts[i];
    }
  }
  return picked.reverse();
}

/**
 * @param {Object} args
 * @param {string} args.month - 'YYYY-MM'
 * @param {Object} args.monthData - compiled dayToDayBudget[month]
 * @param {Object} [args.shortTermBuckets] - compiled shortTermBuckets
 * @param {Object|null} args.rule - dayToDay.rebalance
 * @param {string} args.today - 'YYYY-MM-DD'
 * @returns {Object|null} null without a rule, without balances, or for a month not yet started
 */
export function planDayToDayRebalance({ month, monthData, shortTermBuckets, rule, today }) {
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
  const tolerance = rule.tolerance ?? round2(budget / days);

  const base = { month, asOf, budget, balance, target, gap, tolerance, moves: [], movedTotal: 0, balanceAfter: balance };
  if (Math.abs(gap) <= tolerance) return { ...base, status: 'on-pace' };

  const overspent = gap < 0;
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
    .filter((t) => (t.tagNames || []).includes(from))
    .filter((t) => !payees.length || payees.some((p) => (t.description || '').toLowerCase().includes(p)))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_CANDIDATES);

  const moves = closestSubset(
    candidates.map((t) => Math.round(amountOf(t) * 100)),
    Math.round(Math.abs(gap) * 100)
  )
    .map((i) => candidates[i])
    .map((t) => ({
      id: t.id,
      date: t.date,
      description: t.description,
      amount: amountOf(t),
      from,
      to,
      tags: (t.tagNames || []).map((tag) => (tag === from ? to : tag)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const movedTotal = round2(moves.reduce((sum, m) => sum + m.amount, 0));

  return {
    ...base,
    status: overspent ? 'overspent' : 'underspent',
    from,
    to,
    candidateCount: candidates.length,
    moves,
    movedTotal,
    balanceAfter: round2(overspent ? balance + movedTotal : balance - movedTotal),
  };
}
