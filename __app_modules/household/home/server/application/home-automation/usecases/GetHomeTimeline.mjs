/**
 * GetHomeTimeline — the Today timeline: one lane per entry in the household's
 * `timeline.lanes` policy (power line, doorbell rings, room occupancy, screen
 * time), each drawn for every local day in the range, with a total.
 *
 * One history read covers every lane entity over the whole range; the domain
 * shapes each lane's day. A lane whose entity has no history says so
 * (`hasData: false`, null totals) rather than reading as zero.
 */

import { InvalidInputError } from '#apps/common/errors/SemanticErrors.mjs';
import { TimelinePolicy, buildLaneDay, dayWindows } from "../../../domain/home-automation/index.mjs";
import { toConfigurationError } from './configErrors.mjs';

/** Line buckets per day: 5 min for a single day, 15 min across a week. */
const BUCKETS_PER_DAY = Object.freeze({ today: 288, yesterday: 288, week: 96 });
export const TIMELINE_RANGES = Object.freeze(Object.keys(BUCKETS_PER_DAY));

/** Sum each total field over the days that have data; null when none do. */
function sumTotals(days) {
  const withData = days.filter((d) => d.hasData);
  const fields = Object.keys(days[0]?.total ?? {});
  const total = {};
  for (const field of fields) {
    const values = withData.map((d) => d.total[field]).filter((v) => typeof v === 'number');
    total[field] = values.length ? values.reduce((a, b) => a + b, 0) : null;
  }
  return total;
}

const NOOP_LOGGER = Object.freeze({ debug() {}, info() {}, warn() {}, error() {} });

export class GetHomeTimeline {
  #configRepository;
  #historyGateway;
  #timeZone;
  #clock;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.configRepository - IHomeDashboardConfigRepository
   * @param {Object} deps.historyGateway - IHomeHistoryGateway
   * @param {string} deps.timeZone - the household's IANA zone; days are local days
   * @param {() => number} [deps.clock]
   * @param {Object} [deps.logger]
   */
  constructor({ configRepository, historyGateway, timeZone, clock = Date.now, logger }) {
    if (!configRepository) throw new Error('GetHomeTimeline: configRepository required');
    if (!historyGateway)   throw new Error('GetHomeTimeline: historyGateway required');
    if (!timeZone)         throw new Error('GetHomeTimeline: timeZone required');
    this.#configRepository = configRepository;
    this.#historyGateway = historyGateway;
    this.#timeZone = timeZone;
    this.#clock = clock;
    this.#logger = logger || NOOP_LOGGER;
  }

  /**
   * @param {Object} input
   * @param {'today'|'yesterday'|'week'} input.range
   */
  async execute({ range } = {}) {
    if (!TIMELINE_RANGES.includes(range)) {
      throw new InvalidInputError(`timeline range must be one of ${TIMELINE_RANGES.join(', ')}`, {
        code: 'INVALID_TIMELINE_RANGE', details: { field: 'range', value: range },
      });
    }
    const started = this.#clock();
    const policy = await this.#loadPolicy();
    const nowMs = this.#clock();
    const windows = dayWindows(range, { nowMs, timeZone: this.#timeZone });
    const entityIds = policy.entityIds;

    // Today and week run to "now"; yesterday is closed at midnight.
    const history = entityIds.length
      ? await this.#historyGateway.readHistory(entityIds, {
        startMs: windows[0].startMs,
        endMs: range === 'yesterday' ? windows[windows.length - 1].endMs : null,
      })
      : new Map();

    const buckets = BUCKETS_PER_DAY[range];
    const lanes = policy.lanes.map((lane) => {
      const days = windows.map((w) => buildLaneDay(lane, history, w, { buckets }));
      return {
        id: lane.id,
        kind: lane.kind,
        label: lane.label,
        camera: lane.camera,
        entityIds: { primary: lane.entity ?? lane.power, energy: lane.energy },
        days,
        total: sumTotals(days),
      };
    });

    this.#logger.debug?.('home.timeline.built', {
      range, lanes: lanes.length, entities: entityIds.length, ms: this.#clock() - started,
    });

    return {
      range,
      timeZone: this.#timeZone,
      generatedAt: new Date(nowMs).toISOString(),
      days: windows.map((w) => ({ day: w.day, startIso: new Date(w.startMs).toISOString(), endIso: new Date(w.endMs).toISOString() })),
      lanes,
    };
  }

  async #loadPolicy() {
    const config = await this.#configRepository.load();
    try {
      return TimelinePolicy.fromConfig(config.timeline, { power: config.power });
    } catch (error) {
      toConfigurationError(error, 'timeline');
    }
  }
}

export default GetHomeTimeline;
