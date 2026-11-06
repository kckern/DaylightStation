import {
  buildContainedPath,
  fileExists,
  listYamlFiles,
  readFile,
  readYamlFromPath,
  saveYamlToPathAtomic,
} from '#system/utils/FileIO.mjs';
import { IContentFilterRepository } from "../../application/content-filter/ports/IContentFilterRepository.mjs";

/**
 * YAML/filesystem implementation of the content-filter repository.
 *
 * Curated profiles and overrides live below the household root. Regenerable
 * EDL files live below the media root. Raw filesystem mechanics remain in
 * FileIO; this adapter owns only the storage layout and YAML record shape.
 */
export class FilesystemContentFilterRepository extends IContentFilterRepository {
  #householdDir;
  #mediaDir;
  #logger;

  constructor({ householdDir, mediaDir, logger = console } = {}) {
    super();
    if (!householdDir) {
      throw new Error('FilesystemContentFilterRepository requires householdDir');
    }
    if (!mediaDir) {
      throw new Error('FilesystemContentFilterRepository requires mediaDir');
    }
    this.#householdDir = householdDir;
    this.#mediaDir = mediaDir;
    this.#logger = logger;
  }

  async getEdl(ratingKey) {
    return this.#readYaml(this.#mediaDir, `content-filter/edl/${ratingKey}.edl.yml`);
  }

  async getRefinedEdl({ workId, tagSetId } = {}) {
    const id = /^\d+$/;
    if (!id.test(String(workId ?? '')) || !id.test(String(tagSetId ?? ''))) return null;
    return this.#readYaml(this.#mediaDir, `content-filter/refined/${workId}-${tagSetId}.edl.yml`);
  }

  async saveRefinedEdl({ workId, tagSetId } = {}, edl) {
    const id = /^\d+$/;
    if (!id.test(String(workId ?? '')) || !id.test(String(tagSetId ?? ''))) throw new Error('saveRefinedEdl needs numeric workId and tagSetId');
    this.#writeYaml(this.#mediaDir, `content-filter/refined/${workId}-${tagSetId}.edl.yml`, edl);
  }

  async getTranscript(ratingKey, part) {
    if (!/^\d+$/.test(String(part ?? ''))) return null;
    const filePath = buildContainedPath(this.#mediaDir, `content-filter/refine/${ratingKey}/words-${part}.json`);
    if (!filePath || !fileExists(filePath)) return null;
    try {
      const { segments = [] } = JSON.parse(readFile(filePath));
      return { segments };
    } catch (error) {
      this.#logger.warn?.('content-filter.read.error', { path: filePath, error: error.message });
      return null;
    }
  }

  async getProfile(profileName) {
    return this.#readYaml(this.#householdDir, `content-filter/profiles/${profileName}.yml`);
  }

  async getOverride(ratingKey) {
    return this.#readYaml(this.#householdDir, `content-filter/overrides/${ratingKey}.yml`);
  }

  async listOverrides() {
    const dir = buildContainedPath(this.#householdDir, 'content-filter/overrides');
    return dir ? listYamlFiles(dir).filter((n) => /^\d+$/.test(n)) : [];
  }

  async saveOverride(ratingKey, override) {
    this.#writeYaml(this.#householdDir, `content-filter/overrides/${ratingKey}.yml`, override);
  }

  #writeYaml(root, relativePath, content) {
    const filePath = buildContainedPath(root, relativePath);
    if (!filePath) throw new Error(`content-filter path escapes its root: ${relativePath}`);
    // Atomic: the player reads these files on every title load; a half-written
    // override (no sync) or refined EDL would filter a whole viewing wrongly.
    saveYamlToPathAtomic(filePath, content, { lineWidth: 140 });
  }

  #readYaml(root, relativePath) {
    const filePath = buildContainedPath(root, relativePath);
    if (!filePath || !fileExists(filePath)) return null;
    try {
      return readYamlFromPath(filePath) || null;
    } catch (error) {
      this.#logger.warn?.('content-filter.read.error', {
        path: filePath,
        error: error.message,
      });
      return null;
    }
  }
}

export default FilesystemContentFilterRepository;
