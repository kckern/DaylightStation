import moment from 'moment-timezone';
import { mergeWorkActivity } from './mergeWorkActivity.mjs';
import { extractors } from "./extractors/index.mjs";
import { ILifelogSourceRegistry } from "../application/ports/ILifelogSourceRegistry.mjs";
function project(extractor, data, date) {
  const observation = extractor.extractForDate(data, date);
  if (!observation) return null;
  return {
    source: extractor.source,
    category: extractor.category,
    data: observation,
    summary: extractor.summarize(observation) || null
  };
}

/** Owns harvested-source storage keys and vendor-specific record projection. */
export class HarvestedLifelogSourceRegistry extends ILifelogSourceRegistry {
  #load;
  #logger;
  #work;
  #timezone;
  constructor({
    dataService,
    userLoadFile,
    logger = console,
    workActivityReader = null,
    userTimezone = () => 'UTC'
  } = {}) {
    super();
    if (!dataService?.user?.read && typeof userLoadFile !== 'function') {
      throw new TypeError('HarvestedLifelogSourceRegistry requires dataService');
    }
    this.#load = dataService?.user?.read ? (username, filename) => dataService.user.read(`lifelog/${filename}`, username) : userLoadFile;
    this.#logger = logger;
    this.#work = workActivityReader;
    this.#timezone = userTimezone;
  }
  availableSources() {
    return [...extractors.map(extractor => extractor.source), ...(this.#work ? ['work'] : [])];
  }
  async readDay(username, date) {
    return (await this.readRange(username, [date])).days[date];
  }
  async readRange(username, dates) {
    const loaded = [];
    for (const extractor of extractors) {
      try {
        const raw = this.#load(username, extractor.filename);
        if (raw) loaded.push({
          extractor,
          raw
        });
      } catch (error) {
        this.#logger.warn?.('lifelog.source.read-failed', {
          username,
          source: extractor.source,
          error: error.message
        });
      }
    }
    let canonical = [];
    if (this.#work && dates.length) {
      try {
        const sorted = [...dates].sort(),
          timezone = this.#timezone(username);
        canonical = await this.#work.read({
          username,
          from: moment.tz(sorted[0], timezone).startOf('day').valueOf(),
          to: moment.tz(sorted.at(-1), timezone).endOf('day').valueOf()
        });
      } catch (error) {
        this.#logger.warn?.('lifelog.work.read-failed', {
          username,
          reason: error.code ?? 'unavailable'
        });
      }
    }
    const days = {};
    for (const date of dates) {
      days[date] = [];
      for (const {
        extractor,
        raw
      } of loaded) {
        try {
          const entry = project(extractor, raw, date);
          if (entry) days[date].push(entry);
        } catch (error) {
          this.#logger.warn?.('lifelog.source.project-failed', {
            username,
            source: extractor.source,
            date,
            error: error.message
          });
        }
      }
    }
    if (this.#work) for (const date of dates) days[date] = mergeWorkActivity({
      legacyEntries: days[date],
      canonicalEvents: canonical,
      date,
      timezone: this.#timezone(username)
    });
    return {
      days,
      availableSources: [...loaded.map(({
        extractor
      }) => extractor.source), ...(canonical.length ? ['work'] : [])]
    };
  }
}
export default HarvestedLifelogSourceRegistry;
