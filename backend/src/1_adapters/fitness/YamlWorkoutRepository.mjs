// backend/src/1_adapters/fitness/YamlWorkoutRepository.mjs
//
// Persistence for the workouts Build authors and Run performs.
//
// WHY HOUSEHOLD-SCOPED, NOT PER-USER
// ----------------------------------
// `<dataDir>/<household>/apps/fitness/workouts/{id}.yml`. The garage screen is shared
// equipment and session history is already household-wide, so a workout one person
// builds must be runnable by whoever walks in next; the record carries an `author`
// field so credit survives without partitioning the shelf. Filing these per-user would
// mean the person standing at the rack cannot start the workout their spouse built an
// hour earlier — a worse failure than an unattributed plan.
//
// CONTRACTS
// ---------
// 1. ONE FILE PER WORKOUT, WRITTEN ATOMICALLY. `saveYamlToPathAtomic` stages beside the
//    target and renames, so a Run player reading while Build saves sees either the whole
//    old document or the whole new one — never a truncated group list. A workout is read
//    mid-session, so a half-written file is a person standing at a bar with no next step.
// 2. WHAT IS STORED IS WHAT THE DOMAIN NORMALIZED. Every write runs through `makeWorkout`,
//    so the file on disk already has coerced counts and the reps/seconds conflict already
//    resolved. Reads normalize again rather than trusting the file: a hand-edited YAML is
//    expected here (this tree is Dropbox-synced and people do edit it).
// 3. IDS ARE FILENAMES, so an id that is not `[A-Za-z0-9][A-Za-z0-9_-]{0,63}` is refused
//    on write and treated as "unknown" on read/delete. That is the containment boundary:
//    `../../../etc/passwd` must never resolve to a path, and answering 404 for it leaks
//    nothing about what exists.
// 4. `createdAt` SURVIVES AN UPDATE. Save reads the existing record's createdAt back and
//    re-stamps only `updatedAt`, so the picker's "most recent" ordering means "recently
//    edited" without losing when the plan was first authored.
// 5. NO VALIDATION OF SLUGS HERE. This adapter has no corpus access by design — see
//    `SaveWorkout`, which holds the library index and rejects unknown slugs before the
//    record ever reaches this file.
// 6. A MISSING WORKOUTS DIRECTORY IS AN EMPTY SHELF, not an error. Nobody has saved a
//    workout on a fresh install, and Build's picker must render "no workouts yet" rather
//    than a 500. `listFiles` already answers [] for a missing dir; the first save creates
//    it via `saveYamlToPathAtomic`'s ensureDir.

import path from 'node:path';
import {
  listFiles,
  loadYamlFromPath,
  saveYamlToPathAtomic,
  deleteFile,
  fileExists,
} from '#system/utils/FileIO.mjs';
import { makeWorkout, expandWorkout } from '#domains/fitness/workout/workout.mjs';
import { ValidationError } from '#system/utils/errors/index.mjs';

/** Ids are filenames. Anything outside this shape cannot address a file here. */
export const WORKOUT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Path, relative to the household directory, where workouts live. */
const WORKOUTS_RELATIVE_DIR = 'apps/fitness/workouts';

/** @returns {boolean} true when `id` may be used as a filename in the workouts dir. */
export function isValidWorkoutId(id) {
  return typeof id === 'string' && WORKOUT_ID_PATTERN.test(id);
}

export class YamlWorkoutRepository {
  #configService;
  #logger;
  #clock;

  /**
   * @param {Object} deps
   * @param {Object} deps.configService ConfigService — the ONLY source of the data path.
   * @param {Object} [deps.logger] Anything with debug/warn/error. Defaults to console to
   *   match sibling adapters; the composition root injects a child logger.
   * @param {Function} [deps.clock] `() => Date`, injected so timestamps are testable.
   */
  constructor({ configService, logger = console, clock = () => new Date() } = {}) {
    if (!configService) throw new ValidationError('YamlWorkoutRepository requires configService');
    this.#configService = configService;
    this.#logger = logger ?? console;
    this.#clock = clock;
  }

  /**
   * Absolute directory for one household's workouts.
   *
   * `getHouseholdPath` resolves the household's folder name (`household`, or
   * `household-{id}` for a second household) off `getDataDir()`. Where it is absent —
   * the hand-rolled configService stubs some tests use — fall back to the default
   * household folder rather than hardcoding a data root.
   */
  #dir(householdId = null) {
    if (typeof this.#configService.getHouseholdPath === 'function') {
      return this.#configService.getHouseholdPath(WORKOUTS_RELATIVE_DIR, householdId);
    }
    return path.join(this.#configService.getDataDir(), 'household', WORKOUTS_RELATIVE_DIR);
  }

