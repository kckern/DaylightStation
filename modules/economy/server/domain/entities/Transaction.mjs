/**
 * Household economy transaction — immutable ledger entry.
 * delta is a signed integer; sign must match kind.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';

const KIND_SIGN = { deposit: 1, earn: 1, spend: -1, withdraw: -1, adjust: 0 }; // adjust: any sign

export function createTransaction({ id, kind, delta, action, source, ref = null, note = null, at }) {
  if (!(kind in KIND_SIGN)) throw new ValidationError(`unknown transaction kind: ${kind}`);
  if (!Number.isInteger(delta) || delta === 0) throw new ValidationError(`delta must be a non-zero integer, got ${delta}`);
  const sign = KIND_SIGN[kind];
  if (sign !== 0 && Math.sign(delta) !== sign) throw new ValidationError(`${kind} requires delta sign ${sign}`);
  if (!action) throw new ValidationError('action is required');
  if (!source) throw new ValidationError('source is required');
  if (typeof id !== 'string' || !id) throw new ValidationError('id is required');
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) throw new ValidationError('at must be an ISO timestamp');
  return { id, at, kind, delta, action, source, ref,
    ...(typeof note === 'string' && note.trim() ? { note: note.trim() } : {}) };
}

export function foldBalance(transactions) {
  return Math.max(0, (transactions || []).reduce((sum, t) => sum + (t.delta || 0), 0));
}
