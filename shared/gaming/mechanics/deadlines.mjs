export function deadlineFrom(logicalTime, durationMs) {
  if (!Number.isFinite(logicalTime) || logicalTime < 0) throw new Error('logicalTime must be non-negative');
  if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error('durationMs must be non-negative');
  return logicalTime + durationMs;
}

export function deadlineState(deadline, logicalTime) {
  const remaining_ms = Math.max(0, deadline - logicalTime);
  return { deadline, remaining_ms, expired: remaining_ms === 0 };
}
