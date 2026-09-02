// Storage: data/users/{username}/apps/health/medical.yml — { readings: [...] }
import { IMedicalReadingsDatastore } from '#apps/health/ports/IMedicalReadingsDatastore.mjs';

export class YamlMedicalReadingsDatastore extends IMedicalReadingsDatastore {
  #dataService;
  static MEDICAL_PATH = 'apps/health/medical';

  constructor(config) {
    super();
    if (!config.dataService) throw new Error('YamlMedicalReadingsDatastore requires dataService');
    this.#dataService = config.dataService;
  }

  async load(userId) {
    const raw = this.#dataService.user.read?.(YamlMedicalReadingsDatastore.MEDICAL_PATH, userId);
    return raw && Array.isArray(raw.readings) ? raw : { readings: [] };
  }

  async save(doc, userId) {
    const result = this.#dataService.user.write?.(YamlMedicalReadingsDatastore.MEDICAL_PATH, doc, userId);
    if (result === false) {
      const err = new Error(`MEDICAL_WRITE_FAILED: could not write medical readings to ${YamlMedicalReadingsDatastore.MEDICAL_PATH} for user ${userId}`);
      err.code = 'MEDICAL_WRITE_FAILED';
      throw err;
    }
  }
}
export default YamlMedicalReadingsDatastore;
