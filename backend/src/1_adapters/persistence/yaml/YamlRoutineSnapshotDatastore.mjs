/**
 * YamlRoutineSnapshotDatastore — the last imported routine catalog.
 *
 *   household[-{id}]/media/routines.yml   { importedAt, source, routines: [...] }
 *
 * Written through `PUT /api/v1/media/routines/catalog` (by
 * cli/media-routines.cli.mjs, run where the Home Assistant config is
 * readable). Read when the live source is not reachable from the app.
 */
import path from 'path';
import { loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';
import { IRoutineSnapshotDatastore } from '#apps/media/ports/IRoutineSnapshotDatastore.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

export class YamlRoutineSnapshotDatastore extends IRoutineSnapshotDatastore {
  /** @param {{configService: Object}} config */
  constructor(config) {
    super();
    if (!config?.configService) {
      throw new InfrastructureError('YamlRoutineSnapshotDatastore requires configService', { code: 'MISSING_DEPENDENCY', dependency: 'configService' });
    }
    this.configService = config.configService;
  }

  _path(householdId) {
    return path.join(this.configService.getHouseholdPath('media', householdId), 'routines');
  }

  async load(householdId) {
    const data = loadYamlSafe(this._path(householdId));
    if (!data || !Array.isArray(data.routines)) return null;
    return { routines: data.routines, importedAt: data.importedAt ?? null, source: data.source ?? null };
  }

  async save(snapshot, householdId) {
    const file = this._path(householdId);
    ensureDir(path.dirname(file));
    saveYaml(file, { importedAt: snapshot?.importedAt ?? null, source: snapshot?.source ?? null, routines: snapshot?.routines ?? [] });
  }
}

export default YamlRoutineSnapshotDatastore;
