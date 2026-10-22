/**
 * The ledger in plain words, for a kid reading their bank:
 *
 *   +2 silver · Isaiah 50–51 passed      a payout, named by its evidence line
 *   +5 silver · Scripture (whole week)   …or by its rule label, then "schoolwork"
 *   +2 silver · Korean · Tuesday         a per-day payout: the day(s) it paid for
 *   +4 silver · Rings · 540 this week    a ring payout: the week's rings when it paid
 *   −3 silver · early pass               a pass bought
 *   +3 silver · early pass refunded      its refund (both matched on `source: pass`)
 *   12 silver → 12 gold · Sunday         a week close: both convert halves, one line
 *
 * The part after the label (`detail`) comes from the `meta` PayoutService
 * keeps on the entry (`payoutMeta`); an entry minted before that has none and
 * reads as its label alone.
 *
 * Each line also carries `source`, `label`, `detail`, signed `legs` and `balanceAfter`,
 * so a surface can show where coins came from and the running balance
 * without parsing the sentence or the ledger ref.
 *
 * Wording lives in two places on purpose: this file words the server's
 * sentences; the browser words its own screens in
 * `__app_modules/learning/school/browser/bank/bankScreenModel.js`. The browser
 * cannot import server code, so keep the two in step by hand.
 *
 * Pure: the caller supplies the labels. `evidenceLabels` maps an entry's
 * `evidenceRef` (a preview line's ref) to what that line says; `ruleLabels`
 * maps a rule id to the ruleset's label, for lines older than the current
 * preview. Pass markers (kind `pass`, delta 0) move no coin and are left out.
 */

const MINUS = '−';
// Only EconomyService's pass methods write `source: pass`.
const PASS_SOURCE = 'pass';

