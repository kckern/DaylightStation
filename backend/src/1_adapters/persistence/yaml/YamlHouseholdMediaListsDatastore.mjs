/**
 * YamlHouseholdMediaListsDatastore — household favourites and removed ids.
 *
 * Stored beside the household media queue (YamlMediaQueueDatastore):
 *   household[-{id}]/media/favourites.yml   { items: [ {id, kind, title, thumbnail, type, addedAt} ] }
 *   household[-{id}]/media/removed.yml      { items: { <contentId>: { removedAt } } }
 */
import path from 'path';
import { loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';
import { IHouseholdMediaListsDatastore } from '#apps/media/ports/IHouseholdMediaListsDatastore.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

export class YamlHouseholdMediaListsDatastore extends IHouseholdMediaListsDatastore {
  /**
   * @param {Object} config
   * @param {Object} config.configService - resolves household paths
   */
  constructor(config) {
    super();
    if (!config?.configService) {
      throw new InfrastructureError('YamlHouseholdMediaListsDatastore requires configService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'configService',
      });
    }
    this.configService = config.configService;
  }

  _path(name, householdId) {
    return path.join(this.configService.getHouseholdPath('media', householdId), name);
  }

  _save(name, householdId, data) {
    const file = this._path(name, householdId);
    ensureDir(path.dirname(file));
    saveYaml(file, data);
  }

  async loadFavourites(householdId) {
    const data = loadYamlSafe(this._path('favourites', householdId));
    return Array.isArray(data?.items) ? data.items.map((item) => ({ ...item })) : [];
  }

  async saveFavourites(favourites, householdId) {
    this._save('favourites', householdId, { items: (favourites || []).map((item) => ({ ...item })) });
  }

  async loadRemoved(householdId) {
    const data = loadYamlSafe(this._path('removed', householdId));
    return data?.items && typeof data.items === 'object' && !Array.isArray(data.items) ? { ...data.items } : {};
  }

  async saveRemoved(removed, householdId) {
    this._save('removed', householdId, { items: { ...(removed || {}) } });
  }
}

export default YamlHouseholdMediaListsDatastore;
