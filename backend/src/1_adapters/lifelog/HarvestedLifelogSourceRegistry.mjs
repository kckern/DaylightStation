import { extractors } from './extractors/index.mjs';
import { ILifelogSourceRegistry } from '#apps/lifelog/ports/ILifelogSourceRegistry.mjs';

function project(extractor, data, date) {
  const observation = extractor.extractForDate(data, date);
  if (!observation) return null;
  return { source: extractor.source, category: extractor.category, data: observation,
    summary: extractor.summarize(observation) || null };
}

/** Owns harvested-source storage keys and vendor-specific record projection. */
export class HarvestedLifelogSourceRegistry extends ILifelogSourceRegistry {
  #load; #logger;
  constructor({ dataService, userLoadFile, logger = console } = {}) {
    super();
    if (!dataService?.user?.read && typeof userLoadFile !== 'function') {
      throw new TypeError('HarvestedLifelogSourceRegistry requires dataService');
    }
    this.#load = dataService?.user?.read
      ? (username, filename) => dataService.user.read(`lifelog/${filename}`, username)
      : userLoadFile;
    this.#logger = logger;
  }
  availableSources() { return extractors.map((extractor) => extractor.source); }
  async readDay(username, date) {
    const entries = [];
    for (const extractor of extractors) {
      try {
        const raw = this.#load(username, extractor.filename);
        if (!raw) continue;
        const entry = project(extractor, raw, date);
        if (entry) entries.push(entry);
      } catch (error) {
        this.#logger.warn?.('lifelog.source.read-failed', { username, source: extractor.source, error: error.message });
      }
    }
    return entries;
  }
  async readRange(username, dates) {
    const loaded = [];
    for (const extractor of extractors) {
      try {
        const raw = this.#load(username, extractor.filename);
        if (raw) loaded.push({ extractor, raw });
      } catch (error) {
        this.#logger.warn?.('lifelog.source.read-failed', { username, source: extractor.source, error: error.message });
      }
    }
    const days = {};
    for (const date of dates) {
      days[date] = [];
      for (const { extractor, raw } of loaded) {
        try {
          const entry = project(extractor, raw, date);
          if (entry) days[date].push(entry);
        } catch (error) {
          this.#logger.warn?.('lifelog.source.project-failed', { username, source: extractor.source, date, error: error.message });
        }
      }
    }
    return { days, availableSources: loaded.map(({ extractor }) => extractor.source) };
  }
}

export default HarvestedLifelogSourceRegistry;
