/**
 * YamlRoutineHistoryDatastore — the household routine history on disk.
 *
 *   household[-{id}]/history/media-routines.yml   { runs: [ {at, routine, deviceId, what, outcome, reason, ...} ] }
 *
 * Rolling (the service caps it: 30 days, 500 runs). Shape:
 * #domains/media/routineHistory.mjs.
 */
import path from 'path';
import { loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';
import { IRoutineHistoryDatastore } from '#apps/media/ports/IRoutineHistoryDatastore.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

export class YamlRoutineHistoryDatastore extends IRoutineHistoryDatastore {
  /** @param {{configService: Object}} config */
  constructor(config) {
    super();
    if (!config?.configService) {
      throw new InfrastructureError('YamlRoutineHistoryDatastore requires configService', { code: 'MISSING_DEPENDENCY', dependency: 'configService' });
    }
    this.configService = config.configService;
  }

  _path(householdId) {
    return path.join(this.configService.getHouseholdPath('history', householdId), 'media-routines');
  }

  async load(householdId) {
    const data = loadYamlSafe(this._path(householdId));
    return Array.isArray(data?.runs) ? data.runs.filter((r) => r && typeof r === 'object') : [];
  }

  async save(runs, householdId) {
    const file = this._path(householdId);
    ensureDir(path.dirname(file));
    saveYaml(file, { runs: runs || [] });
  }
}

export default YamlRoutineHistoryDatastore;
