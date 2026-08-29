/** Bounded operational timeline for reading sessions; survives an app restart. */
import { readYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { IReadingObservationStore } from '#apps/school/ports/IReadingObservationStore.mjs';

const LIMIT = 500;

export class YamlReadingSessionTimelineStore extends IReadingObservationStore {
  #config; #logger; #chain = Promise.resolve();
  constructor({ configService, logger = console } = {}) {
    super();
    if (!configService?.getHouseholdPath) throw new Error('YamlReadingSessionTimelineStore requires configService');
    this.#config = configService; this.#logger = logger;
  }
  #file() { return this.#config.getHouseholdPath('school/runtime/reading-sessions/events.yml'); }
  async #read() {
    try { const raw = readYamlFromPath(this.#file()); return Array.isArray(raw?.events) ? raw.events : []; }
    catch (err) { if (err?.code !== 'ENOENT') this.#logger.warn?.('school.reading.timeline-read-failed', { error: err.message }); return []; }
  }
  append(event) {
    const write = this.#chain.then(async () => {
      const events = [...await this.#read(), event].slice(-LIMIT);
      saveYamlToPathAtomic(this.#file(), { events }, { noRefs: true, lineWidth: -1 });
      return event;
    });
    this.#chain = write.catch(() => {});
    return write;
  }
  async list(location, { limit = 50 } = {}) {
    const max = Math.max(1, Math.min(Number(limit) || 50, LIMIT));
    return (await this.#read()).filter((event) => event?.location === location).slice(-max);
  }
}

export default YamlReadingSessionTimelineStore;
