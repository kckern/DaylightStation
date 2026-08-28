import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  fileExists, loadYamlFromPath, saveYamlToPathAtomic,
} from '#system/utils/FileIO.mjs';

export const COMPANION_CODE_SCHEMA = 'school.companion-code/v1';

const SAFE_ID = /^cmc_[a-f0-9]{16,}$/i;
const DUMP = { indent: 2, noRefs: true };

/**
 * ONE finish code per (household, lesson, lessonDay) — and the first print wins it.
 *
 * The scope deliberately DROPS the learner, which a worksheet does not. That one
 * missing degree of freedom is the whole sharing mechanism: two children on the
 * same lesson on the same day get the same code off different sheets, and when one
 * of them plays the companion through, the household is satisfied — the next child
 * opens it and the code is simply already there. `lessonDay` is the day the lesson
 * BELONGS to, never the day it was played, so a child catching up a week later
 * inherits what a sibling already earned instead of replaying the audio.
 *
 * WHICH MEANS TWO SIBLINGS ARE TWO WRITERS ON ONE FILE. That is the collision that
 * corrupted a companion record on 2026-08-26 (see YamlLessonCompanionStore's
 * header): a bare async read-modify-write let two saves 1ms apart interleave across
 * their await points and stitched one document's tail onto another's body. Here it
 * would be worse — losing a create race does not drop a progress sample, it mints a
 * SECOND code over a code already printed on a sibling's sheet, and that sheet can
 * then never pass its own gate.
 *
 * So both write paths are SYNCHRONOUS from the read to the write, with no await in
 * between: on a single-threaded runtime that makes each one indivisible, and the
 * lost-update race is closed by construction rather than by a lock. Writes go
 * through `saveYamlToPathAtomic`, which stages beside the file and renames, so a
 * concurrent reader sees the whole old document or the whole new one.
 *
 * `create` is a FUNCTION, not a value, so the caller that loses the race never mints
 * a code at all — nothing is drawn and thrown away, and nothing can be half-issued.
 *
 * NO POLICY LIVES HERE. Coverage arithmetic and the satisfaction rule are
 * `companionCoverage.mjs`'s; this only persists the shape.
 */
export class YamlCompanionCodeStore {
  #configService; #logger;

  constructor({ configService, logger = console } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlCompanionCodeStore requires configService');
    this.#configService = configService;
    this.#logger = logger;
  }

  /**
   * The deterministic id for a scope. Pure: no clock, no randomness, and sha256
   * rather than any in-process hash, so the SAME three inputs give the SAME id
   * across restarts and across containers — which is what lets a sibling next
   * week find the record this week's print created.
   *
   * The parts are JSON-encoded before hashing so a delimiter inside a lessonId
   * cannot make two different scopes collide onto one code.
   */
  keyFor({ householdId, lessonId, lessonDay } = {}) {
    const parts = [householdId, lessonId, lessonDay];
    if (parts.some((part) => typeof part !== 'string' || part.trim() === '')) {
      throw new Error('companion code key requires householdId, lessonId and lessonDay');
    }
    return `cmc_${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24)}`;
  }

  /** Id validated BEFORE any path is resolved, so an unsafe id never reaches the disk. */
  #file(id) {
    if (typeof id !== 'string' || !SAFE_ID.test(id)) throw new Error(`unsafe companion code id: ${id}`);
    return path.join(this.#configService.getHouseholdPath('school/records/companion-codes'), `${id}.yml`);
  }

  /**
   * A record, or null. Absent and unreadable both answer null — but only
   * unreadable is an ERROR, because a file that exists and will not parse is a
   * printed code the gate can no longer check, and that must never be inferred
   * from silence.
   */
  #read(file, id) {
    if (!fileExists(file)) return null;
    const record = loadYamlFromPath(file);
    if (record == null) {
      this.#logger.error?.('school.companion-code.unreadable', { id, file });
      return null;
    }
    return record;
  }

  async get(id) {
    return this.#read(this.#file(id), id);
  }

  /**
   * The existing record, or the one `create()` returns, written once.
   *
   * NO await between the existence check and the write: a second caller arriving
   * in the same tick runs this body only after the first has finished, sees the
   * file, and gets the first code back without its own `create` ever being called.
   *
   * An existing-but-unparseable file THROWS rather than being treated as absent.
   * Minting over it would replace a code that may already be on paper, and a
   * loud failure at print time is recoverable where a silently wrong gate row is
   * not.
   */
  async findOrCreate({ key, create } = {}) {
    const file = this.#file(key);
    if (typeof create !== 'function') throw new Error('findOrCreate requires a create function');

    if (fileExists(file)) {
      const existing = this.#read(file, key);
      if (!existing) throw new Error(`companion code record is unreadable: ${key}`);
      return existing;
    }

    const record = create();
    if (record == null) throw new Error(`companion code create() produced nothing: ${key}`);
    // A record filed under one id but carrying another would be invisible to
    // every later `get(key)`, so refuse it instead of writing it.
    if (record.id != null && record.id !== key) {
      throw new Error(`companion code record id ${record.id} does not match its key ${key}`);
    }
    saveYamlToPathAtomic(file, record, DUMP);
    return record;
  }

  /**
   * Read-modify-write, synchronous end to end for the reason in the header.
   * A mutator that edits its draft in place and returns nothing is honoured —
   * returning `undefined` must never blank a record.
   */
  async update(id, mutate) {
    const file = this.#file(id);
    const current = this.#read(file, id);
    if (!current) return null;
    const draft = structuredClone(current);
    const next = mutate(draft) ?? draft;
    saveYamlToPathAtomic(file, next, DUMP);
    return next;
  }
}

export default YamlCompanionCodeStore;
