/**
 * YAML persistence for the open reading sessions.
 *
 *   <dataDir>/household/school/runtime/reading-sessions.yml
 *
 * The same `runtime/` tree as `YamlTokenRegistry`'s tokens and
 * `YamlAgendaCooldownStore`'s clocks — operational state the room needs this
 * minute, not a plan a parent edits or a durable record of a child's day.
 *
 * ONE FILE, NOT ONE PER ROOM. The set is the unit: `save` replaces it whole, so
 * a room that closed disappears by being absent rather than by leaving a
 * tombstone somebody has to remember to delete. A household has a handful of
 * rooms, so the file is small and rewriting it is cheaper than reconciling it.
 *
 * NEVER THROWS. `load` answers `[]` for absent, unreadable or corrupt; `save`
 * swallows its own failure and says so in the log. Losing session durability is
 * a bad evening; taking story time down because a disk filled is a worse one,
 * and this is transient state that the idle sweep already knows how to clean up
 * when it turns out to be wrong.
 */
import path from 'path';
import yaml from 'js-yaml';
import { IReadingSessionStore } from '#apps/school/ports/IReadingSessionStore.mjs';
import { readTextFromPath, writeFileAtomic } from '#system/utils/FileIO.mjs';

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });

export class YamlReadingSessionStore extends IReadingSessionStore {
  #configService;
  #logger;
  #writeChain = Promise.resolve();

  /**
   * @param {object} config
   * @param {object} config.configService - `getHouseholdPath()` provider (required)
   * @param {object} [config.logger]
   */
  constructor({ configService, logger = console } = {}) {
    super();
    if (!configService || typeof configService.getHouseholdPath !== 'function') {
      throw new Error('YamlReadingSessionStore: configService with getHouseholdPath() is required');
    }
    this.#configService = configService;
    this.#logger = logger;
  }

  #file() { return path.join(this.#configService.getHouseholdPath('school/runtime'), 'reading-sessions.yml'); }

  /** @inheritdoc */
  async load() {
    let text;
    try {
      text = readTextFromPath(this.#file());
    } catch (err) {
      // Absent is the ordinary case — a household that has never had a session
      // open across a restart, which is most of them most of the time.
      if (err?.code !== 'ENOENT') {
        this.#logger.warn?.('school.reading-sessions.read-failed', { error: err.message, file: this.#file() });
      }
      return [];
    }
    try {
      const raw = yaml.load(text);
      const rows = Array.isArray(raw?.sessions) ? raw.sessions : [];
      // A row with no room cannot be keyed and a row with no session id cannot
      // be proved against; both are dropped rather than rehydrated into
      // something the acknowledgement path would then refuse.
      return rows.filter((row) => row && typeof row === 'object'
        && typeof row.location === 'string' && row.location
        && typeof row.sessionId === 'string' && row.sessionId);
    } catch (err) {
      this.#logger.warn?.('school.reading-sessions.corrupt', { error: err.message, file: this.#file() });
      return [];
    }
  }

  /** @inheritdoc */
  async save(sessions) {
    const rows = Array.isArray(sessions) ? sessions : [];
    // Queued like the sibling runtime stores: the sweep and a card tap can both
    // land inside one tick, and two writes to one file must not interleave.
    const queued = this.#writeChain.then(async () => {
      try {
        writeFileAtomic(this.#file(), dumpYaml({ savedAt: new Date().toISOString(), sessions: rows }));
      } catch (err) {
        this.#logger.warn?.('school.reading-sessions.write-failed', {
          error: err.message, file: this.#file(), count: rows.length,
          consequence: 'sessions will not survive the next restart',
        });
      }
    });
    this.#writeChain = queued.catch(() => {});
    return queued;
  }
}

export default YamlReadingSessionStore;