  #file(id, householdId) {
    return path.join(this.#dir(householdId), `${id}.yml`);
  }

  /**
   * Every stored workout as a SUMMARY — never a full body.
   *
   * The picker renders a title, who built it and how much work it is; shipping every set,
   * rep and load for every workout would put the whole shelf on the wire to draw a list.
   * `setCount` is derived through `expandWorkout` so the number on the card is the number
   * of work steps the runner will actually walk, rather than a second count that drifts.
   *
   * Ordered most-recently-updated first — the picker's top row should be the thing just
   * built. Ties break on id so the order is total and stable across reads.
   *
   * @returns {Array<{id, title, author, createdAt, updatedAt, groupCount, exerciseCount, setCount}>}
   */
  list(householdId = null) {
    const dir = this.#dir(householdId);
    const summaries = [];
    for (const filename of listFiles(dir)) {
      if (!filename.endsWith('.yml')) continue;
      const id = filename.slice(0, -'.yml'.length);
      if (!isValidWorkoutId(id)) continue;
      const raw = loadYamlFromPath(path.join(dir, filename));
      if (!raw || typeof raw !== 'object') {
        this.#logger.warn?.('fitness.workouts.unreadable', { id });
        continue;
      }
      summaries.push(this.#summarize(raw, id));
    }
    summaries.sort((a, b) => {
      const byUpdated = String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      return byUpdated !== 0 ? byUpdated : String(a.id).localeCompare(String(b.id));
    });
    return summaries;
  }

  #summarize(raw, id) {
    const workout = makeWorkout({ ...raw, id });
    const workSteps = expandWorkout(workout).filter((step) => step.kind === 'work');
    return {
      id: workout.id,
      title: workout.title,
      author: workout.author,
      createdAt: raw.createdAt ?? null,
      updatedAt: raw.updatedAt ?? null,
      groupCount: workout.groups.length,
      exerciseCount: workout.groups.reduce((sum, group) => sum + group.exercises.length, 0),
      setCount: workSteps.length,
    };
  }

  /**
   * One workout, normalized, with its stored timestamps. `null` for an unknown id — and
   * an unsafe id is unknown, not an error, so a probe for `../secrets` reads as a 404.
   */
  get(id, householdId = null) {
    if (!isValidWorkoutId(id)) return null;
    const raw = loadYamlFromPath(this.#file(id, householdId));
    if (!raw || typeof raw !== 'object') return null;
    return {
      ...makeWorkout({ ...raw, id }),
      createdAt: raw.createdAt ?? null,
      updatedAt: raw.updatedAt ?? null,
    };
  }

  /** @returns {boolean} whether a workout is already stored under this id. */
  exists(id, householdId = null) {
    if (!isValidWorkoutId(id)) return false;
    return fileExists(this.#file(id, householdId));
  }

  /**
   * Create or replace a workout. The caller supplies the id (SaveWorkout generates one
   * for a new workout); an id that cannot be a filename is refused here as the last line
   * of containment even though the use case checks it first.
   *
   * @returns {{id: string, createdAt: string, updatedAt: string, created: boolean}}
   */
  save(workout, householdId = null) {
    const normalized = makeWorkout(workout);
    const id = normalized.id;
    if (!isValidWorkoutId(id)) {
      throw new ValidationError(`invalid workout id: ${JSON.stringify(id)}`, {
        code: 'INVALID_WORKOUT_ID',
      });
    }
    const existing = loadYamlFromPath(this.#file(id, householdId));
    const now = this.#clock().toISOString();
    const record = {
      id,
      title: normalized.title,
      author: normalized.author,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      groups: normalized.groups.map((group) => ({
        rounds: group.rounds,
        exercises: group.exercises.map((exercise) => ({ ...exercise })),
      })),
    };
    saveYamlToPathAtomic(this.#file(id, householdId), record);
    this.#logger.debug?.('fitness.workouts.saved', {
      id,
      created: !existing,
      groups: record.groups.length,
    });
    return { id, createdAt: record.createdAt, updatedAt: record.updatedAt, created: !existing };
  }

  /** @returns {boolean} true if a file was removed, false if the id was unknown. */
  delete(id, householdId = null) {
    if (!isValidWorkoutId(id)) return false;
    const removed = deleteFile(this.#file(id, householdId));
    if (removed) this.#logger.debug?.('fitness.workouts.deleted', { id });
    return removed;
  }
}

export default YamlWorkoutRepository;
