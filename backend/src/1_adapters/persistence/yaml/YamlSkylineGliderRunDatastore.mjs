import path from 'path';
import { ensureDir, listDirsMatching, listYamlFiles, loadYamlSafe, saveYaml } from '#system/utils/FileIO.mjs';

export class YamlSkylineGliderRunDatastore {
  constructor({ configService } = {}) {
    if (!configService) throw new Error('YamlSkylineGliderRunDatastore requires configService');
    this.configService = configService;
  }
  _base(householdId) { return this.configService.getHouseholdPath('fitness/log/skyline-glider', householdId); }
  _date(record) { return String(record?.run?.started_at || '').slice(0, 10); }
  async create(record, householdId) {
    const dir = path.join(this._base(householdId), this._date(record));
    ensureDir(dir);
    const file = path.join(dir, record.run.id);
    saveYaml(file, record);
    return `${file}.yml`;
  }
  async findById(runId, householdId) {
    for (const date of this._dates(householdId)) {
      const found = loadYamlSafe(path.join(this._base(householdId), date, runId));
      if (found) return found;
    }
    return null;
  }
  async findByDate(date, householdId) {
    const dir = path.join(this._base(householdId), date);
    return listYamlFiles(dir).map((id) => loadYamlSafe(path.join(dir, id))).filter(Boolean);
  }
  _dates(householdId) {
    return listDirsMatching(this._base(householdId), /^\d{4}-\d{2}-\d{2}$/);
  }
}
