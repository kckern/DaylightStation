/**
 * The ledger in plain words, for a kid reading their bank:
 *
 *   +2 silver · Isaiah 50–51 passed      a payout, named by its evidence line
 *   +5 silver · Scripture (whole week)   …or by its rule label, then "schoolwork"
 *   −3 silver · early pass               a pass bought
 *   +3 silver · early pass refunded      its refund
 *   12 silver → 12 gold · Sunday         a week close: both convert halves, one line
 *
 * Pure: the caller supplies the labels. `evidenceLabels` maps an entry's
 * `evidenceRef` (a preview line's ref) to what that line says; `ruleLabels`
 * maps a rule id to the ruleset's label, for lines older than the current
 * preview. Pass markers (kind `pass`, delta 0) move no coin and are left out.
 */

const MINUS = '−';
const PASS_ACTION = 'early-pass';

const lookup = (labels, key) => {
  if (key == null || labels == null) return null;
  const v = labels instanceof Map ? labels.get(key) : labels[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

const coinName = (currency, n) => (currency === 'gems' && Math.abs(n) === 1 ? 'gem' : currency);
const amount = (delta, currency) => `${delta < 0 ? MINUS : '+'}${Math.abs(delta)} ${coinName(currency, delta)}`;
const words = (action) => String(action ?? '').replace(/^payout:/, '').replace(/[-_]+/g, ' ').trim() || 'entry';
const withNote = (phrase, note) => (typeof note === 'string' && note.trim() ? `${phrase}: ${note.trim()}` : phrase);

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
      if (action.endsWith('-refund')) return `${words(action.slice(0, -'-refund'.length))} refunded`;
      return words(action);
    case 'spend':
      return action === PASS_ACTION ? 'early pass' : words(action);
    case 'deposit': return withNote('deposit', t.note);
    case 'adjust': return withNote('correction', t.note);
    case 'withdraw': return withNote('withdrawn', t.note);
    default: return words(action);
  }
}

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
 * `{ text, at, kind, ids }`. The two halves of a conversion, sharing an `at`
 * and an `evidenceRef`, become one line: "12 silver → 12 gold · Sunday",
 * placed where the first half appears. Zero-delta entries are skipped.
 * @param {object[]} entries
 * @param {{ruleLabels?: object|Map, evidenceLabels?: object|Map, timezone?: string|null}} [opts]
 */
export function historyLines(entries, opts = {}) {
  const list = (entries ?? []).filter((t) => t && Number.isFinite(t.delta) && t.delta !== 0);
  const used = new Set();
  const lines = [];
  list.forEach((t, i) => {
    if (used.has(i)) return;
    if (t.kind === 'convert') {
      const key = t.evidenceRef ?? null;
      const j = key == null ? -1 : list.findIndex((u, k) => k !== i && !used.has(k) && u.kind === 'convert'
        && u.at === t.at && u.evidenceRef === key && Math.sign(u.delta) !== Math.sign(t.delta));
      if (j >= 0) {
        used.add(j);
        const [out, back] = t.delta < 0 ? [t, list[j]] : [list[j], t];
        const day = weekday(t.at, opts.timezone);
        const text = `${-out.delta} ${coinName(out.currency ?? 'silver', out.delta)} → ${back.delta} ${coinName(back.currency ?? 'silver', back.delta)}${day ? ` · ${day}` : ''}`;
        lines.push({ text, at: t.at, kind: 'convert', ids: [t.id, list[j].id] });
        return;
      }
    }
    lines.push({ text: entrySentence(t, opts), at: t.at, kind: t.kind, ids: [t.id] });
  });
  return lines;
}
