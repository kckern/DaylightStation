/**
 * YamlCycleRaceDatastore - YAML persistence for cycle-game races.
 * Stored at: household[-{id}]/fitness/log/cycle-races/{YYYY-MM-DD}/{raceId}.yml
 * Mirrors YamlSessionDatastore; raceId is a YYYYMMDDHHmmss timestamp.
 */
import path from 'path';
import {
  ensureDir,
  saveYaml,
  loadYamlSafe,
  listYamlFiles,
  listDirsMatching,
  readFile,
  writeFileAtomic,
  getStats
} from '#system/utils/FileIO.mjs';

const INDEX_DIR_NAME = '_index';
// Bump whenever the row shape changes: a shard whose version differs is discarded
// and rebuilt from the race files, so a row written without a newer field is
// never trusted. v2 added `incomplete`; v3 added each participant's `stopped`.
const INDEX_VERSION = 3;

/** One index row per race: what the ladder and the pace-rival pool need, nothing more. */
export function indexEntryFromRecord(record, date) {
  const race = record?.race || {};
  return {
    id: race.id,
    date,
    course_id: race.course_id ?? null,
    win_condition: race.win_condition || 'distance',
    goal_m: race.goal_m ?? null,
    time_cap_s: race.time_cap_s ?? null,
    // Ended early by a rider — the ladder and personal bests skip these rows.
    incomplete: !!race.incomplete,
    participants: Object.entries(record?.participants || {}).map(([userId, p]) => ({
      userId,
      isGhost: String(userId).startsWith('ghost:'),
      // Parked when the race closed: never a pace rival (the ladder ignores it).
      stopped: !!p?.stopped,
      final_time_s: Number.isFinite(p?.final_time_s) ? p.final_time_s : null,
      final_distance_m: Number(p?.final_distance_m) || 0,
      placement: p?.placement ?? null
    }))
  };
}

export class YamlCycleRaceDatastore {
  constructor({ configService, logger = null } = {}) {
    if (!configService) throw new Error('YamlCycleRaceDatastore requires configService');
    this.configService = configService;
    this.logger = logger;
    // One index pass at a time per race folder: base dir -> { promise, dirtyDates }.
    this._indexJobs = new Map();
  }

  _baseDir(householdId) {
    return this.configService.getHouseholdPath('fitness/log/cycle-races', householdId);
  }

  _dateFromId(raceId) {
    const s = String(raceId);
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }

  getStoragePaths(raceId, householdId) {
    const base = this._baseDir(householdId);
    const dir = path.join(base, this._dateFromId(raceId));
    return { base, dir, file: path.join(dir, String(raceId)) };
  }

  async save(record, householdId) {
    const raceId = record?.race?.id;
    if (!raceId) throw new Error('cycle race record missing race.id');
    const p = this.getStoragePaths(raceId, householdId);
    ensureDir(p.dir);
    saveYaml(p.file, record);
    const date = this._dateFromId(raceId);
    // An index pass in flight may already hold this day's old records and will
    // write its shard after this save: tell it, so it drops the day at the end.
    this._indexJobs.get(p.base)?.dirtyDates.add(date);
    this._invalidateIndexDay(date, householdId);
    return `${p.file}.yml`;
  }

  async findById(raceId, householdId) {
    const p = this.getStoragePaths(raceId, householdId);
    return loadYamlSafe(p.file);
  }

  async findByDate(date, householdId) {
    const dir = path.join(this._baseDir(householdId), date);
    return listYamlFiles(dir)
      .map((id) => loadYamlSafe(path.join(dir, id)))
      .filter(Boolean);
  }

  async listDates(householdId) {
    return listDirsMatching(this._baseDir(householdId), /^\d{4}-\d{2}-\d{2}$/);
  }

  /**
   * All index entries across history. Month shards (_index/{YYYY-MM}.json) are
   * lazily (re)built per day: a day is trusted only if its folder mtime matches
   * what the shard recorded. save() invalidates its day, so in-place edits that
   * don't bump the folder mtime are still reflected.
   *
   * A rebuild parses race files synchronously, so it yields to the event loop
   * after each rebuilt day. Passes are therefore serialised per race folder:
   * a caller arriving during a pass shares its result, unless a save landed
   * during that pass, in which case the caller waits and runs a fresh one.
   */
  async listIndexEntries(householdId) {
    const key = this._baseDir(householdId);
    for (let running = this._indexJobs.get(key); running; running = this._indexJobs.get(key)) {
      if (running.dirtyDates.size === 0) return running.promise;
      await running.promise.catch(() => {});
    }
    const job = { dirtyDates: new Set(), promise: null };
    job.promise = this._runIndexPass(householdId, job).finally(() => {
      if (this._indexJobs.get(key) === job) this._indexJobs.delete(key);
    });
    this._indexJobs.set(key, job);
    return job.promise;
  }

