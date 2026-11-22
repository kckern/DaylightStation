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
import { readHouseholdYamlFile, writeHouseholdYamlFile } from './HouseholdYamlFile.mjs';
import { IScreenRegistryDatastore } from "../../application/ports/IScreenRegistryDatastore.mjs";
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const isMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

function validRegistry(data) {
  if (!isMap(data) || !isMap(data.screens) || !isMap(data.aliases)) return false;
  if (!Object.values(data.screens).every(isMap) || !Object.values(data.aliases).every(isMap)) return false;
  if (Object.hasOwn(data, 'adjacency')) {
    if (!isMap(data.adjacency)) return false;
    if (!Object.values(data.adjacency).every((rooms) => Array.isArray(rooms)
      && rooms.every((room) => typeof room === 'string'))) return false;
  }
  return true;
}

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
    const { found, value: data } = readHouseholdYamlFile(this._path(householdId));
    if (!found) return { screens: {}, aliases: {} };
    if (!validRegistry(data)) {
      throw new InfrastructureError('Invalid household media screen registry', {
        code: 'INVALID_SCREEN_REGISTRY', householdId,
      });
    }
    return {
      screens: { ...data.screens },
      aliases: { ...data.aliases },
      ...(Object.hasOwn(data, 'adjacency') ? { adjacency: { ...data.adjacency } } : {}),
    };
  }

  async save(state, householdId) {
    if (!validRegistry(state)) {
      throw new InfrastructureError('Invalid household media screen registry', {
        code: 'INVALID_SCREEN_REGISTRY', householdId,
      });
    }
    const data = {
      screens: state.screens,
      aliases: state.aliases,
      ...(state.adjacency && Object.keys(state.adjacency).length ? { adjacency: state.adjacency } : {}),
    };
    writeHouseholdYamlFile(this._path(householdId), data);
  }
}

export default YamlScreenRegistryDatastore;
