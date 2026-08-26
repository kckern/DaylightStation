/**
 * Read a thermal printer's claim tier the same way at every consumer.
 * @module core/utils/printOutcome
 *
 * `ThermalPrinterAdapter.print()` resolves a claim tier, not a boolean:
 * `{ dispatched, verified, verification: 'verified'|'faulted'|'unreadable', faults }`.
 * The reading below is the one established (and tested) in
 * `backend/src/3_applications/school/ReceiptPrinting.mjs` after a
 * 2026-08-25 incident where `verified: false` was read as failure and
 * covered two incompatible cases: "the printer reported a fault" and "the
 * printer reported nothing at all". This is a pure read of that shape —
 * it belongs in the domain layer, not any one consumer, precisely so a
 * third or fourth call site doesn't reinvent (and drift from) it:
 *
 *   verified   -> printed. The printer confirmed it.
 *   faulted    -> NOT printed. The printer told us it failed.
 *   unreadable -> PRINTED, unconfirmed. The pre-flight already refuses when
 *                 the printer reports it cannot print, so once bytes are
 *                 dispatched past a passing pre-flight, absence of
 *                 confirmation is not evidence of failure — it is the
 *                 ordinary case on hardware where port 9100 gives no
 *                 per-job acknowledgment.
 *   not dispatched -> NOT printed. Nothing went out.
 *
 * A bare `true` (the virtual adapter, older printer surfaces, test doubles)
 * is accepted as printed and confirmed — it asserts nothing about faults, so
 * inventing one out of silence would repeat the original bug.
 *
 * @param {boolean|{dispatched?: boolean, verified?: boolean, verification?: string, faults?: Array|null}} outcome
 * @returns {{ printed: boolean, confirmed: boolean, faulted: boolean }}
 *   `printed` is the yes/no callers should act on. `confirmed` is true only
 *   for `verified` (use it to distinguish "confirmed" from "probably, per
 *   dispatch" without re-deriving the tier). `faulted` is true only when the
 *   printer actively reported a fault.
 */
export function readPrintOutcome(outcome) {
  if (outcome === true) return { printed: true, confirmed: true, faulted: false };
  const dispatched = outcome?.dispatched === true;
  const verified = outcome?.verified === true;
  const faulted = outcome?.verification === 'faulted';
  return { printed: verified || (dispatched && !faulted), confirmed: verified, faulted };
}

export default readPrintOutcome;
