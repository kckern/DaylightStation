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
 *
 * MISSING AND CORRUPT ARE NOT THE SAME THING ON THE WRITE PATH. `append` is a
 * read-modify-write, so the fail-open read posture this store inherited from
 * `YamlAgendaCooldownStore` was actively destructive here: that store's `put()`
 * is a full replace and never re-reads, so answering `[]` for a corrupt file
 * costs it nothing. Here it meant one bad byte read as "no reads today" and the
 * next append overwrote three finished books with one. So `#load` reports
 * `missing` / `ok` / `corrupt` / `unreadable` separately, and `append`:
 *
 *   - corrupt    -> copy the original bytes to `<studyDay>.yml.corrupt-<stamp>`
 *                   FIRST, log at error, then start a fresh shard. Side-filing
 *                   rather than throwing keeps the day usable — a stray byte
 *                   must not stop a four-year-old logging stories until
 *                   midnight — while leaving the evidence recoverable by hand.
 *   - unreadable -> THROW. We could not get the bytes, so we cannot preserve
 *                   them, so we refuse to replace the file.
 *
 * All I/O goes through `#system/utils/FileIO.mjs` (see `adapters-no-direct-fs`),
 * and the shard is written with `saveYamlToPathAtomic` — a torn write is one of
 * the ways a shard becomes corrupt in the first place.
 */
import path from 'path';
import yaml from 'js-yaml';
import { fileExists, readFile, writeFile, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { IReadingLogStore } from '#apps/school/ports/IReadingLogStore.mjs';

const LEARNER_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const STUDY_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isSafeLearnerId = (id) => typeof id === 'string' && LEARNER_ID_RE.test(id);
const isStudyDay = (day) => typeof day === 'string' && STUDY_DAY_RE.test(day);
const DUMP_OPTIONS = { indent: 2, lineWidth: -1, noRefs: true };
const orNull = (value) => (typeof value === 'string' && value ? value : null);

/** Filesystem-safe instant: `2026-08-26T18-04-00-000Z`. */
const stampFor = (value) => {
  const at = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();
  return at.toISOString().replace(/[:.]/g, '-');
};

export class YamlReadingLogStore extends IReadingLogStore {
  #configService;
  #logger;
  #clock;
  #writeChain = Promise.resolve();

  /**
   * @param {object} config
   * @param {object} config.configService - `getHouseholdPath()` provider (required)
   * @param {object} [config.logger]
   * @param {() => Date} [config.clock] - injectable so the side-file name is assertable
   */
  constructor({ configService, logger = console, clock = () => new Date() } = {}) {
    super();
    if (!configService || typeof configService.getHouseholdPath !== 'function') {
      throw new Error('YamlReadingLogStore: configService with getHouseholdPath() is required');
    }
    this.#configService = configService;
    this.#logger = logger;
    this.#clock = typeof clock === 'function' ? clock : () => new Date();
  }

  #dirFor(learnerId) {
    return path.join(this.#configService.getHouseholdPath('school/records/reading'), learnerId);
  }

  #fileFor(learnerId, studyDay) {
    return path.join(this.#dirFor(learnerId), `${studyDay}.yml`);
  }

  /**
   * Read one shard, keeping "there is no file" apart from "the file is not a
   * reading log". Never throws; the caller decides what each status costs.
   * @returns {{status: 'missing'|'ok'|'corrupt'|'unreadable', rows: object[],
   *            text: string|null, file: string, reason: string|null}}
   */
  #load(learnerId, studyDay) {
    const file = this.#fileFor(learnerId, studyDay);
    const answer = (status, extra = {}) => ({ status, rows: [], text: null, reason: null, file, ...extra });

    if (!fileExists(file)) return answer('missing');
    const text = readFile(file);
    // FileIO.readFile collapses every read failure to null; we already know the
    // file is there, so this is EACCES or worse — bytes we cannot rescue.
    if (typeof text !== 'string') return answer('unreadable', { reason: 'file exists but could not be read' });
    // A zero-byte shard holds no evidence, so replacing it destroys nothing.
    if (!text.trim()) return answer('missing', { text });

    let raw;
    try {
      raw = yaml.load(text);
    } catch (err) {
      return answer('corrupt', { text, reason: err.message });
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.reads)) {
      return answer('corrupt', { text, reason: 'document is not a reading log (no reads[] array)' });
    }
    const rows = raw.reads.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
    return answer('ok', { text, rows });
  }

  /** Copy the bad bytes aside before anything replaces them. Throws if it cannot. */
  #sideFileCorrupt({ learnerId, studyDay, file, text, reason }) {
    const base = `${file}.corrupt-${stampFor(this.#clock())}`;
    let preservedAt = base;
    // Never overwrite an earlier rescue: the whole point is that these survive.
    for (let n = 2; fileExists(preservedAt); n += 1) preservedAt = `${base}-${n}`;
    writeFile(preservedAt, text);
    this.#logger.error?.('school.reading-log.corrupt-side-filed', {
      learnerId, studyDay, file, preservedAt, error: reason,
    });
    return preservedAt;
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
    // out of the file — nor side-file the same corrupt shard twice.
    const queued = this.#writeChain.then(async () => {
      const loaded = this.#load(learnerId, studyDay);
      if (loaded.status === 'unreadable') {
        this.#logger.error?.('school.reading-log.unreadable', {
          learnerId, studyDay, file: loaded.file, error: loaded.reason,
        });
        throw new Error(
          `YamlReadingLogStore: ${loaded.file} exists but cannot be read; refusing to overwrite it`,
        );
      }
      const existing = loaded.status === 'corrupt'
        ? (this.#sideFileCorrupt({ learnerId, studyDay, ...loaded }), [])
        : loaded.rows;
      saveYamlToPathAtomic(
        loaded.file,
        { learnerId, studyDay, reads: [...existing, stored] },
        DUMP_OPTIONS,
      );
      return stored;
    });
    this.#writeChain = queued.catch(() => {});
    return queued;
  }

  /** @inheritdoc */
  async listForDay(learnerId, studyDay) {
    if (!isSafeLearnerId(learnerId) || !isStudyDay(studyDay)) return [];
    const loaded = this.#load(learnerId, studyDay);
    // Reads have NO side effects: a corrupt shard is reported and left exactly
    // as it is. Only `append`, which is about to replace it, side-files it.
    if (loaded.status === 'corrupt') {
      this.#logger.warn?.('school.reading-log.corrupt', {
        learnerId, studyDay, error: loaded.reason, file: loaded.file,
      });
      return [];
    }
    if (loaded.status === 'unreadable') {
      this.#logger.warn?.('school.reading-log.read-failed', {
        learnerId, studyDay, error: loaded.reason, file: loaded.file,
      });
      return [];
    }
    return loaded.rows;
  }
}

export default YamlReadingLogStore;
