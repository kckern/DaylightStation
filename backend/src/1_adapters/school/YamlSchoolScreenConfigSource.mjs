import path from 'node:path';
import { loadYamlFromPath } from '#system/utils/FileIO.mjs';
export class YamlSchoolScreenConfigSource {
  constructor({ householdDirectory } = {}) { this.householdDirectory = householdDirectory; }
  get = (screenId) => /^[a-zA-Z0-9_-]+$/.test(screenId) ? loadYamlFromPath(path.join(this.householdDirectory, 'screens', `${screenId}.yml`)) : null;
}
