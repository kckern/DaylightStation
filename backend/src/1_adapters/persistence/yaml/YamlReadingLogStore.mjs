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
 * IDEMPOTENT ON `pickId`, per study day. The caller mints one id per finish and
 * may send it more than once — a retried request, a remounted player. Since
 * `doneToday` is `rows.length >= target`, a duplicate row is a duplicate BOOK,
 * so a repeat returns the row already on disk and writes nothing. A `null`
 * pickId is NOT a key and never dedupes: two hand-recorded reads of the same
 * book are two reads.
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
 * AND THE SAME RULE ONE LEVEL DOWN, inside a shard that IS a reading log. An
 * entry in `reads[]` that is not shaped like a read (a hand-merge that pasted a
 * bare title, say — the very repair `programs.md` asks an operator to perform)
 * used to be filtered out for the reader and then written back missing, so the
 * rewrite deleted it with no side-file and no log. It is now carried through
 * VERBATIM and warned about. That is deliberately gentler than side-filing the
 * whole shard: one unreadable line does not make the document something other
 * than a reading log, and the drastic remedy would cost the operator every
 * GOOD row on the very edit we told them to make. Readers count `rows`;
 * writers rewrite `entries`. Nothing is ever silently dropped.
 *
 * All I/O goes through `#system/utils/FileIO.mjs` (see `adapters-no-direct-fs`),
 * and the shard is written with `saveYamlToPathAtomic` — a torn write is one of
 * the ways a shard becomes corrupt in the first place.
 */
import path from 'path';
import yaml from 'js-yaml';
import { fileExists, readFile, writeFileAtomic, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
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
   *
   * `rows` is what a READER should count — entries shaped like reads. `entries`
   * is the verbatim `reads:` array, including anything we did not recognise,
   * and is what a WRITER must rewrite, so an entry we cannot read is still an
   * entry we cannot delete.
   *
   * @returns {{status: 'missing'|'empty'|'ok'|'corrupt'|'unreadable',
   *            rows: object[], entries: unknown[], unrecognised: number,
   *            text: string|null, file: string, reason: string|null}}
   */
  #load(learnerId, studyDay) {
    const file = this.#fileFor(learnerId, studyDay);
    const answer = (status, extra = {}) => ({
      status, rows: [], entries: [], unrecognised: 0, text: null, reason: null, file, ...extra,
    });

    if (!fileExists(file)) return answer('missing');
    const text = readFile(file);
    // FileIO.readFile collapses every read failure to null; we already know the
    // file is there, so this is EACCES, EISDIR or worse — bytes we cannot rescue.
    if (typeof text !== 'string') return answer('unreadable', { reason: 'file exists but could not be read' });
    // A zero-byte shard holds no evidence, so replacing it destroys nothing —
    // but a file that is zero-byte BECAUSE it was truncated has already lost
    // its rows, and that is worth a line in the log.
    if (!text.trim()) return answer('empty', { text, reason: 'shard is empty' });

    let raw;
    try {
      raw = yaml.load(text);
    } catch (err) {
      return answer('corrupt', { text, reason: err.message });
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.reads)) {
      return answer('corrupt', { text, reason: 'document is not a reading log (no reads[] array)' });
    }
    const entries = raw.reads;
    const rows = entries.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
    const unrecognised = entries.length - rows.length;
    return answer('ok', {
      text,
      entries,
      rows,
      unrecognised,
      reason: unrecognised ? `${unrecognised} unrecognised entr${unrecognised === 1 ? 'y' : 'ies'} in reads[]` : null,
    });
  }

  /**
   * A recognisable reading log holding an entry we cannot read is NOT a corrupt
   * document — it is one bad line, and it must not cost the shard. Warn, count
   * only what we recognise, and (on the write path) carry the rest through
   * untouched.
   */
  #warnUnrecognised(learnerId, studyDay, loaded) {
    if (!loaded.unrecognised) return;
    this.#logger.warn?.('school.reading-log.unrecognised-entries', {
      learnerId, studyDay, file: loaded.file, unrecognised: loaded.unrecognised, error: loaded.reason,
    });
  }

  /** Copy the bad bytes aside before anything replaces them. Throws if it cannot. */
  #sideFileCorrupt({ learnerId, studyDay, file, text, reason }) {
    const base = `${file}.corrupt-${stampFor(this.#clock())}`;
    let preservedAt = base;
    // Never overwrite an earlier rescue: the whole point is that these survive.
    for (let n = 2; fileExists(preservedAt); n += 1) preservedAt = `${base}-${n}`;
    // Atomic like the shard write: a crash mid-copy must not leave a truncated
    // rescue, which would be the same torn-write class we are rescuing FROM.
    writeFileAtomic(preservedAt, text);
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
      pickId: orNull(row.pickId),
    };
    // `orNull` is what makes '' not a key: only a real string dedupes.
    const pickId = stored.pickId;
    // Serialized like the sibling YAML stores: this is a read-modify-write, and
    // two books finishing seconds apart in the same room must not race one row
    // out of the file — nor side-file the same corrupt shard twice.
    //
    // DO NOT "simplify" this chain away. Every step below is synchronous today
    // (FileIO is sync), so within one process nothing can interleave and the
    // chain looks redundant. It is what keeps this correct the moment anyone
    // swaps in an async FileIO — which is precisely how the read-modify-write
    // hole this store already had gets reopened.
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
      if (loaded.status === 'empty') {
        this.#logger.warn?.('school.reading-log.empty', {
          learnerId, studyDay, file: loaded.file, error: loaded.reason,
        });
      }
      this.#warnUnrecognised(learnerId, studyDay, loaded);

      // IDEMPOTENT ON pickId. One finish, one row — a retried POST or a player
      // that remounts and fires `ended` twice must not credit a child twice for
      // one book, because `doneToday` is `rows.length >= target`.
      //
      // Scanned over `rows`, not `entries`: an entry we could not parse cannot
      // carry a matching key, and must still ride through the rewrite untouched.
      // Free here — the day's rows are already in hand inside the write chain,
      // so this costs no extra read.
      //
      // Scoped to this shard, which IS the scope: the same story finished again
      // tomorrow is a new obligation, not a repeat of today's.
      if (pickId) {
        const already = loaded.rows.find((entry) => entry.pickId === pickId);
        if (already) {
          this.#logger.debug?.('school.reading-log.duplicate-pick', {
            learnerId, studyDay, pickId, file: loaded.file,
          });
          // Return what is ON DISK, not what was handed in, and write nothing
          // at all — so a repeat cannot disturb the shard in any way.
          return already;
        }
      }

      // `entries`, not `rows`: an entry we could not parse is still an entry we
      // are not allowed to delete. It rides through the rewrite verbatim.
      const existing = loaded.status === 'corrupt'
        ? (this.#sideFileCorrupt({ learnerId, studyDay, ...loaded }), [])
        : loaded.entries;
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
    if (loaded.status === 'empty') {
      this.#logger.warn?.('school.reading-log.empty', {
        learnerId, studyDay, error: loaded.reason, file: loaded.file,
      });
      return [];
    }
    // Under-counting must never be silent: the operator watching `status()` sees
    // the number drop, and this is the line that tells them why.
    this.#warnUnrecognised(learnerId, studyDay, loaded);
    return loaded.rows;
  }
}

export default YamlReadingLogStore;
