import yaml from 'js-yaml';
import {
  buildContainedPath,
  readDirectoryAsync,
  readTextFromPathAsync,
} from '#system/utils/FileIO.mjs';
import { IScreensRepository } from '#apps/screens/ports/IScreensRepository.mjs';

/** Filesystem/YAML implementation of the screens application persistence port. */
export class FilesystemScreensRepository extends IScreensRepository {
  #householdDir;
  #logger;

  constructor({ householdDir, logger = console } = {}) {
    super();
    if (!householdDir) {
      throw new Error('FilesystemScreensRepository requires householdDir');
    }
    this.#householdDir = householdDir;
    this.#logger = logger;
  }

  async listScreenDocuments() {
    const screensDir = buildContainedPath(this.#householdDir, 'screens');
    let files;
    try {
      files = await readDirectoryAsync(screensDir);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { entries: [], unreadable: 0, directoryMissing: true };
      }
      throw error;
    }

    const screenFiles = files.filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'));
    let unreadable = 0;
    const entries = await Promise.all(screenFiles.map(async (file) => {
      const id = file.replace(/\.ya?ml$/, '');
      try {
        const filePath = buildContainedPath(screensDir, file);
        const document = yaml.load(await readTextFromPathAsync(filePath)) || {};
        return { id, document };
      } catch (error) {
        unreadable += 1;
        this.#logger.warn?.('screens.list.unreadable', {
          id,
          code: error.code,
          error: error.message,
        });
        return { id, document: null };
      }
    }));
    return { entries, unreadable, directoryMissing: false };
  }

  async findScreenById(screenId) {
    const filePath = buildContainedPath(this.#householdDir, `screens/${screenId}.yml`);
    try {
      return yaml.load(await readTextFromPathAsync(filePath));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
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

export default FilesystemScreensRepository;
