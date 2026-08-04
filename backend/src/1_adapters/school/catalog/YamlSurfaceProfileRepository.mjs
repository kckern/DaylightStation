import path from 'node:path';
import { validateSurfaceProfile } from '#domains/school/surfaces/index.mjs';
import { listYamlFiles, loadYaml } from '#system/utils/FileIO.mjs';

/**
 * Reads `school.surface-profile/v1` YAML files from a single flat directory
 * (spec §4.1/§9) — mirrors the directory-walk style of
 * `YamlLearningCatalogRepository`, but non-recursive: one profile per file.
 *
 * `customCapabilities` lets composition inject capability IDs beyond the
 * reviewed `KNOWN_CAPABILITY_IDS` inventory. Callers construct this with
 * `customCapabilities: moduleRegistry.list().map((d) => d.capability)`
 * (review finding 11) — harmless duplicates with the known inventory, and
 * genuinely custom module capabilities validate correctly against static
 * surface profiles that reference them.
 */
export class YamlSurfaceProfileRepository {
  #directory; #customCapabilities; #io;

  constructor({ directory, customCapabilities = [], io = {} } = {}) {
    if (typeof directory !== 'string' || directory.trim().length === 0) {
      throw new Error('YamlSurfaceProfileRepository requires a non-empty directory');
    }
    this.#directory = directory;
    this.#customCapabilities = [...customCapabilities];
    this.#io = { list: io.list ?? listYamlFiles, load: io.load ?? loadYaml };
  }

  /**
   * Parses every `<directory>/*.yml` through `validateSurfaceProfile`.
   * Invalid files are returned with their `errors` — never silently skipped
   * — so callers (registry, CLI, diagnostics) can surface authoring mistakes.
   *
   * @returns {Promise<Array<{profile?: object, errors: string[], file: string}>>}
   */
  async listProfiles() {
    const files = [...this.#io.list(this.#directory)].sort();
    return files.map((relative) => {
      const raw = this.#io.load(path.join(this.#directory, relative));
      const { profile, errors } = validateSurfaceProfile(raw, { customCapabilities: this.#customCapabilities });
      return { ...(profile ? { profile } : {}), errors, file: relative };
    });
  }
}

export default YamlSurfaceProfileRepository;
