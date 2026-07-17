/**
 * Household economy transaction — immutable ledger entry.
 * delta is a signed integer; sign must match kind.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { shortId } from '#domains/core/utils/id.mjs';

const KIND_SIGN = { deposit: 1, earn: 1, spend: -1, withdraw: -1, adjust: 0 }; // adjust: any sign

export function createTransaction({ kind, delta, action, source, ref = null }) {
  if (!(kind in KIND_SIGN)) throw new ValidationError(`unknown transaction kind: ${kind}`);
  if (!Number.isInteger(delta) || delta === 0) throw new ValidationError(`delta must be a non-zero integer, got ${delta}`);
  const sign = KIND_SIGN[kind];
  if (sign !== 0 && Math.sign(delta) !== sign) throw new ValidationError(`${kind} requires delta sign ${sign}`);
  if (!action) throw new ValidationError('action is required');
  if (!source) throw new ValidationError('source is required');
  return { id: `txn_${shortId()}`, at: new Date().toISOString(), kind, delta, action, source, ref };
}

export function foldBalance(transactions) {
  return Math.max(0, (transactions || []).reduce((sum, t) => sum + (t.delta || 0), 0));
}
