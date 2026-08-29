/**
 * YAML persistence for printed OMR form maps (spec §3.3).
 *
 *   <dataDir>/household/school/artifacts/print/forms/{formId}.yml
 *
 * The form id is the issued artifact id, so a reprint (same artifact) resolves
 * to the identical map and a remediation variant (new artifact) gets its own.
 * Writes are first-wins: the map describes paper that has already come out of
 * the printer, and rewriting it would silently re-point a scan at geometry that
 * was never on the sheet in the child's hand.
 */
import path from 'path';
import yaml from 'js-yaml';
import { IFormMapStore } from '#apps/school/ports/IFormMapStore.mjs';
import { readTextFromPath, writeFile } from '#system/utils/FileIO.mjs';

const FORM_ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });
const isSafeFormId = (id) => typeof id === 'string' && FORM_ID_RE.test(id);

export class YamlFormMapStore extends IFormMapStore {
  #configService;
  #writeChain = Promise.resolve();

  constructor(config = {}) {
    super();
    if (!config.configService || typeof config.configService.getHouseholdPath !== 'function') {
      throw new Error('YamlFormMapStore: configService with getHouseholdPath() is required');
    }
    this.#configService = config.configService;
  }

  #root() { return this.#configService.getHouseholdPath('school/artifacts/print/forms'); }

  #fileFor(formId) { return path.join(this.#root(), `${formId}.yml`); }

  /** @inheritdoc */
  async put(formId, formMap) {
    if (!isSafeFormId(formId)) throw new Error(`YamlFormMapStore: unsafe formId: ${formId}`);
    if (!formMap || typeof formMap !== 'object' || Array.isArray(formMap)) {
      throw new Error('YamlFormMapStore: formMap must be a mapping');
    }
    const queued = this.#writeChain.then(async () => {
      const existing = await this.get(formId);
      // First write wins — see the header: the paper is already printed.
      if (existing) return existing;
      writeFile(this.#fileFor(formId), dumpYaml(formMap));
      return formMap;
    });
    this.#writeChain = queued.catch(() => {});
    return queued;
  }

  /** @inheritdoc */
  async get(formId) {
    if (!isSafeFormId(formId)) return null;
    try {
      const raw = yaml.load(readTextFromPath(this.#fileFor(formId)));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      return raw;
    } catch {
      // Missing OR unreadable: the caller prints an explanation slip either way.
      return null;
    }
  }
}

export default YamlFormMapStore;
