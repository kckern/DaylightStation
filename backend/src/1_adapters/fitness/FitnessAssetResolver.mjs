// backend/src/1_adapters/fitness/FitnessAssetResolver.mjs

import path from 'path';
import { fileExists, readBinary } from '#system/utils/FileIO.mjs';

/**
 * FitnessAssetResolver — resolves user-avatar and equipment images from the
 * media image tree, with extension fallback.
 *
 * Extracted from the inline `avatarProvider` / `equipmentProvider` closures in
 * bootstrap (audit S-3). Resolution order per name is first-hit across
 * png → jpg → jpeg → webp → gif → svg, matching the original loops.
 *
 * - Avatars live at   `{avatarsDir}/{slug}.{ext}`   (media/img/users)
 * - Equipment lives at `{equipmentDir}/{name}.{ext}` (media/img/equipment)
 */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];

export class FitnessAssetResolver {
  #avatarsDir;
  #equipmentDir;

  /**
   * @param {Object} config
   * @param {string} config.avatarsDir - Directory of user avatar images
   * @param {string} config.equipmentDir - Directory of equipment images
   */
  constructor({ avatarsDir, equipmentDir } = {}) {
    this.#avatarsDir = avatarsDir;
    this.#equipmentDir = equipmentDir;
  }

  #resolveImage(dir, name) {
    if (!dir || name == null) return null;
    for (const ext of IMAGE_EXTENSIONS) {
      const p = path.join(dir, `${name}.${ext}`);
      if (fileExists(p)) return readBinary(p);
    }
    return null;
  }

  /**
   * Resolve a single user avatar.
   * @param {string} slug - User slug
   * @returns {Buffer|null}
   */
  getAvatar(slug) {
    return this.#resolveImage(this.#avatarsDir, slug);
  }

  /**
   * Resolve a single equipment image.
   * @param {string} name - Equipment name
   * @returns {Buffer|null}
   */
  getEquipmentImage(name) {
    return this.#resolveImage(this.#equipmentDir, name);
  }

  /**
   * Batch avatar resolution (provider contract used by GenerateSessionTimelapse).
   * @param {string[]} [slugs]
   * @returns {Promise<Object<string, Buffer>>} slug → image bytes (misses omitted)
   */
  async getAvatars(slugs) {
    const out = {};
    for (const slug of slugs || []) {
      const buf = this.getAvatar(slug);
      if (buf) out[slug] = buf;
    }
    return out;
  }

  /**
   * Batch equipment-image resolution (provider contract used by GenerateSessionTimelapse).
   * @param {string[]} [names]
   * @returns {Promise<Object<string, Buffer>>} name → image bytes (misses omitted)
   */
  async getEquipmentImages(names) {
    const out = {};
    for (const name of names || []) {
      const buf = this.getEquipmentImage(name);
      if (buf) out[name] = buf;
    }
    return out;
  }
}
