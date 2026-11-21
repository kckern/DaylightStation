// Where on a remote a key was pressed, from its inventory entry
// (input.yml `controllers:`, `kind: remote`):
//
//   key ──buttons:──▶ physical button ──positions:──▶ ring position
//       ──toward:──▶ front / rear (the ring position toward the equipment's front or rear)
//
// Nothing here knows a model, an address or a key name: two remotes mounted
// mirror-image resolve the same way because their entries say so. A remote
// without `toward` reports its ring positions as directions; one without
// `positions` reports nothing. Shared by every consumer of remote directions.

const norm = (value) => String(value ?? '').trim();
const sameKey = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
export const normalizeAddress = (address) => norm(address).toUpperCase();

/** The `kind: remote` entries that have `positions:` (the only ones a direction can come from). */
export function positionedRemotes(controllers) {
  return (Array.isArray(controllers) ? controllers : [])
    .filter((c) => c && c.kind === 'remote' && c.address && c.positions && typeof c.positions === 'object');
}

/** @returns {{ button: string, position: string, direction: string } | null} */
export function remoteDirection(controller, key) {
  if (!controller?.positions || !controller?.buttons) return null;
  const button = Object.keys(controller.buttons).find((b) => sameKey(controller.buttons[b], key));
  if (!button) return null;
  const position = Object.keys(controller.positions).find((p) => controller.positions[p] === button);
  if (!position) return null;
  const toward = controller.toward && typeof controller.toward === 'object' ? controller.toward : {};
  const direction = Object.keys(toward).find((side) => toward[side] === position) || position;
  return { button, position, direction };
}

/** A tagged press (address + key) resolved against the inventory, or null. */
export function resolveRemoteDirection({ controllers, address, key }) {
  const controller = positionedRemotes(controllers).find((c) => normalizeAddress(c.address) === normalizeAddress(address));
  if (!controller) return null;
  const where = remoteDirection(controller, key);
  return where ? { ...where, address: normalizeAddress(address), controllerId: controller.id || null } : null;
}

/** Keys the positioned remotes send (their untagged browser copies). */
export function remoteBrowserKeys(controllers) {
  const keys = new Set();
  for (const c of positionedRemotes(controllers)) {
    for (const key of Object.values(c.buttons || {})) if (norm(key)) keys.add(norm(key));
  }
  return keys;
}
