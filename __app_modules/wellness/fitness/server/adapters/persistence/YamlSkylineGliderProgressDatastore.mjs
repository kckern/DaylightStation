import path from 'path';
import { loadYamlSafe, saveYaml } from '#system/utils/FileIO.mjs';

// One file per rider: fitness/skyline-glider/progress/<riderId>.yml. Derived
// from the run log, so deleting a file only forces a rebuild.
export class YamlSkylineGliderProgressDatastore {
  constructor({ configService } = {}) {
    if (!configService) throw new Error('YamlSkylineGliderProgressDatastore requires configService');
    this.configService = configService;
  }
  _file(riderId, householdId) {
    return path.join(this.configService.getHouseholdPath('fitness/skyline-glider/progress', householdId), riderId);
  }
  async find(riderId, householdId) { return loadYamlSafe(this._file(riderId, householdId)); }
  async save(riderId, progress, householdId) { saveYaml(this._file(riderId, householdId), progress); }
}
