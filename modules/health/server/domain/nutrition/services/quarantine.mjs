/**
 * Capture quarantine. A barcode capture whose calories are unknown is kept as a
 * PENDING log (shown in Needs Review, outside the budget) rather than accepted
 * into the ledger, where an unknown-calorie row puts "+" on the day's totals.
 *
 * The marker lives on the NutriLog's metadata so every path that sweeps pending
 * logs into the ledger (auto-report, confirm-all, capture recovery) can leave
 * it alone, and so the pending-count guards do not wait on it forever. Only a
 * person confirming it with calories supplied takes it out.
 */
export const QUARANTINE_NO_CALORIES = 'no-calories';

export const quarantineMarker = (reason = QUARANTINE_NO_CALORIES) => ({ quarantined: true, quarantineReason: reason });

/** @param {{status?:string, metadata?:object}|null|undefined} log */
export const isQuarantined = log => log?.status === 'pending' && log?.metadata?.quarantined === true;

/** Pending logs that may be swept or that should hold a report back. */
export const withoutQuarantined = logs => (logs || []).filter(log => !isQuarantined(log));
