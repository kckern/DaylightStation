/**
 * HomeAssistantHistoryGateway — IHomeHistoryGateway over the home-automation
 * gateway. It owns no HTTP client, only an injected IHomeAutomationGateway.
 *
 * Translates the platform's history (ISO timestamps, 'unavailable'/'unknown'
 * states) into epoch-millisecond points with null for "no value". An open
 * window ("until now") still names an end: the platform's history endpoint
 * ends a request with no end_time ONE DAY after its start, so a week asked
 * for "until now" came back as its first day only. The end is the next whole
 * minute, so open requests inside one minute share the platform gateway's
 * cache key (its TTL is a minute).
 *
 * @module adapters/HomeAssistantHistoryGateway
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { IHomeHistoryGateway } from "../application/home-automation/ports/IHomeHistoryGateway.mjs";

const NON_VALUES = new Set(['unavailable', 'unknown', '']);
const MINUTE_MS = 60e3;

export class HomeAssistantHistoryGateway extends IHomeHistoryGateway {
  #gateway;
  #logger;
  #clock;

  /**
   * @param {Object} [config]
   * @param {Object} deps
   * @param {Object} deps.gateway - IHomeAutomationGateway
   * @param {Object} [deps.logger]
   * @param {() => number} [deps.clock]
   */
  // eslint-disable-next-line no-unused-vars
  constructor(config = {}, deps = {}) {
    super();
    if (!deps.gateway) {
      throw new InfrastructureError('HomeAssistantHistoryGateway requires gateway', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'gateway',
      });
    }
    this.#gateway = deps.gateway;
    this.#logger = deps.logger || console;
    this.#clock = deps.clock || Date.now;
  }

  async readHistory(entityIds, { startMs, endMs = null } = {}) {
    const end = endMs ?? Math.ceil((this.#clock() + 1) / MINUTE_MS) * MINUTE_MS;
    const opts = { sinceIso: new Date(startMs).toISOString(), endIso: new Date(end).toISOString() };
    const raw = await this.#gateway.getHistory(entityIds, opts);
    const out = new Map();
    for (const [id, points] of raw || []) {
      const clean = [];
      for (const p of points || []) {
        const t = Date.parse(p?.t);
        if (!Number.isFinite(t)) continue;
        clean.push({ t, v: NON_VALUES.has(p.v) || p.v === undefined ? null : p.v });
      }
      out.set(id, clean);
    }
    if (out.size === 0 && entityIds?.length > 0) {
      this.#logger.warn?.('home.history.empty', { entities: entityIds.length });
    }
    return out;
  }
}

export default HomeAssistantHistoryGateway;
