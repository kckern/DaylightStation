/**
 * Deterministic comparator for avatars.
 * 1. Sort by Y position (ascending)
 * 2. Sort by Value (descending) - higher value usually means "ahead" or "better"
 * 3. Sort by ID (ascending) - deterministic tie-breaker
 */
export const compareAvatars = (a, b) => {
  // 1. Y position
  if (Math.abs(a.y - b.y) > 0.01) {
    return a.y - b.y;
  }

  // 2. Value (if available)
  const valA = a.value ?? 0;
  const valB = b.value ?? 0;
  if (valA !== valB) {
    return valB - valA; // Higher value first? 
    // Actually, usually lower Y means higher value in charts (0 at top), 
    // but here Y seems to be pixel position.
    // If Y is same, we want consistent ordering.
    // Let's stick to ID for pure determinism if Y is same.
  }

  // 3. ID (deterministic tie-breaker)
  const idA = a.id || '';
  const idB = b.id || '';
  return idA.localeCompare(idB);
};
