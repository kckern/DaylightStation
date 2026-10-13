export function adjustScore(scores, subjectId, delta, { minimum = -Infinity, maximum = Infinity } = {}) {
  if (!Number.isFinite(delta)) throw new Error('Score adjustment must be finite');
  const current = Number(scores?.[subjectId] || 0);
  return { ...(scores || {}), [subjectId]: Math.min(maximum, Math.max(minimum, current + delta)) };
}
