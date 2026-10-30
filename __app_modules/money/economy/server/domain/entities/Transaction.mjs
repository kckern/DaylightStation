/**
 * Household economy transaction — immutable ledger entry.
 * delta is a signed integer in one currency; sign must match kind.
 * An entry written before currencies existed has no `currency`: it is silver.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';

export const CURRENCIES = Object.freeze(['silver', 'gold', 'gems']);

// 0 = any non-zero sign. adjust: reconciliation. convert: one of a paired
// −from/+to entry. pass: a voucher marker that moves no coin (delta must be 0).
// prize: a contest win (the weekly ring contest), paid like an earn.
const KIND_SIGN = { deposit: 1, earn: 1, prize: 1, spend: -1, withdraw: -1, adjust: 0, convert: 0, pass: null };

export function createTransaction({ id, kind, delta, action, source, ref = null, note = null, at,
  currency = 'silver', ruleId = null, price = null, timeliness = null, evidenceRef = null, meta = null }) {
  if (!(kind in KIND_SIGN)) throw new ValidationError(`unknown transaction kind: ${kind}`);
  if (!CURRENCIES.includes(currency)) throw new ValidationError(`currency must be one of ${CURRENCIES.join(', ')}, got ${currency}`);
  const sign = KIND_SIGN[kind];
  if (sign === null) {
    if (delta !== 0) throw new ValidationError(`${kind} requires delta 0, got ${delta}`);
  } else {
    if (!Number.isInteger(delta) || delta === 0) throw new ValidationError(`delta must be a non-zero integer, got ${delta}`);
    if (sign !== 0 && Math.sign(delta) !== sign) throw new ValidationError(`${kind} requires delta sign ${sign}`);
  }
  if (!action) throw new ValidationError('action is required');
  if (!source) throw new ValidationError('source is required');
  if (typeof id !== 'string' || !id) throw new ValidationError('id is required');
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) throw new ValidationError('at must be an ISO timestamp');
  const optional = { ruleId, price, timeliness, evidenceRef, meta };
  return { id, at, kind, currency, delta, action, source, ref,
    ...(typeof note === 'string' && note.trim() ? { note: note.trim() } : {}),
    ...Object.fromEntries(Object.entries(optional).filter(([, v]) => v != null)) };
}

// The kinds a payout mints (EconomyService.mint): what counts toward a payout ref's "paid".
export const PAID_KINDS = Object.freeze(new Set(['earn', 'prize']));

/** An `adjust` ref that reverses part of a payout: `reverse:<payout ref>`. */
export const REVERSE_PREFIX = 'reverse:';

/**
 * The ref a transaction pays toward, or null: an earn/prize pays its own ref;
 * a grown-up's reversal (`adjust` under `reverse:<ref>`) un-pays that ref, so
 * a corrected line pays again from its true total — never twice.
 */
export function paidRefOf(txn) {
  if (!txn?.ref) return null;
  if (PAID_KINDS.has(txn.kind)) return txn.ref;
  if (txn.kind === 'adjust' && txn.ref.startsWith(REVERSE_PREFIX)) return txn.ref.slice(REVERSE_PREFIX.length);
  return null;
}

/**
 * Whether an entry is one PayoutService minted: a paid kind, `source: payout`
 * AND an `action` in the `payout:` namespace, which only `mint` stamps. A
 * `source` alone is not proof: older entry points let a caller name it.
 */
export function isPayoutEntry(t) {
  return PAID_KINDS.has(t?.kind) && t.source === 'payout' && typeof t.action === 'string' && t.action.startsWith('payout:');
}

/** `{silver, gold, gems}`, each folded on its own and floored at 0 (never reports overdraft). */
export function foldBalances(transactions) {
  const sums = Object.fromEntries(CURRENCIES.map((c) => [c, 0]));
  for (const t of transactions || []) {
    const currency = t.currency ?? 'silver';
    if (currency in sums) sums[currency] += t.delta || 0;
  }
  return Object.fromEntries(CURRENCIES.map((c) => [c, Math.max(0, sums[c])]));
}

/** The silver balance — what every pre-currency caller means by "balance". */
export function foldBalance(transactions) {
  return foldBalances(transactions).silver;
}
