import {
  buildContainedPath,
  fileExists,
  readYamlFromPath,
} from '#system/utils/FileIO.mjs';
import { IContentFilterRepository } from '#apps/content-filter/ports/IContentFilterRepository.mjs';

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

  async getProfile(profileName) {
    return this.#readYaml(this.#householdDir, `content-filter/profiles/${profileName}.yml`);
  }

  async getOverride(ratingKey) {
    return this.#readYaml(this.#householdDir, `content-filter/overrides/${ratingKey}.yml`);
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
