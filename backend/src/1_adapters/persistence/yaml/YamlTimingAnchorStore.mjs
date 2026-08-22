/** Household-owned anchors for materializing time-sensitive School plans. */
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;

export class YamlTimingAnchorStore {
  #configService; #logger;

  constructor({ configService, logger = console } = {}) {
    if (!configService || typeof configService.getHouseholdPath !== 'function') {
      throw new Error('YamlTimingAnchorStore requires configService');
    }
    this.#configService = configService;
    this.#logger = logger;
  }

  #file() { return this.#configService.getHouseholdPath('school/plans/timing-anchors.yml'); }

  async list() {
    try {
      const raw = yaml.load(await fs.readFile(this.#file(), 'utf8'));
      return Array.isArray(raw?.anchors) ? raw.anchors.filter((anchor) => SAFE_ID.test(anchor?.anchorId ?? '')) : [];
    } catch (error) {
      if (error?.code !== 'ENOENT') this.#logger.warn?.('school.timing-anchors.read-failed', { error: error.message, file: this.#file() });
      return [];
    }
  }

  async get(anchorId) {
    if (!SAFE_ID.test(anchorId ?? '')) return null;
    return (await this.list()).find((anchor) => anchor.anchorId === anchorId) ?? null;
  }
}

export default YamlTimingAnchorStore;
