// bankScreenModel.js — the pure reads behind BankScreen.jsx: the countdown to
// gold, history by day, what a kid can spend on and what is left to earn.
// Split out so the wording is tested without rendering, and so Fast Refresh
// can reload the screen on its own.
import { subjectLabel } from "../home/subjects.js";
import { labelize } from "../teacher/labelize.js";

/** The study day turns at 4 am (economy.md, "Study day"); a close at Monday 4 am is Sunday night's. */
export const BOUNDARY_HOURS = 4;
const DAY_MS = 86_400_000;
const COINS = ['silver', 'gold'];

/** Plain names for the privileges a pass opens. Anything else reads as its id, humanized. */
export const PRIVILEGE_LABELS = Object.freeze({
  'piano.games': 'One early piano game',
});

const pad = (n) => String(n).padStart(2, '0');
/** The browser's local calendar date (the panel runs in the household's zone). */
export const localDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const dayNumber = (day) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / DAY_MS;
const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * "becomes gold tonight" / "tomorrow night" / "in N days", from the bank's
 * `weekEndsAt` (the next Sunday close) and its `studyDay` (today).
 *
 * WHOLE CALENDAR DAYS, not 24-hour blocks. A close at Monday 4 am belongs to
 * Sunday's study day, so the close's day is read four hours earlier; on that
 * day it is "tonight". Counting 24-hour blocks would tell a kid on Saturday
 * morning "in 2 days" for something that happens tomorrow night. After the
 * close but before 4 am, `weekEndsAt` is already next Sunday, so this reads
 * "in 7 days". Null when either input is missing: no countdown beats a wrong one.
 */
export function goldCountdown({ weekEndsAt, studyDay = null, now = Date.now() } = {}) {
  const end = Date.parse(weekEndsAt ?? '');
  if (!Number.isFinite(end)) return null;
  if (end <= now) return 'becomes gold tonight';
  const today = isDay(studyDay) ? studyDay : localDay(now - BOUNDARY_HOURS * 3_600_000);
  const closeDay = localDay(end - BOUNDARY_HOURS * 3_600_000 - 1);
  const days = dayNumber(closeDay) - dayNumber(today);
  if (days <= 0) return 'becomes gold tonight';
  if (days === 1) return 'becomes gold tomorrow night';
  return `becomes gold in ${days} days`;
}

const DAY_HEADING = { weekday: 'long', month: 'short', day: 'numeric' };

/**
 * The history lines (newest first, as the bank sends them) grouped by the
 * local day they happened on, each group headed "Today", "Yesterday" or the
 * weekday and date. A line with no readable time goes in an "Earlier" group
 * at the end rather than being dropped.
 */
export function historyByDay(history = [], now = Date.now()) {
  const today = localDay(now);
  const yesterday = localDay(now - DAY_MS);
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

const coinWord = (coin) => coin;
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
        const canBuy = affordable === true || have >= price;
        return {
          coin, price,
          state: note ? null : (canBuy ? 'can buy at the piano' : `${price - have} more ${coinWord(coin)}`),
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
 * when the economy prices it; `reward` is null in production, so usually a
 * title alone) first, then every agenda section still `obligated`. Nothing
 * here invents an amount. `status` is `unavailable` only when both reads
 * failed; `done` when the plan says nothing is owed and there is no next sheet.
 */
export function earnItems({ agenda = null, next = null } = {}) {
  const items = [];
  const seen = new Set();
  const nextUnit = next?.unit ?? null;
  if (nextUnit && (nextUnit.title || nextUnit.unitId)) {
    seen.add(nextUnit.unitId);
    items.push({
      key: `next:${nextUnit.unitId ?? nextUnit.title}`,
      title: nextUnit.title || nextUnit.unitId,
      subject: nameFor(next.subject ?? nextUnit.subject ?? null),
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
      subject: nameFor(section.subject),
      reward: null,
      next: false,
    });
  }
  const status = sections || next ? 'ok' : 'unavailable';
  return { status, items, done: status === 'ok' && items.length === 0 && sections != null };
}
