// Storage: data/users/{username}/apps/health/medical.yml — { readings: [...] }
import { IMedicalReadingsDatastore } from "../../../application/health/ports/IMedicalReadingsDatastore.mjs";
import { InfrastructureError } from '#system/utils/errors/index.mjs';

function isPlainMapping(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export class YamlMedicalReadingsDatastore extends IMedicalReadingsDatastore {
  #dataService;
  static MEDICAL_PATH = 'apps/health/medical';

  constructor(config) {
    super();
    if (!config.dataService) throw new Error('YamlMedicalReadingsDatastore requires dataService');
    this.#dataService = config.dataService;
  }

  async load(userId) {
    const entry = this.#dataService.user.readStrictEntry(YamlMedicalReadingsDatastore.MEDICAL_PATH, userId);
    if (!entry.found) return { readings: [] };
    if (!isPlainMapping(entry.value) || !Array.isArray(entry.value.readings)) {
      throw new InfrastructureError('Invalid medical readings document', {
        code: 'INVALID_MEDICAL_READINGS', userId,
      });
    }
    return entry.value;
  }

  async save(doc, userId) {
    if (!isPlainMapping(doc) || !Array.isArray(doc.readings)) {
      throw new InfrastructureError('Invalid medical readings document', {
        code: 'INVALID_MEDICAL_READINGS', userId,
      });
    }
    const result = this.#dataService.user.write?.(YamlMedicalReadingsDatastore.MEDICAL_PATH, doc, userId);
    if (result === false) {
      const err = new Error(`MEDICAL_WRITE_FAILED: could not write medical readings to ${YamlMedicalReadingsDatastore.MEDICAL_PATH} for user ${userId}`);
      err.code = 'MEDICAL_WRITE_FAILED';
      throw err;
    }
  }
}
export default YamlMedicalReadingsDatastore;
