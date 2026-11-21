// Skyline Glider's remote mapping: rider direction → Glider action, from the
// bike's `skyline_glider.remote` block in the fitness config. Vendor-free: the
// directions come from an IRemoteDirectionSource (lib/remoteInput/).

export const REMOTE_ACTIONS = Object.freeze(['laser', 'bomb', 'missile', 'boost', 'pause']);
export const REMOTE_DIRECTIONS = Object.freeze(['up', 'down', 'left', 'right', 'center', 'front', 'rear']);

const norm = (value) => String(value ?? '').trim().toLowerCase();

/**
 * The `skyline_glider.remote` block, kept to known directions and actions.
 * @returns {{ mapping: Record<string,string>, dropped: Array<{direction,action}> }}
 */
export function normalizeRemoteMapping(raw) {
  const mapping = {};
  const dropped = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { mapping, dropped };
  for (const [direction, action] of Object.entries(raw)) {
    const d = norm(direction), a = norm(action);
    if (REMOTE_DIRECTIONS.includes(d) && REMOTE_ACTIONS.includes(a)) mapping[d] = a;
    else dropped.push({ direction, action });
  }
  return { mapping, dropped };
}

/** The action for a rider direction, or null when the direction is unmapped. */
export function remoteAction(mapping, direction) {
  return mapping?.[direction] || null;
}
