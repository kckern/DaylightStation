export function clampWager(amount, { score, roundMax }) {
  const max = Math.max(score, roundMax);
  const n = Number.isFinite(amount) ? Math.floor(amount) : 5;
  return Math.min(Math.max(n, 5), max);
}
