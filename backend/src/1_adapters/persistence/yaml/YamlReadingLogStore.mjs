/**
 * YAML persistence for the story-time reading log.
 *
 *   <dataDir>/household/school/records/reading/{learnerId}/{studyDay}.yml
 *
 * `records/`, not `runtime/`: a finished story is durable evidence a report
 * card is reconstructed from, not operational state a cooldown or a session
 * close may prune. That is the same split `YamlAgendaCooldownStore`'s header
 * describes from the other side.
 *
 * SHARDED BY STUDY DAY. The shard key is the household's own 4am->4am day,
 * computed by the caller before it gets here, so `listForDay` is one file read
 * with no timezone reconciliation — unlike `SurfaceProgramLauncher`, which
 * reads a UTC-sharded log it does not own and therefore has to read two shards
 * and filter. Owning the store is what buys the single read.
 *
 * NEVER THROWS ON READ. A missing OR corrupt file both answer `[]` — "no
 * evidence on record". That is the fail-open direction for a *reader*: the
 * worst a bad file can do is show a child as owing stories they already
 * finished, never take the agenda down. Writes are the opposite: an unsafe
 * learner id or a malformed study day THROWS, because silently filing a read
 * under the wrong key loses it for good.
 */
import path from 'path';
import { promises as fs } from 'fs';
import yaml from 'js-yaml';
import { IReadingLogStore } from '#apps/school/ports/IReadingLogStore.mjs';

const LEARNER_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const STUDY_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isSafeLearnerId = (id) => typeof id === 'string' && LEARNER_ID_RE.test(id);
const isStudyDay = (day) => typeof day === 'string' && STUDY_DAY_RE.test(day);
const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });
const orNull = (value) => (typeof value === 'string' && value ? value : null);

export class YamlReadingLogStore extends IReadingLogStore {
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
      throw new Error('YamlReadingLogStore: configService with getHouseholdPath() is required');
    }
    this.#configService = configService;
    this.#logger = logger;
  }

  #dirFor(learnerId) {
    return path.join(this.#configService.getHouseholdPath('school/records/reading'), learnerId);
  }

  #fileFor(learnerId, studyDay) {
    return path.join(this.#dirFor(learnerId), `${studyDay}.yml`);
  }

  /** @inheritdoc */
  async append(row) {
    const learnerId = row?.learnerId;
    const studyDay = row?.studyDay;
    if (!isSafeLearnerId(learnerId)) throw new Error(`YamlReadingLogStore: unsafe learnerId: ${learnerId}`);
    if (!isStudyDay(studyDay)) throw new Error(`YamlReadingLogStore: studyDay must be YYYY-MM-DD, got: ${studyDay}`);
    const stored = {
      at: orNull(row.at),
      contentId: orNull(row.contentId),
      title: orNull(row.title),
      tagUid: orNull(row.tagUid),
      location: orNull(row.location),
    };
    // Serialized like the sibling YAML stores: this is a read-modify-write, and
    // two books finishing seconds apart in the same room must not race one row
    // out of the file.
    const queued = this.#writeChain.then(async () => {
      const existing = await this.listForDay(learnerId, studyDay);
      await fs.mkdir(this.#dirFor(learnerId), { recursive: true });
      await fs.writeFile(
        this.#fileFor(learnerId, studyDay),
        dumpYaml({ learnerId, studyDay, reads: [...existing, stored] }),
        'utf8',
      );
      return stored;
    });
    this.#writeChain = queued.catch(() => {});
    return queued;
  }

  /** @inheritdoc */
  async listForDay(learnerId, studyDay) {
    if (!isSafeLearnerId(learnerId) || !isStudyDay(studyDay)) return [];
    let text;
    try {
      text = await fs.readFile(this.#fileFor(learnerId, studyDay), 'utf8');
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        this.#logger.warn?.('school.reading-log.read-failed', { learnerId, studyDay, error: err.message });
      }
      return [];
    }
    try {
      const raw = yaml.load(text);
      if (!raw || typeof raw !== 'object' || !Array.isArray(raw.reads)) return [];
      return raw.reads.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
    } catch (err) {
      this.#logger.warn?.('school.reading-log.corrupt', {
        learnerId, studyDay, error: err.message, file: this.#fileFor(learnerId, studyDay),
      });
      return [];
    }
  }
}

export default YamlReadingLogStore;
