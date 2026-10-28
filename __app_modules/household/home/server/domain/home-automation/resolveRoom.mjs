/**
 * resolveRoom — which room a home entity belongs to, and how we know.
 *
 * Sources, in order of authority:
 *   'config'   — the household's dashboard config names the room outright
 *   'provider' — the home platform assigned the entity (or its device) a room
 *   'inferred' — the entity id starts with a room's id or name
 *                ("switch.office_tv_plug" → Office). Most entities in a real
 *                house are never assigned a room, but nearly all are named for one.
 *
 * Pure: every input arrives as a parameter.
 *
 * @module home-automation/resolveRoom
 */

const slug = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/**
 * Prefix → room id lookup, longest prefix first so "master_bedroom" beats "bedroom".
 * @param {Array<{id: string, name: string}>} rooms
 * @param {Object.<string, string>} aliases - extra prefix → room id
 * @returns {Array<[string, string]>}
 */
export function buildRoomPrefixes(rooms, aliases = {}) {
  const byPrefix = new Map();
  for (const room of rooms) {
    for (const key of [slug(room.id), slug(room.name)]) {
      if (key && !byPrefix.has(key)) byPrefix.set(key, room.id);
    }
  }
  for (const [prefix, roomId] of Object.entries(aliases)) {
    const key = slug(prefix);
    if (key) byPrefix.set(key, roomId);
  }
  return [...byPrefix.entries()].sort((a, b) => b[0].length - a[0].length);
}

/**
 * @param {string} entityId
 * @param {Object} ctx
 * @param {Map<string, string>} ctx.roomNames - room id → display name
 * @param {Object.<string, string>} ctx.assignments - provider entity id → room id
 * @param {Object.<string, string>} [ctx.overrides] - household entity id → room id
 * @param {Array<[string, string]>|null} [ctx.prefixes] - from buildRoomPrefixes; null disables inference
 * @returns {{id: string, name: string, source: 'config'|'provider'|'inferred'}|null}
 */
export function resolveRoom(entityId, { roomNames, assignments, overrides = {}, prefixes = null }) {
  const named = (id, source) => ({ id, name: roomNames.get(id) || titleCase(id), source });
  if (overrides[entityId]) return named(overrides[entityId], 'config');
  if (assignments[entityId]) return named(assignments[entityId], 'provider');
  if (!prefixes) return null;
  const objectId = entityId.slice(entityId.indexOf('.') + 1);
  for (const [prefix, roomId] of prefixes) {
    if (objectId === prefix || objectId.startsWith(`${prefix}_`)) return named(roomId, 'inferred');
  }
  return null;
}

function titleCase(id) {
  return String(id).split('_').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default resolveRoom;
