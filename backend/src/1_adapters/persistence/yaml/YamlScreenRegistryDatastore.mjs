/**
 * YamlScreenRegistryDatastore — the household screen registry on disk.
 *
 *   household[-{id}]/media/screens.yml   { screens: {<id>: {...}}, aliases: {<id>: {into, mergedAt}},
 *                  adjacency?: {<room>: [<neighbouring rooms>]} }
 *
 * Shape and rules: #domains/media/screenRegistry.mjs. Written only through the
 * app (ScreenRegistryService), never by hand: devices.yml stays the source of
 * truth for configured screens, and name/room overrides live here.
 */
import path from 'path';
import { loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';
import { IScreenRegistryDatastore } from '#apps/media/ports/IScreenRegistryDatastore.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export class YamlScreenRegistryDatastore extends IScreenRegistryDatastore {
  /** @param {{configService: Object}} config - resolves household paths */
  constructor(config) {
    super();
    if (!config?.configService) {
      throw new InfrastructureError('YamlScreenRegistryDatastore requires configService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'configService',
      });
    }
    this.configService = config.configService;
  }

  _path(householdId) {
    return path.join(this.configService.getHouseholdPath('media', householdId), 'screens');
  }

  async load(householdId) {
    const data = loadYamlSafe(this._path(householdId));
    return {
      screens: isMap(data?.screens) ? { ...data.screens } : {},
      aliases: isMap(data?.aliases) ? { ...data.aliases } : {},
      ...(isMap(data?.adjacency) ? { adjacency: { ...data.adjacency } } : {}),
    };
  }

  async save(state, householdId) {
    const file = this._path(householdId);
    ensureDir(path.dirname(file));
    saveYaml(file, {
      screens: state?.screens ?? {},
      aliases: state?.aliases ?? {},
      ...(state?.adjacency && Object.keys(state.adjacency).length ? { adjacency: state.adjacency } : {}),
    });
  }
}

export default YamlScreenRegistryDatastore;
