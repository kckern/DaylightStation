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

export function reviewExpired(item, now = Date.now()) {
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
