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

function stateOf(txns, id) {
  const parsed = parsePassRef(id);
  const markers = txns.filter((t) => t.kind === 'pass' && [id, consumedRef(id), refundedRef(id)].includes(t.ref));
  const purchase = markers.find((t) => t.ref === id);
  const base = { passId: id, learnerId: parsed?.learnerId ?? null, studyDay: parsed?.studyDay ?? null };
  if (!purchase) return { ...base, state: 'none', pass: null, privilege: null, coin: null, price: null, paid: 0, refunded: 0, boughtAt: null };
  const m = purchase.meta ?? {};
  const coin = m.coin ?? null;
  const paid = 0 - sum(txns.filter((t) => t.kind === 'spend' && t.ref === id && (t.currency ?? 'silver') === coin));
  const refundEntries = txns.filter((t) => t.kind === 'earn' && t.ref === refundRef(id));
  // Latest marker wins; a refund earn is the refund's commit point, so it
  // reads as refunded even if its marker never landed.
  const latest = markers[markers.length - 1];
  const state = refundEntries.length ? 'refunded' : (latest.meta?.state ?? 'active');
  const ended = state === 'active' ? null : markers.find((t) => t.ref === (state === 'consumed' ? consumedRef(id) : refundedRef(id)));
  return {
    ...base, state,
    pass: m.pass ?? null, privilege: m.privilege ?? null, coin, price: m.price ?? null,
    paid, refunded: sum(refundEntries), boughtAt: m.boughtAt ?? purchase.at ?? null,
    ...(ended ? { endedAt: ended.at, playedMs: ended.meta?.playedMs ?? null, ...(ended.meta?.reason ? { reason: ended.meta.reason } : {}) } : {}),
  };
}

/**
 * One pass's state: `none | active | consumed | refunded`, with its privilege,
 * coin, price and what was paid (0 for a pass whose spend never landed).
 */
export function passState(txns, { learnerId, studyDay, seq = 1 }) {
  return stateOf(txns ?? [], passRef({ learnerId, studyDay, seq }));
}

/** Every pass the learner bought on a study day, first first. */
export function passesOn(txns, { learnerId, studyDay }) {
  const list = txns ?? [];
  const ids = [];
  for (const t of list) {
    if (t.kind !== 'pass') continue;
    const p = parsePassRef(t.ref);
    if (p && p.learnerId === learnerId && p.studyDay === studyDay && !ids.includes(t.ref)) ids.push(t.ref);
  }
  return ids.sort((a, b) => parsePassRef(a).seq - parsePassRef(b).seq).map((id) => stateOf(list, id));
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
