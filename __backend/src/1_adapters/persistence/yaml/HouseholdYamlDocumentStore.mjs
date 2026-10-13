import path from 'node:path';
import { loadYaml, saveYaml } from '#system/utils/FileIO.mjs';

/** Compatibility persistence boundary for remaining household YAML consumers. */
export class HouseholdYamlDocumentStore {
  constructor({ householdDirectory } = {}) {
    if (!householdDirectory) throw new Error('HouseholdYamlDocumentStore requires householdDirectory');
    this.householdDirectory = householdDirectory;
  }
  load = (relativePath) => loadYaml(path.join(this.householdDirectory, relativePath));
  save = (relativePath, value) => saveYaml(path.join(this.householdDirectory, relativePath), value);
}
