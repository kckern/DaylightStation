/**
 * Home Dashboard Entities Handler
 * @module api/handlers/home-dashboard/entities
 *
 * GET /api/v1/home-dashboard/entities
 * Every home entity the household's dashboard policy admits — typed, placed in
 * a room and classed by state — plus the rooms, types and state classes to
 * group them by, and the house summary (what is on, open, moving, low or
 * silent, and where the power goes) the Now and Power views are built from.
 */

/**
 * The response shape of one entity. Serialization is this layer's job; the
 * domain HomeEntity exposes getters only.
 * @param {Object} entity - a domain HomeEntity
 */
export function presentHomeEntity(entity) {
  return {
    id: entity.id,
    domain: entity.domain,
    name: entity.name,
    state: entity.state,
    stateClass: entity.stateClass,
    type: entity.type,
    room: entity.room ? { id: entity.room.id, name: entity.room.name, source: entity.room.source } : null,
    unit: entity.unit,
    deviceClass: entity.deviceClass,
    lastChanged: entity.lastChanged,
    controllable: entity.controllable,
    detail: { ...entity.detail },
  };
}

/**
 * @param {Object} deps
 * @param {Object} deps.operation - GetHomeEntities use case
 * @returns {Function} Express handler
 */
export function homeDashboardEntitiesHandler({ operation }) {
  if (!operation) throw new Error('homeDashboardEntitiesHandler: operation required');
  return async (_req, res) => {
    const { entities, rooms, types, stateClasses, haUrl, summary, mosaic } = await operation.execute();
    // Readings change by the second; never let a proxy serve yesterday's lights.
    res.set('Cache-Control', 'no-store');
    // `summary` is already plain data (entity ids and numbers) from the use case.
    res.json({ entities: entities.map(presentHomeEntity), rooms, types, stateClasses, haUrl, summary, mosaic });
  };
}

export default homeDashboardEntitiesHandler;
