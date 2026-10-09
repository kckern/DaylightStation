import yaml from 'js-yaml';
import { buildContainedPath, readTextFromPathAsync } from '#system/utils/FileIO.mjs';

/** Loads the Art catalogs used to expand a screen's configured preset. */
export class FilesystemArtScreenPresetRepository {
  #householdDir;
  #logger;

  constructor({ householdDir, logger = console } = {}) {
    if (!householdDir) {
      throw new Error('FilesystemArtScreenPresetRepository requires householdDir');
    }
    this.#householdDir = householdDir;
    this.#logger = logger;
  }

  async getArtmodeConfig() {
    const document = await this.#readOptionalYaml(
      'art/artmode.yml',
      'artmode.config.read_failed',
    );
    return {
      presets: document.presets || {},
      defaults: document.defaults || {},
      frames: document.frames || {},
      schedule: Array.isArray(document.schedule) ? document.schedule : [],
    };
  }

  async getArtCollections() {
    const document = await this.#readOptionalYaml(
      'art/config.yml',
      'art.collections.read_failed',
    );
    return document.collections || {};
  }

  async #readOptionalYaml(relativePath, event) {
    const filePath = buildContainedPath(this.#householdDir, relativePath);
    try {
      return yaml.load(await readTextFromPathAsync(filePath)) || {};
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.#logger.warn?.(event, { error: error.message });
      }
      return {};
    }
  }
}