  async _runIndexPass(householdId, job) {
    const t0 = Date.now();
    const dates = await this.listDates(householdId);
    const shardCache = new Map();
    const dirtyMonths = new Set();
    const getShard = (yyyymm) => {
      if (!shardCache.has(yyyymm)) shardCache.set(yyyymm, this._readIndexShard(householdId, yyyymm));
      return shardCache.get(yyyymm);
    };
    const entries = [];
    const rebuilt = { days: 0, races: 0, reasons: new Set() };
    for (const date of dates) {
      const yyyymm = date.slice(0, 7);
      const { shard, state } = getShard(yyyymm);
      const mtimeMs = this._dayDirMtimeMs(householdId, date);
      const cached = shard.days?.[date];
      let dayEntries;
      if (cached && cached.mtimeMs === mtimeMs && Array.isArray(cached.races)) {
        dayEntries = cached.races;
      } else {
        const records = await this.findByDate(date, householdId);
        dayEntries = records.map((r) => indexEntryFromRecord(r, date)).filter((e) => e.id);
        shard.days = shard.days || {};
        shard.days[date] = { mtimeMs, races: dayEntries };
        dirtyMonths.add(yyyymm);
        rebuilt.days += 1;
        rebuilt.races += dayEntries.length;
        rebuilt.reasons.add(state === 'ok' ? 'stale-day' : state);
        // Let other requests run before the next day's files are parsed.
        await new Promise((resolve) => setImmediate(resolve));
      }
      entries.push(...dayEntries);
    }
    // No await from here to the last shard write. Days saved during this pass
    // may be held here as their old rows: leave them out of the shards, so the
    // next pass reads them from the race files.
    for (const date of job.dirtyDates) {
      const yyyymm = date.slice(0, 7);
      const { shard } = getShard(yyyymm);
      if (shard.days && Object.prototype.hasOwnProperty.call(shard.days, date)) {
        delete shard.days[date];
        dirtyMonths.add(yyyymm);
      }
    }
    for (const yyyymm of dirtyMonths) this._saveIndexShard(householdId, yyyymm, shardCache.get(yyyymm).shard);
    if (rebuilt.days > 0) {
      // 'version': a shard of another index version was discarded. 'cold': a
      // month had no readable shard. 'stale-day': only days a good shard did
      // not cover, or whose folder changed (the day after any save).
      const reason = ['version', 'cold', 'stale-day'].find((r) => rebuilt.reasons.has(r));
      this.logger?.info?.('fitness.cycle_races.index.rebuilt', {
        days: rebuilt.days, races: rebuilt.races, ms: Date.now() - t0, reason
      });
    }
    return entries;
  }

  _indexShardPath(householdId, yyyymm) {
    return path.join(this._baseDir(householdId), INDEX_DIR_NAME, `${yyyymm}.json`);
  }

  /** A month's shard, and why it is empty when it is: 'ok' | 'cold' | 'version'. */
  _readIndexShard(householdId, yyyymm) {
    const empty = (state) => ({ shard: { version: INDEX_VERSION, days: {} }, state });
    const raw = readFile(this._indexShardPath(householdId, yyyymm));
    if (!raw) return empty('cold');
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.days !== 'object' || parsed.days === null) return empty('cold');
      if (parsed.version !== INDEX_VERSION) return empty('version');
      return { shard: parsed, state: 'ok' };
    } catch {
      return empty('cold');
    }
  }

  _loadIndexShard(householdId, yyyymm) {
    return this._readIndexShard(householdId, yyyymm).shard;
  }

  _saveIndexShard(householdId, yyyymm, shard) {
    try {
      ensureDir(path.join(this._baseDir(householdId), INDEX_DIR_NAME));
      // Staged and renamed: a reader never sees a half-written shard.
      writeFileAtomic(this._indexShardPath(householdId, yyyymm), JSON.stringify(shard));
    } catch {
      // derived data — a failed write just means a rebuild on the next read
    }
  }

  _dayDirMtimeMs(householdId, date) {
    const stats = getStats(path.join(this._baseDir(householdId), date));
    return stats ? stats.mtimeMs : null;
  }

  _invalidateIndexDay(date, householdId) {
    if (!date) return;
    const yyyymm = date.slice(0, 7);
    const shard = this._loadIndexShard(householdId, yyyymm);
    if (shard.days && Object.prototype.hasOwnProperty.call(shard.days, date)) {
      delete shard.days[date];
      this._saveIndexShard(householdId, yyyymm, shard);
    }
  }
}

export default YamlCycleRaceDatastore;
