/**
 * TimelinePolicy — which lanes the Today timeline draws, as household policy
 * decides it (`timeline.lanes` in the dashboard YAML), and `buildLaneDay`,
 * which turns one lane's history into the day's marks, intervals or line.
 *
 * Lane kinds: `power` (a watts line plus kWh), `events` (rising edges of a
 * binary entity), `occupancy` (spans a binary entity was on) and `screen`
 * (spans a plug drew more than `on_watts`).
 *
 * @module home-automation/TimelinePolicy
 */

import { ValidationError } from '#domains/core/errors/index.mjs';
import {
  bucketLine, toIntervals, risingEdges, sumIntervalsMs,
  dailyCounterTotal, counterDelta, integrateKwh, hasKnownValue,
} from './historySeries.mjs';

export const LANE_KINDS = Object.freeze(['power', 'events', 'occupancy', 'screen']);

const SLUG = /^[a-z0-9_-]+$/;
const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;
const DEFAULT_ON_WATTS = 5;
const HOUR_MS = 3600e3;

function invalid(message, field, value) {
  return new ValidationError(`timeline ${message}`, { code: 'INVALID_TIMELINE_POLICY', field, value });
}

function entityId(value, field, { required }) {
  if (value == null) {
    if (required) throw invalid(`${field} is required`, field, value);
    return null;
  }
  if (typeof value !== 'string' || !ENTITY_ID.test(value)) throw invalid(`${field} must be an entity id`, field, value);
  return value;
}

function parseLane(raw, i, seen) {
  const at = (key) => `timeline.lanes[${i}].${key}`;
  if (!raw || typeof raw !== 'object') throw invalid(`lanes[${i}] must be an object`, `timeline.lanes[${i}]`, raw);
  if (typeof raw.id !== 'string' || !SLUG.test(raw.id)) throw invalid(`${at('id')} must be a slug`, at('id'), raw.id);
  if (seen.has(raw.id)) throw invalid(`${at('id')} duplicates an earlier lane`, at('id'), raw.id);
  seen.add(raw.id);
  if (!LANE_KINDS.includes(raw.kind)) throw invalid(`${at('kind')} must be one of ${LANE_KINDS.join(', ')}`, at('kind'), raw.kind);

  const needsPower = raw.kind === 'power' || raw.kind === 'screen';
  const entity = entityId(raw.entity, at('entity'), { required: raw.kind === 'events' || raw.kind === 'occupancy' });
  const power = entityId(raw.power, at('power'), { required: needsPower });
  const energy = entityId(raw.energy, at('energy'), { required: false });

  let onWatts = DEFAULT_ON_WATTS;
  if (raw.on_watts != null) {
    if (typeof raw.on_watts !== 'number' || !Number.isFinite(raw.on_watts) || raw.on_watts < 0 || raw.on_watts > 5000) {
      throw invalid(`${at('on_watts')} must be a number from 0 to 5000`, at('on_watts'), raw.on_watts);
    }
    onWatts = raw.on_watts;
  }

  let camera = null;
  if (raw.camera != null) {
    if (typeof raw.camera !== 'string' || !SLUG.test(raw.camera)) throw invalid(`${at('camera')} must be a slug`, at('camera'), raw.camera);
    if (raw.kind !== 'events') throw invalid(`${at('camera')} applies to events lanes only`, at('camera'), raw.camera);
    camera = raw.camera;
  }

  let label = raw.id;
  if (raw.label != null) {
    if (typeof raw.label !== 'string' || !raw.label) throw invalid(`${at('label')} must be a string`, at('label'), raw.label);
    label = raw.label;
  }

  return Object.freeze({
    id: raw.id,
    kind: raw.kind,
    label,
    entity: raw.kind === 'events' || raw.kind === 'occupancy' ? entity : null,
    power: needsPower ? power : null,
    energy,
    onWatts,
    camera,
  });
}

function laneEntityIds(lane) {
  return [lane.entity, lane.power, lane.energy].filter(Boolean);
}

