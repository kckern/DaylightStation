import path from 'node:path';
import {
  ensureDir, fileExists, loadYamlFromPath, saveYamlToPathAtomic,
} from '#system/utils/FileIO.mjs';

const SAFE_ID = /^ral_[a-z0-9_-]{6,}$/i;
const DUMP = { indent: 2, noRefs: true };

/**
 * Mutable lesson-companion telemetry, intentionally separate from worksheets.
 *
 * Persistence goes through `#system/utils/FileIO.mjs` rather than `node:fs`.
 * That is not decoration: `saveYamlToPathAtomic` stages beside the file and
 * renames, so a reader sees either the whole old document or the whole new one,
 * and it is SYNCHRONOUS — which is what makes the read-modify-write in
 * `update()` indivisible on a single-threaded runtime.
 *
 * Both properties were missing on 2026-08-26, when a bare async
 * `fs.writeFile` read-modify-write let two progress saves 1ms apart
 * (03:24:53.232Z and .233Z) interleave across their await points. The loser's
 * changes were dropped and the file was left with a shorter document's body
 * stitched to a longer one's tail — an unterminated quote and a duplicate
 * `lastUpdatedAt`. Every open afterwards logged `school.companion.unreadable`
 * and refused the child entry to their own read-along.
 */
export class YamlLessonCompanionStore {
  #configService; #logger;
  constructor({ configService, logger = console } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlLessonCompanionStore requires configService');
    this.#configService = configService; this.#logger = logger;
  }
  #file(id) {
    if (typeof id !== 'string' || !SAFE_ID.test(id)) throw new Error(`unsafe lesson companion id: ${id}`);
    return path.join(this.#configService.getHouseholdPath('school/records/companions'), `${id}.yml`);
  }
  /**
   * A record, or null. Absent and unreadable both answer null — but only
   * unreadable is an ERROR, because a file that exists and will not parse is
   * a child locked out of their lesson, and that must never be inferred from
   * silence.
   */
  #read(file, id) {
    if (!fileExists(file)) return null;
    const record = loadYamlFromPath(file);
    if (record == null) {
      this.#logger.error?.('school.companion.unreadable', { id, file });
      return null;
    }
    return record;
  }
  async get(id) {
    const file = this.#file(id);
    return this.#read(file, id);
  }
  async put(record) {
    const file = this.#file(record?.id);
    // Create-only, preserving the old `flag: 'wx'` guarantee: ids are minted
    // fresh, so an existing file means a collision, and silently clobbering it
    // would take another learner's companion with it.
    if (fileExists(file)) throw new Error(`lesson companion already exists: ${record?.id}`);
    ensureDir(path.dirname(file));
    saveYamlToPathAtomic(file, record, DUMP);
    return record;
  }
  async update(id, updater) {
    const file = this.#file(id);
    // NO await between the read and the write. Two concurrent updates each run
    // this body to completion before the other starts, so neither can read a
    // base the other is about to replace — the lost-update race, closed by
    // construction rather than by a lock.
    const current = this.#read(file, id);
    if (!current) return null;
    const next = updater(structuredClone(current));
    saveYamlToPathAtomic(file, next, DUMP);
    return next;
  }
}

export default YamlLessonCompanionStore;
