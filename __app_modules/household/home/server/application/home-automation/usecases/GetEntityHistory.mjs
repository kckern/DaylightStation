/**
 * GetEntityHistory — one entity's recent past, for the history drawer: a
 * bucketed line for a numeric reading, on-intervals for an on/off entity, or
 * ring marks (with the lane's camera) for a timeline events entity.
 *
 * Only what the dashboard can show is readable: a timeline lane entity, or an
 * entity the household's catalog policy admits.
 */

import { InvalidInputError, MissingResourceError } from '#apps/common/errors/SemanticErrors.mjs';
import {
  EntityCatalogPolicy, TimelinePolicy, bucketLine, toIntervals, risingEdges,
} from "../../../domain/home-automation/index.mjs";
import { toConfigurationError } from './configErrors.mjs';
import { loadRoomContext } from './roomContext.mjs';

const MINUTE_MS = 60e3;
const HOUR_MS = 3600e3;
/** Window length and line buckets: 5 min across 24 h, 30 min across 7 days. */
const RANGES = Object.freeze({
  '24h': { ms: 24 * HOUR_MS, buckets: 288 },
  '7d': { ms: 7 * 24 * HOUR_MS, buckets: 336 },
});
export const ENTITY_HISTORY_RANGES = Object.freeze(Object.keys(RANGES));

const isOnState = (v) => v === 'on';
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * A line when every known value is a number. With no known value at all (no
 * history in the window), a plain sensor is still drawn as an (empty) line.
 */
function isLine(entityId, series) {
  const known = series.filter((p) => p.v !== null && p.v !== undefined);
  if (!known.length) return entityId.startsWith('sensor.');
  return known.every((p) => isNumber(p.v));
}

export class GetEntityHistory {
  #configRepository;
  #entityGateway;
  #historyGateway;
  #clock;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.configRepository - IHomeDashboardConfigRepository
   * @param {Object} deps.entityGateway - IHomeEntityGateway
   * @param {Object} deps.historyGateway - IHomeHistoryGateway
   * @param {() => number} [deps.clock]
   * @param {Object} [deps.logger]
   */
  constructor({ configRepository, entityGateway, historyGateway, clock = Date.now, logger }) {
    if (!configRepository) throw new Error('GetEntityHistory: configRepository required');
    if (!entityGateway)    throw new Error('GetEntityHistory: entityGateway required');
    if (!historyGateway)   throw new Error('GetEntityHistory: historyGateway required');
    this.#configRepository = configRepository;
    this.#entityGateway = entityGateway;
    this.#historyGateway = historyGateway;
    this.#clock = clock;
    this.#logger = logger || console;
  }

  /**
   * @param {Object} input
   * @param {string} input.entityId
   * @param {'24h'|'7d'} input.range
   */
  async execute({ entityId, range } = {}) {
    const spec = RANGES[range];
    if (!spec) {
      throw new InvalidInputError(`history range must be one of ${ENTITY_HISTORY_RANGES.join(', ')}`, {
        code: 'INVALID_HISTORY_RANGE', details: { field: 'range', value: range },
      });
    }
    if (typeof entityId !== 'string' || !entityId) {
      throw new InvalidInputError('entityId is required', { code: 'INVALID_ENTITY_ID', details: { field: 'entityId', value: entityId } });
    }

    const { catalog, timeline } = await this.#loadPolicies();
    const lane = timeline.laneForEntity(entityId);
    if (!lane) await this.#assertShown(entityId, catalog);

    const nowMs = this.#clock();
    const startMs = Math.floor((nowMs - spec.ms) / MINUTE_MS) * MINUTE_MS;
    const history = await this.#historyGateway.readHistory([entityId], { startMs, endMs: null });
    const series = history.get(entityId) ?? [];
    const win = { startMs, endMs: nowMs };

    const base = { entityId, range, sinceIso: new Date(startMs).toISOString(), endIso: new Date(nowMs).toISOString() };
    let out;
    if (lane?.kind === 'events' && lane.entity === entityId) {
      out = { ...base, kind: 'events', camera: lane.camera, marks: risingEdges(series, { ...win, isOn: isOnState }) };
    } else if (isLine(entityId, series)) {
      out = { ...base, kind: 'line', camera: null, points: bucketLine(series, { ...win, buckets: spec.buckets }) };
    } else {
      out = { ...base, kind: 'state', camera: null, intervals: toIntervals(series, { ...win, isOn: isOnState }) };
    }

    this.#logger.debug?.('home.history.read', {
      entityId, range, kind: out.kind, points: series.length,
    });
    return out;
  }

  async #assertShown(entityId, catalog) {
    const readings = await this.#entityGateway.listReadings();
    const reading = readings.find((r) => r.entityId === entityId);
    let admitted = false;
    if (reading) {
      const rooms = await loadRoomContext(this.#entityGateway, catalog, this.#logger);
      admitted = catalog.admits(entityId, { deviceClass: reading.deviceClass, hasRoom: rooms.hasRoom(entityId) });
    }
    if (!admitted) throw new MissingResourceError(`home entity not found: ${entityId}`, { code: 'HOME_ENTITY_NOT_FOUND' });
  }

  async #loadPolicies() {
    const config = await this.#configRepository.load();
    let catalog;
    try {
      catalog = EntityCatalogPolicy.fromConfig(config.entities);
    } catch (error) {
      toConfigurationError(error, 'entities');
    }
    try {
      return { catalog, timeline: TimelinePolicy.fromConfig(config.timeline, { power: config.power }) };
    } catch (error) {
      toConfigurationError(error, 'timeline');
    }
  }
}

export default GetEntityHistory;