export class TimelinePolicy {
  #lanes;
  #byEntity;
  #entityIds;

  constructor(lanes) {
    this.#lanes = Object.freeze([...lanes]);
    this.#byEntity = new Map();
    for (const lane of this.#lanes) {
      for (const id of laneEntityIds(lane)) if (!this.#byEntity.has(id)) this.#byEntity.set(id, lane);
    }
    this.#entityIds = Object.freeze([...this.#byEntity.keys()]);
    Object.freeze(this);
  }

  /**
   * @param {Object} [timeline] - the `timeline:` YAML section
   * @param {Object} [sections]
   * @param {Object} [sections.power] - the `power:` YAML section (fallback lane)
   */
  static fromConfig(timeline, { power } = {}) {
    const raw = timeline?.lanes;
    if (raw == null) {
      const whole = entityId(power?.whole_house, 'power.whole_house', { required: false });
      if (!whole) return new TimelinePolicy([]);
      const energy = entityId(power?.energy_today, 'power.energy_today', { required: false });
      return new TimelinePolicy([parseLane({ id: 'power', kind: 'power', label: 'Power', power: whole, energy }, 0, new Set())]);
    }
    if (!Array.isArray(raw)) throw invalid('timeline.lanes must be a list', 'timeline.lanes', raw);
    const seen = new Set();
    return new TimelinePolicy(raw.map((l, i) => parseLane(l, i, seen)));
  }

  get lanes() { return this.#lanes; }
  get entityIds() { return [...this.#entityIds]; }

  /** The lane that reads `entityId`, or null. */
  laneForEntity(entityId) { return this.#byEntity.get(entityId) ?? null; }
}

const isOnState = (v) => v === 'on';

/**
 * One lane's day, from `history` (entity id -> series).
 * `hasData` is false when the primary series held no known value inside this
 * day's window (before its first point, or unavailable all day); totals are
 * then null fields rather than zeros.
 */
export function buildLaneDay(lane, history, window, { buckets } = {}) {
  const { day, startMs, endMs } = window;
  const win = { startMs, endMs };
  const get = (id) => (id ? history.get(id) ?? [] : []);
  const has = (s) => hasKnownValue(s, win);

  if (lane.kind === 'power') {
    const power = get(lane.power);
    if (!has(power)) return { day, hasData: false, points: [], total: { kwh: null } };
    const energy = get(lane.energy);
    const metered = lane.energy && has(energy) ? dailyCounterTotal(energy, win) : null;
    return {
      day,
      hasData: true,
      points: bucketLine(power, { ...win, buckets }),
      total: { kwh: metered ?? integrateKwh(power, win) },
    };
  }

  if (lane.kind === 'events') {
    const s = get(lane.entity);
    if (!has(s)) return { day, hasData: false, marks: [], total: { count: null } };
    const marks = risingEdges(s, { ...win, isOn: isOnState });
    return { day, hasData: true, marks, total: { count: marks.length } };
  }

  if (lane.kind === 'occupancy') {
    const s = get(lane.entity);
    if (!has(s)) return { day, hasData: false, intervals: [], total: { hours: null } };
    const intervals = toIntervals(s, { ...win, isOn: isOnState });
    return { day, hasData: true, intervals, total: { hours: sumIntervalsMs(intervals) / HOUR_MS } };
  }

  // screen
  const power = get(lane.power);
  if (!has(power)) return { day, hasData: false, intervals: [], total: { hours: null, kwh: null } };
  const intervals = toIntervals(power, { ...win, isOn: (v) => typeof v === 'number' && v >= lane.onWatts });
  const energy = get(lane.energy);
  const metered = lane.energy && has(energy) ? counterDelta(energy, win) : null;
  return {
    day,
    hasData: true,
    intervals,
    total: { hours: sumIntervalsMs(intervals) / HOUR_MS, kwh: metered ?? integrateKwh(power, win) },
  };
}