const lookup = (labels, key) => {
  if (key == null || labels == null) return null;
  const v = labels instanceof Map ? labels.get(key) : labels[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

const coinName = (currency, n) => (currency === 'gems' && Math.abs(n) === 1 ? 'gem' : currency);
const amount = (delta, currency) => `${delta < 0 ? MINUS : '+'}${Math.abs(delta)} ${coinName(currency, delta)}`;
const words = (action) => String(action ?? '').replace(/^payout:/, '').replace(/[-_]+/g, ' ').trim() || 'entry';
const withNote = (phrase, note) => (typeof note === 'string' && note.trim() ? `${phrase}: ${note.trim()}` : phrase);

const leg = (t) => ({ currency: t.currency ?? 'silver', delta: t.delta });

/**
 * What kind of line this is, for a surface that names where coins came from
 * or went: a payout, a plain earn, a prize, a pass refund, a spend, a deposit,
 * a correction, a withdrawal or a conversion.
 */
export function entrySource(t) {
  switch (t?.kind) {
    case 'convert': return 'conversion';
    case 'earn':
    case 'prize':
      if (typeof t.action === 'string' && t.action.startsWith('payout:')) return 'payout';
      if (t.kind === 'earn' && t.source === PASS_SOURCE) return 'refund';
      return t.kind;
    case 'spend': return 'spend';
    case 'deposit': return 'deposit';
    case 'adjust': return 'correction';
    case 'withdraw': return 'withdraw';
    default: return 'other';
  }
}

/**
 * The balance after each entry of a newest-first list (same index), folded
 * oldest first over the WHOLE read, each currency floored at 0 like
 * `foldBalances`. Computed before any cut, so line 50 still knows what the
 * 51st and older entries left behind.
 */
function balancesAfter(list) {
  const sums = { silver: 0, gold: 0, gems: 0 };
  const after = new Array(list.length);
  for (let k = list.length - 1; k >= 0; k -= 1) {
    const currency = list[k].currency ?? 'silver';
    if (currency in sums) sums[currency] += list[k].delta;
    after[k] = { silver: Math.max(0, sums.silver), gold: Math.max(0, sums.gold), gems: Math.max(0, sums.gems) };
  }
  return after;
}

function weekday(at, timezone) {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', ...(timezone ? { timeZone: timezone } : {}) }).format(new Date(ms));
  } catch {
    return null;
  }
}

/** What one entry's line says after the amount. */
function phrase(t, { ruleLabels, evidenceLabels }) {
  const action = typeof t.action === 'string' ? t.action : '';
  const payout = action.startsWith('payout:');
  switch (t.kind) {
    case 'earn':
    case 'prize':
      if (payout) return lookup(evidenceLabels, t.evidenceRef) ?? lookup(ruleLabels, t.ruleId) ?? (t.kind === 'prize' ? 'prize' : 'schoolwork');
      if (t.kind === 'earn' && t.source === PASS_SOURCE) return 'early pass refunded';
      return words(action);
    case 'spend':
      return t.source === PASS_SOURCE ? 'early pass' : words(action);
    case 'deposit': return withNote('deposit', t.note);
    case 'adjust': return withNote('correction', t.note);
    case 'withdraw': return withNote('withdrawn', t.note);
    default: return words(action);
  }
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayName = (day) => WEEKDAY[new Date(`${day}T12:00:00.000Z`).getUTCDay()];
const DAY_KINDS = new Set(['section-day', 'day-met']);
const RING_KINDS = new Set(['ring-threshold', 'ring-contest']);

/**
 * What each payout entry was for, by index, from its `meta`: the study days
 * it paid (a per-day line's days not already paid by an older entry of the
 * same ref and currency) or the week's ring count. Folded oldest first.
 */
function payoutDetails(list) {
  const details = new Array(list.length).fill(null);
  const seen = new Map(); // `${currency}|${ref}` → days already paid
  for (let k = list.length - 1; k >= 0; k -= 1) {
    const t = list[k];
    const meta = t.meta;
    if (!meta || typeof meta !== 'object') continue;
    if (DAY_KINDS.has(meta.kind) && Array.isArray(meta.days)) {
      const key = `${t.currency ?? 'silver'}|${t.ref}`;
      const before = seen.get(key) ?? new Set();
      const fresh = meta.days.filter((d) => !before.has(d));
      seen.set(key, new Set([...before, ...meta.days]));
      if (fresh.length) details[k] = { days: fresh, text: fresh.map(dayName).join(', ') };
    } else if (RING_KINDS.has(meta.kind) && Number.isFinite(meta.count)) {
      details[k] = { text: `${meta.count.toLocaleString('en-US')} this week` };
    }
  }
  return details;
}

// "Korean (each day done)" says how the rule pays; once the line names the day, the bracket is noise.
const withoutRuleNote = (label) => label.replace(/\s*\([^)]*\)\s*$/, '') || label;

/** One entry as a sentence ("+2 silver · Isaiah 50–51 passed"). Convert halves read alone. */
export function entrySentence(t, opts = {}) {
  const currency = t.currency ?? 'silver';
  if (t.kind === 'convert') {
    const day = weekday(t.at, opts.timezone);
    return [amount(t.delta, currency), t.delta < 0 ? 'converted' : 'from a conversion', day].filter(Boolean).join(' · ');
  }
  return `${amount(t.delta, currency)} · ${phrase(t, opts)}`;
}

/**
 * The entries (newest first, as `getHistory` returns them) as lines:
 * `{ text, at, kind, ids, source, label, detail, legs, balanceAfter }`. The two halves
 * of a conversion, sharing an `evidenceRef` with opposite signs, become one
 * line: "12 silver → 12 gold · Sunday", placed where the first half appears,
 * with both legs (spend half first). `at` is not compared, so a pair whose
 * second half a repair wrote later still reads as one; the weekday is the
 * spending half's. Zero-delta entries are skipped. `label` is the words after
 * the amount, `source` is `entrySource`, and `balanceAfter` the balances once
 * the line (both halves of a pair) has landed.
 * @param {object[]} entries
 * @param {{ruleLabels?: object|Map, evidenceLabels?: object|Map, timezone?: string|null}} [opts]
 */
export function historyLines(entries, opts = {}) {
  const list = (entries ?? []).filter((t) => t && Number.isFinite(t.delta) && t.delta !== 0);
  const after = balancesAfter(list);
  const details = payoutDetails(list);
  const used = new Set();
  const lines = [];
  list.forEach((t, i) => {
    if (used.has(i)) return;
    if (t.kind === 'convert') {
      const key = t.evidenceRef ?? null;
      const j = key == null ? -1 : list.findIndex((u, k) => k !== i && !used.has(k) && u.kind === 'convert'
        && u.evidenceRef === key && Math.sign(u.delta) !== Math.sign(t.delta));
      if (j >= 0) {
        used.add(j);
        const [out, back] = t.delta < 0 ? [t, list[j]] : [list[j], t];
        const day = weekday(out.at, opts.timezone);
        const from = coinName(out.currency ?? 'silver', out.delta);
        const to = coinName(back.currency ?? 'silver', back.delta);
        const text = `${-out.delta} ${from} → ${back.delta} ${to}${day ? ` · ${day}` : ''}`;
        lines.push({
          text, at: t.at, kind: 'convert', ids: [t.id, list[j].id],
          source: 'conversion', label: `${from} → ${to}`, detail: null, legs: [leg(out), leg(back)], balanceAfter: after[Math.min(i, j)],
        });
        return;
      }
    }
    const detail = details[i];
    const label = t.kind === 'convert' ? (t.delta < 0 ? 'converted' : 'from a conversion') : phrase(t, opts);
    const named = detail?.days ? withoutRuleNote(label) : label;
    lines.push({
      text: detail ? `${amount(t.delta, t.currency ?? 'silver')} · ${named} · ${detail.text}` : entrySentence(t, opts),
      at: t.at, kind: t.kind, ids: [t.id],
      source: entrySource(t),
      label: named,
      detail: detail?.text ?? null,
      legs: [leg(t)], balanceAfter: after[i],
    });
  });
  return lines;
}
