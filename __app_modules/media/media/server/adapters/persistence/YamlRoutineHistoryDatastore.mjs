/**
 * YamlRoutineHistoryDatastore — the household routine history on disk.
 *
 *   household[-{id}]/history/media-routines.yml   { runs: [ {at, routine, deviceId, what, outcome, reason, ...} ] }
 *
 * Rolling (the service caps it: 30 days, 500 runs). Shape:
 * #domains/media/routineHistory.mjs.
 */
import path from 'path';
import { readHouseholdYamlFile, writeHouseholdYamlFile } from './HouseholdYamlFile.mjs';
import { IRoutineHistoryDatastore } from "../../application/ports/IRoutineHistoryDatastore.mjs";
import { InfrastructureError } from '#system/utils/errors/index.mjs';

function isPlainMapping(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isRoutineRun(run) {
  const validAt = (run?.at instanceof Date && Number.isFinite(run.at.getTime()))
    || (typeof run?.at === 'string' && Number.isFinite(Date.parse(run.at)));
  return isPlainMapping(run)
    && validAt
    && isPlainMapping(run.routine)
    && (run.routine.id == null || typeof run.routine.id === 'string')
    && (run.routine.name == null || typeof run.routine.name === 'string')
    && typeof run.deviceId === 'string' && !!run.deviceId.trim()
    && ['failed', 'deduplicated', 'started'].includes(run.outcome)
    && (run.what == null || isPlainMapping(run.what))
    && (run.reason == null || typeof run.reason === 'string');
}

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
    const { found, value: data } = readHouseholdYamlFile(this._path(householdId));
    if (!found) return [];
    if (!isPlainMapping(data) || !Array.isArray(data.runs) || !data.runs.every(isRoutineRun)) {
      throw new InfrastructureError('Invalid household routine history', {
        code: 'INVALID_ROUTINE_HISTORY', householdId,
      });
    }
    return data.runs.map((run) => run.at instanceof Date ? { ...run, at: run.at.toISOString() } : run);
  }

  async save(runs, householdId) {
    if (!Array.isArray(runs) || !runs.every(isRoutineRun)) {
      throw new InfrastructureError('Invalid household routine history', {
        code: 'INVALID_ROUTINE_HISTORY', householdId,
      });
    }
    writeHouseholdYamlFile(this._path(householdId), {
      runs: runs.map((run) => run.at instanceof Date ? { ...run, at: run.at.toISOString() } : run),
    });
  }
}

export default YamlRoutineHistoryDatastore;
