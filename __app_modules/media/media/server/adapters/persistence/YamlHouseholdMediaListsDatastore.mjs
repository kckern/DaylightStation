/**
 * YamlHouseholdMediaListsDatastore — household favourites and removed ids.
 *
 * Stored beside the household media queue (YamlMediaQueueDatastore):
 *   household[-{id}]/media/favourites.yml   { items: [ {id, kind, title, thumbnail, type, addedAt} ] }
 *   household[-{id}]/media/removed.yml      { items: { <contentId>: { removedAt } } }
 *   household[-{id}]/media/continue-review.yml
 *                                           { items: { <contentId>: { decision: keep|clear, decidedAt } } }
 *     A person's decision on a Continue listening entry from before listened time
 *     was measured (lookup spec §13): keep it, or clear it.
 */
import path from 'path';
import { readHouseholdYamlFile, writeHouseholdYamlFile } from './HouseholdYamlFile.mjs';
import { timestampEpoch } from '../../../../../../__capabilities/playback/server/spot-history.mjs';
import { IHouseholdMediaListsDatastore } from "../../application/ports/IHouseholdMediaListsDatastore.mjs";
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

  _loadItems(name, householdId, isValidItems, emptyItems) {
    const { found, value: data } = readHouseholdYamlFile(this._path(name, householdId));
    if (!found) return emptyItems;
    if (!isPlainMapping(data) || !isValidItems(data.items)) {
      throw new InfrastructureError(`Invalid household media ${name} list`, {
        code: 'INVALID_HOUSEHOLD_MEDIA_LIST', name, householdId,
      });
    }
    return data.items;
  }

  _save(name, householdId, data) {
    writeHouseholdYamlFile(this._path(name, householdId), data);
  }

  async loadFavourites(householdId) {
    const items = this._loadItems('favourites', householdId, (value) => Array.isArray(value)
      && value.every((item) => isPlainMapping(item) && typeof item.id === 'string' && item.id.trim()), []);
    return items.map((item) => ({ ...item }));
  }

  async saveFavourites(favourites, householdId) {
    this._save('favourites', householdId, { items: (favourites || []).map((item) => ({ ...item })) });
  }

  async loadRemoved(householdId) {
    const items = this._loadItems('removed', householdId, (value) => isPlainMapping(value)
      && Object.entries(value).every(([id, entry]) => id.trim() && isPlainMapping(entry)
        && isTimestamp(entry.removedAt)), {});
    return Object.fromEntries(Object.entries(items).map(([id, entry]) => [id, {
      ...entry,
      removedAt: entry.removedAt instanceof Date ? entry.removedAt.toISOString() : entry.removedAt,
    }]));
  }

  async saveRemoved(removed, householdId) {
    this._save('removed', householdId, { items: { ...(removed || {}) } });
  }

  async loadContinueDecisions(householdId) {
    const items = this._loadItems('continue-review', householdId, (value) => isPlainMapping(value)
      && Object.entries(value).every(([id, entry]) => id.trim() && isPlainMapping(entry)
        && (entry.decision === 'keep' || entry.decision === 'clear')), {});
    return Object.fromEntries(Object.entries(items).map(([id, entry]) => [id, {
      ...entry,
      decidedAt: entry.decidedAt instanceof Date ? entry.decidedAt.toISOString() : (entry.decidedAt ?? null),
    }]));
  }

  async saveContinueDecisions(decisions, householdId) {
    this._save('continue-review', householdId, { items: { ...(decisions || {}) } });
  }
}

function isPlainMapping(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isTimestamp(value) {
  return (typeof value === 'string' && Number.isFinite(timestampEpoch(value)))
    || (value instanceof Date && Number.isFinite(value.getTime()));
}

export default YamlHouseholdMediaListsDatastore;
