/**
 * Early passes: a priced voucher that opens one unit of a privilege (one
 * piano game) before the day's schoolwork is done. Pure helpers over the
 * ledger; EconomyService does the locking and the writes.
 *
 * A pass lives in the append-only ledger as these entries, all sharing the
 * pass id (`passRef`):
 *
 *   kind   ref                         what
 *   pass   pass:{l}:{day}              purchase marker, meta.state `active`
 *   spend  pass:{l}:{day}              the price, in the coin paid
 *   pass   pass:{l}:{day}:consumed     the game ended (a NEW entry, never an edit)
 *   earn   pass:{l}:{day}:refund       the price handed back
 *   pass   pass:{l}:{day}:refunded     the refund's marker
 *
 * Every marker has delta 0 and `evidenceRef` = the pass id. The pass id is the
 * purchase marker's ref; the first pass of a study day is `pass:{l}:{day}`, a
 * later one (only when the catalog's cap allows more than one) `…{day}.{n}`.
 */

/** Coins a pass can be bought in. Gems are a trophy, never spent on a pass. */
export const PASS_SELLABLE_COINS = Object.freeze(['silver', 'gold']);

/**
 * How long a pass stays active when its catalog entry (or an older purchase
 * marker) does not say: 30 minutes from the purchase. Past it the pass reads
 * `consumed` (`reason: 'expired'`) with no refund, so a kiosk reload or a
 * consume that never landed cannot open a second game on it.
 */
export const DEFAULT_MAX_ACTIVE_MS = 30 * 60 * 1000;
/** The refund window a catalog pass gets when it does not set `refund_within_ms`. */
export const DEFAULT_REFUND_WITHIN_MS = 60 * 1000;

const DAY = '\\d{4}-\\d{2}-\\d{2}';
const PASS_ID = new RegExp(`^pass:(.+):(${DAY})(?:\\.(\\d+))?$`);

/** `pass:{learnerId}:{studyDay}`, with `.{seq}` for the second and later pass of a day. */
export function passRef({ learnerId, studyDay, seq = 1 }) {
  return `pass:${learnerId}:${studyDay}${seq > 1 ? `.${seq}` : ''}`;
}

/** `{learnerId, studyDay, seq}` for a pass id, or null for anything that is not one. */
export function parsePassRef(ref) {
  const m = typeof ref === 'string' ? ref.match(PASS_ID) : null;
  if (!m) return null;
  const seq = m[3] == null ? 1 : Number(m[3]);
  if (!Number.isInteger(seq) || seq < 1 || (m[3] != null && seq === 1)) return null;
  return { learnerId: m[1], studyDay: m[2], seq };
}

export const consumedRef = (id) => `${id}:consumed`;
export const refundedRef = (id) => `${id}:refunded`;
export const refundRef = (id) => `${id}:refund`;

const sum = (txns) => txns.reduce((s, t) => s + (t.delta || 0), 0);

/** A day with no pass (for `privilege`): the same keys a real pass state has. */
export function nonePass({ learnerId = null, studyDay = null, privilege = null, passId = null } = {}) {
  return { passId, learnerId, studyDay, state: 'none', pass: null, privilege, coin: null, price: null, paid: 0, refunded: 0, boughtAt: null, endedAt: null, playedMs: null, refundWithinMs: null, maxActiveMs: null };
}

const positive = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const toMs = (now) => (now == null ? null : now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now));

/**
 * One pass's state from the ledger. With `nowMs`, an active pass bought more
 * than `maxActiveMs` ago reads `consumed`, `reason: 'expired'`, ended at the
 * limit: nothing is written, and nothing is refunded. A real transition in the
 * ledger always wins over the limit. Without `nowMs` nothing expires.
 */
