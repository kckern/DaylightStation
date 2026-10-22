// bankScreenModel.js — the pure reads behind BankScreen.jsx: the countdown to
// gold, history by day, what a kid can spend on and what is left to earn.
// Split out so the wording is tested without rendering, and so Fast Refresh
// can reload the screen on its own.
import { subjectLabel } from "../home/subjects.js";
import { labelize } from "../teacher/labelize.js";

const DAY_MS = 86_400_000;
const COINS = ['silver', 'gold'];

/** Plain names for the privileges a pass opens. Anything else reads as its id, humanized. */
export const PRIVILEGE_LABELS = Object.freeze({
  'piano.games': 'One early piano game',
});

/** The bank could not be read (any surface that shows the bank). */
export const NAPPING = 'The bank is napping. Try again soon.';

/** The word for where a ledger line's coins came from or went (`historyText.entrySource`). */
export const LEDGER_SOURCE_LABELS = Object.freeze({
  payout: 'Earned',
  earn: 'Earned',
  prize: 'Prize',
  refund: 'Refunded',
  spend: 'Spent',
  deposit: 'Deposit',
  correction: 'Correction',
  withdraw: 'Taken out',
  conversion: 'Converted',
});

const MINUS = '\u2212';
// Server wording lives in __app_modules/money/economy/server/domain/historyText.mjs (the browser cannot import it).
/** Singular/plural coin word: silver and gold never change, one gem is "gem". */
export const coinWord = (currency, n) => (currency === 'gems' && Math.abs(n) === 1 ? 'gem' : currency);

/**
 * One bank history line, worded for a ledger: where it came from (`sourceLabel`),
 * what it was (`label`), each signed amount, and the balance after it in the
 * coin(s) it moved. Reads only the structured fields the bank sends
 * (`source`, `label`, `legs`, `balanceAfter`); a line from an older server
 * without them falls back to its sentence, with no amounts and no balance.
 */
export function ledgerEntry(line) {
  const legs = (Array.isArray(line?.legs) ? line.legs : [])
    .filter((l) => l && Number.isFinite(l.delta) && l.delta !== 0)
    .map((l) => ({ currency: l.currency ?? 'silver', delta: l.delta }));
  const source = typeof line?.source === 'string' && line.source ? line.source : null;
  const after = line?.balanceAfter && typeof line.balanceAfter === 'object' ? line.balanceAfter : null;
  const currencies = [...new Set(legs.map((l) => l.currency))];
  const balanceText = after && currencies.length
    ? currencies.map((c) => {
      const n = Number.isFinite(after[c]) ? after[c] : 0;
      return `${n} ${coinWord(c, n)}`;
    }).join(' \u00b7 ')
    : null;
  return {
    key: (line?.ids ?? []).join('|') || `${line?.at ?? ''}:${line?.text ?? ''}`,
    source,
    sourceLabel: source ? (LEDGER_SOURCE_LABELS[source] ?? null) : null,
    label: typeof line?.label === 'string' && line.label ? line.label : (line?.text ?? ''),
    amounts: legs.map(({ currency, delta }) => ({ currency, delta, text: `${delta < 0 ? MINUS : '+'}${Math.abs(delta)} ${coinWord(currency, delta)}` })),
    sign: legs.length === 1 ? Math.sign(legs[0].delta) : 0,
    balanceText,
  };
}

const pad = (n) => String(n).padStart(2, '0');
/** The browser's local calendar date. Used only to group history lines. */
export const localDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
/** Days since the epoch for a `YYYY-MM-DD`, by pure date arithmetic (no timezone). */
const dayNumber = (day) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / DAY_MS;

/**
 * "becomes gold tonight" / "tomorrow night" / "in N days".
 *
 * BOTH DATES COME FROM THE SERVER: `studyDay` is today's study day and
 * `weekEndsOn` the study day the close belongs to, each in the household's
 * timezone with its 4 am boundary (`BankService.weekCloseStudyDay`). The count
 * is their difference in whole days, so a panel whose own clock is in another
 * zone says the same thing. `weekEndsAt` (the instant) is read only to notice
 * a close that has already passed: "becoming gold now". Null when either date
 * is missing: no countdown beats a wrong one.
 */
export function goldCountdown({ weekEndsOn = null, studyDay = null, weekEndsAt = null, now = Date.now() } = {}) {
  const end = Date.parse(weekEndsAt ?? '');
  if (Number.isFinite(end) && end <= now) return 'becoming gold now';
  if (!isDay(weekEndsOn) || !isDay(studyDay)) return null;
  const days = dayNumber(weekEndsOn) - dayNumber(studyDay);
  if (days <= 0) return 'becomes gold tonight';
  if (days === 1) return 'becomes gold tomorrow night';
  return `becomes gold in ${days} days`;
}

const DAY_HEADING = { weekday: 'long', month: 'short', day: 'numeric' };

/**
 * The history lines (newest first, as the bank sends them) grouped by the
 * browser's local calendar day, split at LOCAL MIDNIGHT (not the 4 am study
 * boundary: "Today" here means the calendar day on the panel's clock), each group headed "Today", "Yesterday" or the
 * weekday and date. A line with no readable time goes in an "Earlier" group
 * at the end rather than being dropped.
 */
