import path from 'node:path';
import yaml from 'js-yaml';
import { readTextFromPathAsync } from '#system/utils/FileIO.mjs';

const empty = () => ({ version: 1, profiles: {}, tracks: {}, artworks: {}, pairings: {} });
const map = (value) => value && typeof value === 'object' && !Array.isArray(value);

/** Household curation stays separate from asset facts and public source code. */
export class FilesystemAmbianceCatalog {
  constructor({ householdDir, logger }) {
    this.file = path.join(householdDir, 'art', 'ambiance.yml');
    this.logger = logger;
  }

  async load() {
    try {
      const doc = yaml.load(await readTextFromPathAsync(this.file));
      if (doc?.version !== 1 || !map(doc.profiles) || !map(doc.tracks) || !map(doc.artworks)) {
        this.logger?.warn?.('art.ambiance.invalid_catalog');
        return empty();
      }
      return { ...doc, pairings: map(doc.pairings) ? doc.pairings : {} };
    } catch (err) {
      if (err.code !== 'ENOENT') this.logger?.warn?.('art.ambiance.catalog_unavailable', { error: err.message });
      return empty();
    }
  }
}
