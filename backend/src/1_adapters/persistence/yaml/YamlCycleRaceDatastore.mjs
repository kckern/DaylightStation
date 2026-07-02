/**
 * YamlCycleRaceDatastore - YAML persistence for cycle-game races.
 * Stored at: household[-{id}]/history/fitness/cycle-races/{YYYY-MM-DD}/{raceId}.yml
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
  writeFile,
  getStats
} from '#system/utils/FileIO.mjs';

const INDEX_DIR_NAME = '_index';
const INDEX_VERSION = 1;

/** One index row per race — everything the ladder needs, nothing more. */
export function indexEntryFromRecord(record, date) {
  const race = record?.race || {};
  return {
    id: race.id,
    date,
    course_id: race.course_id ?? null,
    win_condition: race.win_condition || 'distance',
    goal_m: race.goal_m ?? null,
    time_cap_s: race.time_cap_s ?? null,
    participants: Object.entries(record?.participants || {}).map(([userId, p]) => ({
      userId,
      isGhost: String(userId).startsWith('ghost:'),
      final_time_s: Number.isFinite(p?.final_time_s) ? p.final_time_s : null,
      final_distance_m: Number(p?.final_distance_m) || 0,
      placement: p?.placement ?? null
    }))
  };
}

export class YamlCycleRaceDatastore {
  constructor({ configService } = {}) {
    if (!configService) throw new Error('YamlCycleRaceDatastore requires configService');
    this.configService = configService;
  }

  _baseDir(householdId) {
    return this.configService.getHouseholdPath('history/fitness/cycle-races', householdId);
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
    this._invalidateIndexDay(this._dateFromId(raceId), householdId);
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
   */
  async listIndexEntries(householdId) {
    const dates = await this.listDates(householdId);
    const shardCache = new Map();
    const dirtyMonths = new Set();
    const getShard = (yyyymm) => {
      if (!shardCache.has(yyyymm)) shardCache.set(yyyymm, this._loadIndexShard(householdId, yyyymm));
      return shardCache.get(yyyymm);
    };
    const entries = [];
    for (const date of dates) {
      const yyyymm = date.slice(0, 7);
      const shard = getShard(yyyymm);
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
      }
      entries.push(...dayEntries);
    }
    for (const yyyymm of dirtyMonths) this._saveIndexShard(householdId, yyyymm, shardCache.get(yyyymm));
    return entries;
  }

  _indexShardPath(householdId, yyyymm) {
    return path.join(this._baseDir(householdId), INDEX_DIR_NAME, `${yyyymm}.json`);
  }

  _loadIndexShard(householdId, yyyymm) {
    const empty = { version: INDEX_VERSION, days: {} };
    const raw = readFile(this._indexShardPath(householdId, yyyymm));
    if (!raw) return empty;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== INDEX_VERSION || typeof parsed.days !== 'object' || parsed.days === null) return empty;
      return parsed;
    } catch {
      return empty;
    }
  }

  _saveIndexShard(householdId, yyyymm, shard) {
    try {
      ensureDir(path.join(this._baseDir(householdId), INDEX_DIR_NAME));
      writeFile(this._indexShardPath(householdId, yyyymm), JSON.stringify(shard));
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