export function historyByDay(history = [], now = Date.now()) {
  const today = localDay(now);
  // Calendar arithmetic, not `now - 24h`: a DST night is 23 or 25 hours long.
  const d = new Date(now);
  const yesterday = localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12).getTime());
  const groups = [];
  const byKey = new Map();
  for (const line of Array.isArray(history) ? history : []) {
    if (!line || typeof line.text !== 'string' || !line.text) continue;
    const at = Date.parse(line.at ?? '');
    const key = Number.isFinite(at) ? localDay(at) : 'earlier';
    if (!byKey.has(key)) {
      const label = key === 'earlier' ? 'Earlier'
        : key === today ? 'Today'
          : key === yesterday ? 'Yesterday'
            : new Date(at).toLocaleDateString(undefined, DAY_HEADING);
      const group = { key, label, lines: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    byKey.get(key).lines.push(line);
  }
  const earlier = byKey.get('earlier');
  return earlier ? [...groups.filter((g) => g !== earlier), earlier] : groups;
}

/**
 * Whether today's school is done, from the agenda preview's per-section
 * `obligation` (the same field `resolveDayCompletion` folds for
 * `GET /lifecycle/learners/:id/completion`, so one read answers both the
 * earn list and this). Null when it cannot say: no plan read, or a section
 * the planner could not judge.
 */
export function schoolDoneFrom(agenda) {
  const sections = agenda?.sections;
  if (!Array.isArray(sections)) return null;
  const live = sections.filter((s) => s && !s.suppressed && s.obligation?.state);
  if (live.some((s) => s.obligation.state === 'faulted')) return null;
  if ((agenda.errors ?? []).length) return null;
  return !live.some((s) => s.obligation.state === 'obligated');
}

const privilegeLabel = (privilege) => PRIVILEGE_LABELS[privilege] ?? labelize(String(privilege).replace(/[._]/g, '-'));

/**
 * What a kid can spend on, one item per privilege the bank quotes for sale.
 *
 * Each price row says one of: "can buy at the piano", or "N more silver"
 * (or gold). The item as a whole may say instead:
 *
 *   - "Can't check today's pass right now." when the pass read is `unknown`:
 *     never "used", never "available";
 *   - "Your early game is waiting at the piano." for a pass bought and not played;
 *   - "after school is done" once today's early pass is used up (`capUsed`,
 *     or a consumed/refunded pass): the privilege opens again when school is;
 *   - "Open now: school is done." on a complete day, when no pass is needed.
 *
 * No privilege on sale (every price 0, the shipped config) is `empty`.
 */
export function spendItems({ offers = {}, pass = {}, balances = {}, schoolDone = null } = {}) {
  const items = [];
  for (const [privilege, rows] of Object.entries(offers ?? {})) {
    const sold = (Array.isArray(rows) ? rows : [])
      .filter((r) => COINS.includes(r?.coin) && Number.isInteger(r.price) && r.price > 0);
    if (!sold.length) continue;
    const today = pass?.[privilege] ?? null;
    let note = null;
    if (!today || today.state === 'unknown') note = "Can't check today's pass right now.";
    else if (today.state === 'active') note = 'Your early game is waiting at the piano.';
    else if (schoolDone === true) note = 'Open now: school is done.';
    else if (today.capUsed === true || today.state === 'consumed' || today.state === 'refunded') note = 'after school is done';
    items.push({
      privilege,
      label: privilegeLabel(privilege),
      note,
      prices: sold.map(({ coin, price, affordable }) => {
        const have = Number.isFinite(balances?.[coin]) ? balances[coin] : 0;
        // The server's verdict wins (it folds the same ledger `buyPass` will);
        // the local count is only the fallback for a row without one.
        const canBuy = typeof affordable === 'boolean' ? affordable : have >= price;
        return {
          coin, price,
          // A server "no" over a local count that looks enough (a read in
          // between) has no honest number to give.
          state: note ? null : (canBuy ? 'can buy at the piano' : (price - have > 0 ? `${price - have} more ${coin}` : 'not enough yet')),
        };
      }),
    });
  }
  return { empty: items.length === 0, items };
}

const rewardText = (reward) => {
  const parts = [];
  if (Number.isFinite(reward?.silver) && reward.silver > 0) parts.push(`+${reward.silver} silver`);
  if (Number.isFinite(reward?.gems) && reward.gems > 0) parts.push(`+${reward.gems} gem${reward.gems === 1 ? '' : 's'}`);
  return parts.join(' · ') || null;
};

const nameFor = (subject) => {
  if (!subject) return 'Schoolwork';
  const label = subjectLabel(subject);
  return label === subject ? labelize(subject) : label;
};

/**
 * Today's remaining work: the next sheet (`GET .../next`, with its reward
 * when the economy prices it; `reward` is null unless the economy is live and
 * one rule prices the sheet, so often a title alone) first, then every agenda section still `obligated`. Nothing
 * here invents an amount. `status` is `unavailable` only when both reads
 * failed; `done` when the plan says nothing is owed and there is no next sheet.
 */
export function earnItems({ agenda = null, next = null } = {}) {
  const items = [];
  const seen = new Set();
  const nextUnit = next?.unit ?? null;
  if (nextUnit && (nextUnit.title || nextUnit.unitId)) {
    if (nextUnit.unitId) seen.add(nextUnit.unitId);
    items.push({
      key: `next:${nextUnit.unitId ?? nextUnit.title}`,
      title: nextUnit.title || nextUnit.unitId,
      reward: rewardText(next.reward),
      next: true,
    });
  }
  const sections = Array.isArray(agenda?.sections) ? agenda.sections : null;
  for (const section of sections ?? []) {
    if (!section || section.suppressed || section.obligation?.state !== 'obligated') continue;
    const unitId = section.next?.unitId ?? null;
    if (unitId && seen.has(unitId)) continue;
    if (unitId) seen.add(unitId);
    items.push({
      key: `agenda:${unitId ?? section.subject}`,
      title: section.next?.title || nameFor(section.subject),
      reward: null,
      next: false,
    });
  }
  const status = sections || next ? 'ok' : 'unavailable';
  return { status, items, done: status === 'ok' && items.length === 0 && sections != null };
}
