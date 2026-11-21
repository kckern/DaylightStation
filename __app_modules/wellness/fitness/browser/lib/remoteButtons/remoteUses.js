// remoteUses — what uses a Bluetooth remote, read from config. Nothing here
// names a game or a device: a use is any config block keyed by a registered
// module's id that refers to the remote.
//
//  - On the remote's own inventory entry (input.yml): a block whose key is a
//    registered module id (e.g. a game's control map) → "<module name>: plays
//    with this remote."
//  - On an equipment entry in the fitness config: `<module id>.remote`, a map of
//    rider direction → that module's action, applied to every remote placed by
//    `positions:` → "<module name>: Up: <action>, …", with only the directions
//    this remote has (its positions, and front / rear from its `toward:`).
//
// [{ id, label, text }]

const DIRECTION_WORD = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', center: 'Centre', front: 'Front', rear: 'Rear' };
const ORDER = ['up', 'left', 'center', 'right', 'down', 'front', 'rear'];
const words = (id) => String(id).replace(/[_-]+/g, ' ').trim();
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {object} p
 * @param {object} p.controller   the remote's input.yml entry
 * @param {Array}  p.equipment    the fitness config's equipment entries
 * @param {(moduleId: string) => string|null} p.nameOf  a registered module's display name, or null
 */
export function remoteUses({ controller, equipment = [], nameOf = () => null }) {
  if (!isObject(controller)) return [];
  const uses = [];
  for (const [key, block] of Object.entries(controller)) {
    if (!isObject(block)) continue;
    const name = nameOf(key);
    if (name) uses.push({ id: `inventory:${key}`, label: `${name}:`, text: 'plays with this remote.' });
  }
  const positions = isObject(controller.positions) ? controller.positions : null;
  if (!positions) return uses;
  const toward = isObject(controller.toward) ? controller.toward : {};
  const has = (direction) => (direction === 'front' || direction === 'rear' ? !!positions[toward[direction]] : !!positions[direction]);
  const list = Array.isArray(equipment) ? equipment : [];
  const seen = new Map();
  for (const item of list) {
    if (!isObject(item)) continue;
    for (const [moduleId, block] of Object.entries(item)) {
      if (!isObject(block) || !isObject(block.remote)) continue;
      const name = nameOf(moduleId);
      if (!name) continue;
      const parts = ORDER
        .filter((d) => typeof block.remote[d] === 'string' && has(d))
        .map((d) => `${DIRECTION_WORD[d]}: ${words(block.remote[d])}`);
      if (!parts.length) continue;
      const text = `${parts.join(', ')}.`;
      const prior = seen.get(moduleId);
      if (prior?.text === text) continue;
      // The same module mapped differently on two pieces of equipment: say which.
      const label = prior || list.filter((e) => isObject(e?.[moduleId]?.remote)).length > 1
        ? `${name} on ${item.name || item.id}:` : `${name}:`;
      const use = { id: `equipment:${item.id || item.name}:${moduleId}`, label, text };
      seen.set(moduleId, use);
      uses.push(use);
    }
  }
  return uses;
}
