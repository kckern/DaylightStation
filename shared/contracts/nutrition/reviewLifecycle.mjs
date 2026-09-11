/** Capture time, not calendar days or edit time, owns the review window. */
export const REVIEW_WINDOW_MS = 72 * 60 * 60 * 1000;

export function provisionalReview(item, now = Date.now(), source = 'capture') {
  if (item.review || item.settled === true) return {};
  const startedAt = new Date(now).toISOString();
  return {
    settled: false,
    review: { state: 'provisional', startedAt,
      stabilizesAt: new Date(Number(new Date(now)) + REVIEW_WINDOW_MS).toISOString(), source },
  };
}

/**
 * HELD: a capture whose numbers rest on a question nobody answered, which the
 * 72-hour clock must not answer on their behalf.
 *
 * Today there is exactly one such question — an untared scale reading heavy
 * enough to be sitting in a vessel (`captureEvidence.tareUnknown`, set by
 * `ScaleCapture` above the configured container threshold). A 398 g bowl of
 * level-5 food is 756 kcal if the bowl weighs nothing and about 375 if it is an
 * ordinary bowl, and the capture has no way to tell. Letting that auto-settle
 * writes the larger number into history as a measurement.
 *
 * Holding is NOT hiding. The entry lands in the ledger with its estimate and is
 * visible on the day exactly like any other; what it never does is go quiet on
 * its own. It stays provisional — the unconfirmed affordance in the UI — until
 * a person confirms it or a late `ct:` scan supplies the tare. Withholding the
 * ledger write instead would have dropped the food out of the day view
 * altogether, since `readNutritionDay` reads accepted entries and never sees a
 * pending capture.
 *
 * A user confirmation sets `settled: true` and ends the hold; nothing else does.
 */
export function heldForReview(item) {
  return item?.settled !== true && item?.captureEvidence?.tareUnknown === true;
}

export function reviewExpired(item, now = Date.now()) {
  if (heldForReview(item)) return false;
  return item.settled !== true && item.review?.state === 'provisional'
    && Number.isFinite(Date.parse(item.review.stabilizesAt))
    && Number(new Date(now)) >= Date.parse(item.review.stabilizesAt);
}

export function canAutoReview(item, now = Date.now()) {
  return item.settled !== true && item.review?.state === 'provisional'
    && Number.isFinite(Date.parse(item.review.stabilizesAt)) && !reviewExpired(item, now);
}

export function stabilizeReview(item, now = Date.now()) {
  if (!reviewExpired(item, now)) return {};
  return { settled: true, settledBy: 'auto', settledAt: item.review.stabilizesAt,
    review: { ...item.review, state: 'stable', stabilizedAt: item.review.stabilizesAt } };
}

export function confirmReview(item, now = Date.now()) {
  const at = new Date(now).toISOString();
  return { settled: true, settledBy: 'user', settledAt: at,
    ...(item.review ? { review: { ...item.review, state: 'confirmed', confirmedAt: at } } : {}) };
}
