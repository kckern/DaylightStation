export function formatGoodreadsRating(rating) {
  const value = Number(rating);
  if (!Number.isFinite(value) || value <= 0) return null;

  return {
    stars: Array.from({ length: 5 }, (_, index) => index < value ? '\u2605' : '\u2606').join(''),
    label: `${value} out of 5 stars`,
  };
}
