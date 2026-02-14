/**
 * YamlListDatastore - YAML-based list persistence
 *
 * Implements IListStore port for household config list storage.
 * Lists are stored at: household[-{id}]/config/lists/{type}/{name}.yml
 *
 * Handles normalization (raw YAML -> canonical sections format) on read
 * and serialization (canonical -> compact YAML) on write via listConfigNormalizer.
 */
import path from 'path';
import {
  loadYamlSafe,
  saveYaml,
  listYamlFiles,
  ensureDir,
  deleteYaml
} from '#system/utils/FileIO.mjs';
import { normalizeListConfig, serializeListConfig } from '#adapters/content/list/listConfigNormalizer.mjs';
import { IListStore } from '#apps/content/ports/IListStore.mjs';

// Valid list types
const LIST_TYPES = ['menus', 'watchlists', 'programs'];

export class YamlListDatastore extends IListStore {
  /**
   * @param {Object} config
   * @param {Object} config.userDataService - UserDataService for household paths
   * @param {Object} config.configService - ConfigService for default household
   */
  constructor(config) {
    super();
    this.userDataService = config.userDataService;
    this.configService = config.configService;
  }

  /**
   * Get the lists base directory for a household
   */
  _getListsBaseDir(householdId) {
    const hid = householdId || this.configService.getDefaultHouseholdId();
    const basePath = this.userDataService.getHouseholdDir(hid);
    return path.join(basePath, 'config', 'lists');
  }

  /**
   * Get directory for a specific list type
   */
  _getTypeDir(type, householdId) {
    return path.join(this._getListsBaseDir(householdId), type);
  }

  /**
   * Get full path to a list file
   */
  _getListPath(type, listName, householdId) {
    return path.join(this._getTypeDir(type, householdId), listName);
  }

  /** @inheritdoc */
  getOverview(householdId) {
    const baseDir = this._getListsBaseDir(householdId);

    return LIST_TYPES.map(type => {
      const typeDir = path.join(baseDir, type);
      const names = listYamlFiles(typeDir);
      return {
        type,
        count: names.length,
        path: `config/lists/${type}`
      };
    });
  }

  /** @inheritdoc */
  listByType(type, householdId) {
    const typeDir = this._getTypeDir(type, householdId);
    const listNames = listYamlFiles(typeDir);

    return listNames.map(name => {
      const content = loadYamlSafe(path.join(typeDir, name));
      const list = normalizeListConfig(content, name);
      const itemCount = list.sections.reduce((sum, s) => sum + s.items.length, 0);
      return {
        name,
        title: list.title,
        description: list.description,
        metadata: list.metadata,
        itemCount
      };
    });
  }

  /** @inheritdoc */
  getList(type, name, householdId) {
    const listPath = this._getListPath(type, name, householdId);
    const content = loadYamlSafe(listPath);

    if (content === null) return null;

    return normalizeListConfig(content, name);
  }

  /** @inheritdoc */
  saveList(type, name, householdId, listConfig) {
    const listPath = this._getListPath(type, name, householdId);
    saveYaml(listPath, serializeListConfig(listConfig));
  }

  /** @inheritdoc */
  createList(type, name, householdId) {
    const typeDir = this._getTypeDir(type, householdId);
    const listPath = path.join(typeDir, name);

    // Check if list already exists
    const existing = loadYamlSafe(listPath);
    if (existing !== null) return false;

    // Ensure the type directory exists
    ensureDir(typeDir);

    // Create empty list with new object format
    saveYaml(listPath, { items: [] });
    return true;
  }

  /** @inheritdoc */
  deleteList(type, name, householdId) {
    const listPath = this._getListPath(type, name, householdId);

    // Check if list exists
    const existing = loadYamlSafe(listPath);
    if (existing === null) return false;

    deleteYaml(listPath);
    return true;
  }
}

export default YamlListDatastore;