function stateOf(txns, id, nowMs = null) {
  const parsed = parsePassRef(id);
  const purchase = txns.find((t) => t.kind === 'pass' && t.ref === id);
  const base = { learnerId: parsed?.learnerId ?? null, studyDay: parsed?.studyDay ?? null };
  if (!purchase) return { ...nonePass(base), passId: id };
  const m = purchase.meta ?? {};
  const coin = m.coin ?? null;
  const paid = 0 - sum(txns.filter((t) => t.kind === 'spend' && t.ref === id && (t.currency ?? 'silver') === coin));
  const refundEntries = txns.filter((t) => t.kind === 'earn' && t.ref === refundRef(id));
  // The FIRST transition wins, as the writes enforce: a consumed marker, or
  // the refund's first write (its earn; its marker when nothing was paid).
  const first = txns.find((t) => (t.kind === 'pass' && (t.ref === consumedRef(id) || t.ref === refundedRef(id)))
    || (t.kind === 'earn' && t.ref === refundRef(id)));
  const boughtAt = m.boughtAt ?? purchase.at ?? null;
  const maxActiveMs = positive(m.maxActiveMs) ?? DEFAULT_MAX_ACTIVE_MS;
  const limitMs = Date.parse(boughtAt ?? '') + maxActiveMs;
  const expired = !first && Number.isFinite(nowMs) && Number.isFinite(limitMs) && nowMs > limitMs;
  const state = expired ? 'consumed' : !first ? 'active' : (first.ref === consumedRef(id) ? 'consumed' : 'refunded');
  const ended = state === 'active' || expired ? null : txns.find((t) => t.kind === 'pass' && t.ref === (state === 'consumed' ? consumedRef(id) : refundedRef(id)));
  const reason = expired ? 'expired' : ended?.meta?.reason ?? null;
  return {
    ...base, passId: id, state,
    pass: m.pass ?? null, privilege: m.privilege ?? null, coin, price: m.price ?? null,
    paid, refunded: sum(refundEntries), boughtAt,
    endedAt: expired ? new Date(limitMs).toISOString() : ended?.at ?? null, playedMs: ended?.meta?.playedMs ?? null,
    refundWithinMs: m.refundWithinMs ?? null, maxActiveMs,
    ...(reason ? { reason } : {}),
  };
}

const CAP_PERIODS = new Set(['study-day', 'day']);

/** `{count, across}` from a pass's `cap`, or null when it cannot be honoured as written. Absent: one a day, across all passes. */
export function readCap(cap) {
  if (cap == null) return { count: 1, across: 'all-passes' };
  if (!CAP_PERIODS.has(cap.per ?? 'study-day')) return null;
  const count = cap.count ?? 1;
  if (!Number.isInteger(count) || count < 0) return null;
  return { count, across: cap.across ?? 'all-passes' };
}

/**
 * Whether the day's passes (`passesOn`) use up the cap of catalog pass
 * `{key, def}`: `count` passes in any state; `across: all-passes` counts
 * every pass, any other value only this one. Null for a cap it cannot read.
 */
export function capUsed(passesToday, { key, def }) {
  const cap = readCap(def?.cap);
  if (!cap) return null;
  const counted = cap.across === 'all-passes' ? passesToday : passesToday.filter((p) => p.pass === key);
  return counted.length >= cap.count;
}

/**
 * One pass's state: `none | active | consumed | refunded`, with its privilege,
 * coin, price, what was paid (0 for a pass whose spend never landed), and the
 * `refundWithinMs` and `maxActiveMs` recorded at purchase. `now` (a Date, ms
 * or ISO) applies the active limit; see `stateOf`.
 */
export function passState(txns, { learnerId, studyDay, seq = 1, now = null }) {
  return stateOf(txns ?? [], passRef({ learnerId, studyDay, seq }), toMs(now));
}

/** Every pass the learner bought on a study day, first first; `now` applies the active limit. */
export function passesOn(txns, { learnerId, studyDay, now = null }) {
  const list = txns ?? [];
  const ids = [];
  for (const t of list) {
    if (t.kind !== 'pass') continue;
    const p = parsePassRef(t.ref);
    if (p && p.learnerId === learnerId && p.studyDay === studyDay && !ids.includes(t.ref)) ids.push(t.ref);
  }
  return ids.sort((a, b) => parsePassRef(a).seq - parsePassRef(b).seq).map((id) => stateOf(list, id, toMs(now)));
}

/** The catalog pass that opens `privilege`: `{key, def}`, or null when none does. */
export function findPass(catalog, privilege) {
  for (const [key, def] of Object.entries(catalog?.passes ?? {})) {
    if (Array.isArray(def?.privileges) && def.privileges.includes(privilege)) return { key, def };
  }
  return null;
}

/** The price of `def` in `coin`, or null when it is not sold in that coin (0, unset, gems, fractional). */
export function priceIn(def, coin) {
  if (!PASS_SELLABLE_COINS.includes(coin)) return null;
  const price = def?.price?.[coin];
  return Number.isInteger(price) && price > 0 ? price : null;
}

/**
 * What one pass for `privilege` costs: one row per coin it is SOLD in. A
 * coin priced 0 (the shipped placeholder) is left out, so a pass priced 0 in
 * both coins quotes `[]`: not for sale.
 * @returns {Array<{coin: string, price: number, affordable: boolean}>}
 */
export function quote(catalog, { privilege, balances = {} }) {
  const found = findPass(catalog, privilege);
  if (!found) return [];
  return PASS_SELLABLE_COINS
    .map((coin) => ({ coin, price: priceIn(found.def, coin) }))
    .filter((row) => row.price != null)
    .map(({ coin, price }) => ({ coin, price, affordable: (balances?.[coin] ?? 0) >= price }));
}
