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
  listDirsMatching
} from '#system/utils/FileIO.mjs';

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
}

export default YamlCycleRaceDatastore;
