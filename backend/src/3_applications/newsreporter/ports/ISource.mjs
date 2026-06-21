/**
 * @interface ISource
 *
 * A source gathers raw items for a report. Implementations live in
 * 1_adapters (http, rss, harvester, agent, ...). The service resolves
 * placeholders in the source config before calling gather().
 */
export class ISource {
  /**
   * @param {object} ctx run context ({ referenceDate, timezone, config, ... })
   * @returns {Promise<{ items: Array, meta: object }>}
   */
  async gather(ctx) {
    throw new Error('ISource.gather must be implemented');
  }
}

export function isSource(obj) {
  return !!obj && typeof obj.gather === 'function';
}
