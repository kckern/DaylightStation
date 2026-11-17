import moment from 'moment-timezone';
import { ILifelogExtractor, ExtractorCategory } from '../../application/ports/ILifelogExtractor.mjs';
export class WorkExtractor extends ILifelogExtractor {
  #timezone;
  constructor({
    timezone = 'UTC'
  } = {}) {
    super();
    if (!moment.tz.zone(timezone)) throw new TypeError('Work extractor timezone required');
    this.#timezone = timezone;
  }
  get source() {
    return 'work';
  }
  get category() {
    return ExtractorCategory.PRODUCTIVITY;
  }
  get filename() {
    return 'work';
  }
  extractForDate(data, date) {
    const source = Array.isArray(data) ? data : Object.values(data ?? {}).filter(Array.isArray).flat();
    const events = source.filter(event => Number.isFinite(event.occurredAt) && moment.tz(event.occurredAt, this.#timezone).format('YYYY-MM-DD') === date);
    return events.length ? {
      events,
      total: events.length
    } : null;
  }
  summarize(data) {
    if (!data?.events?.length) return null;
    return 'Provider work activity:\n' + data.events.map(event => `${event.ref.provider}: ${event.type} ${event.title ?? event.ref.id}${event.actorId ? ` (provider actor ${event.actorId})` : ' (actor unknown)'}`).join('\n');
  }
}
