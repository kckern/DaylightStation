/**
 * Group home entities for the Browse list. The server has already decided
 * each entity's type, room and state class; this only arranges them.
 */

export const BROWSE_MODES = Object.freeze([
  Object.freeze({ id: 'type', label: 'Type' }),
  Object.freeze({ id: 'room', label: 'Room' }),
  Object.freeze({ id: 'state', label: 'State' }),
]);

const NO_ROOM = Object.freeze({ id: '__none__', label: 'No room' });

/**
 * @param {Array} entities - entity JSON from /home-dashboard/entities
 * @param {'type'|'room'|'state'} mode
 * @param {{rooms?: Array, types?: Array, stateClasses?: Array}} meta
 * @returns {Array<{id: string, label: string, entities: Array, onCount: number}>}
 */
export function groupEntities(entities, mode, { rooms = [], types = [], stateClasses = [] } = {}) {
  const order = mode === 'room'
    ? [...rooms.map((r) => ({ id: r.id, label: r.name })), NO_ROOM]
    : (mode === 'state' ? stateClasses : types).map((g) => ({ id: g.id, label: g.label }));
  const keyOf = mode === 'room' ? (e) => e.room?.id || NO_ROOM.id
    : mode === 'state' ? (e) => e.stateClass
      : (e) => e.type;

  const buckets = new Map(order.map((g) => [g.id, []]));
  for (const entity of entities) {
    const key = keyOf(entity);
    if (!buckets.has(key)) {
      // The server lists only groups that hold something, so an unknown key is
      // drift between payload and metadata; show it rather than drop the entity.
      buckets.set(key, []);
      order.push({ id: key, label: key });
    }
    buckets.get(key).push(entity);
  }

  return order
    .map((g) => {
      const list = buckets.get(g.id) || [];
      return { id: g.id, label: g.label, entities: list, onCount: list.filter((e) => e.stateClass === 'on').length };
    })
    .filter((g) => g.entities.length > 0);
}

/**
 * @param {Array} entities
 * @param {{query?: string, hideUnavailable?: boolean}} filter
 */
export function filterEntities(entities, { query = '', hideUnavailable = false } = {}) {
  const needle = query.trim().toLowerCase();
  return entities.filter((e) => {
    if (hideUnavailable && e.stateClass === 'unavailable') return false;
    if (!needle) return true;
    return e.name.toLowerCase().includes(needle)
      || e.id.toLowerCase().includes(needle)
      || (e.room?.name || '').toLowerCase().includes(needle);
  });
}
