import path from 'node:path';
import { listYamlFiles, loadYamlSafe, saveYaml } from '#system/utils/FileIO.mjs';

/**
 * Narrow read/rename adapter used by MediaMemoryValidatorService.
 *
 * The canonical media-memory schema stores progress under keys such as
 * `plex:59498`; this adapter exposes the numeric Plex id expected by the
 * validator while retaining the exact file/key needed for a safe rename.
 */
export class YamlMediaMemoryValidationStore {
  constructor({ basePath } = {}) {
    if (!basePath) throw new TypeError('YamlMediaMemoryValidationStore requires basePath');
    this.basePath = basePath;
    this.locations = new Map();
  }

  async getAllEntries() {
    this.locations.clear();
    const entries = [];
    const files = listYamlFiles(this.basePath, { stripExtension: true, recursive: true });

    for (const relativeFile of files) {
      const fileBase = path.join(this.basePath, relativeFile);
      const data = loadYamlSafe(fileBase) || {};
      const libraryId = relativeFile.match(/(?:^|\/)(\d+)_/)?.[1] || null;

      for (const [storageKey, record] of Object.entries(data)) {
        if (!storageKey.startsWith('plex:') || !record || typeof record !== 'object') continue;
        const id = storageKey.slice('plex:'.length);
        if (!id) continue;
        const location = { fileBase, storageKey };
        if (!this.locations.has(id)) this.locations.set(id, []);
        this.locations.get(id).push(location);
        entries.push({ id, libraryId, ...record });
      }
    }

    return entries;
  }

  async updateId(oldId, newId, updates = {}) {
    const oldKey = String(oldId);
    const locations = this.locations.get(oldKey) || [];
    if (locations.length !== 1) {
      throw new Error(`Expected one media-memory entry for Plex id ${oldKey}; found ${locations.length}`);
    }

    const { fileBase, storageKey } = locations[0];
    const data = loadYamlSafe(fileBase) || {};
    if (!Object.hasOwn(data, storageKey)) {
      throw new Error(`Media-memory entry moved before validation completed: ${storageKey}`);
    }
    const nextStorageKey = `plex:${newId}`;
    if (nextStorageKey !== storageKey && Object.hasOwn(data, nextStorageKey)) {
      throw new Error(`Refusing to overwrite existing media-memory entry: ${nextStorageKey}`);
    }

    data[nextStorageKey] = { ...data[storageKey], ...updates };
    if (nextStorageKey !== storageKey) delete data[storageKey];
    saveYaml(fileBase, data);
  }
}

export default YamlMediaMemoryValidationStore;
