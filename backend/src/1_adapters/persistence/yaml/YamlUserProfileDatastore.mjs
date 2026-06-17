// backend/src/1_adapters/persistence/yaml/YamlUserProfileDatastore.mjs
import { loadYamlFromPath, saveYamlToPath } from '#system/utils/FileIO.mjs';

/**
 * YamlUserProfileDatastore
 *
 * YAML-backed persistence for a single user's profile.yml. Resolves the path via
 * the configService user-dir SSOT; YAML (de)serialization is delegated to FileIO.
 * `load`/`save` are injectable so the read/write surface is unit-testable without
 * touching disk.
 *
 * Path: data/users/<username>/profile.yml
 *
 * @module adapters/persistence/yaml
 */
export class YamlUserProfileDatastore {
  #configService;
  #load;
  #save;

  constructor({ configService, load = loadYamlFromPath, save = saveYamlToPath }) {
    if (!configService || typeof configService.getUserDir !== 'function') {
      throw new Error('YamlUserProfileDatastore: configService with getUserDir() is required');
    }
    this.#configService = configService;
    this.#load = load;
    this.#save = save;
  }

  #pathFor(username) {
    return `${this.#configService.getUserDir(username)}/profile.yml`;
  }

  /** @returns {object|null} parsed profile, or null when the file is absent */
  readProfile(username) {
    return this.#load(this.#pathFor(username)) ?? null;
  }

  /** Persist the full profile object back to disk. */
  writeProfile(username, profile) {
    this.#save(this.#pathFor(username), profile);
  }
}
