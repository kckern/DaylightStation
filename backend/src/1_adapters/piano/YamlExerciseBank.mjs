/**
 * YamlExerciseBank — read-only access to the exercise bank.
 *
 *   Root manifest      <dataDir>/content/music/index.yml
 *   Collection index   <dataDir>/content/music/{collection}/index.yml
 *   Seed               <dataDir>/content/music/{collection}/{id}.yml
 *
 * The bank stores seeds; instances are computed by `shared/music/exerciseBank`
 * and never live on disk. This adapter owns path resolution and reading only —
 * expansion is pure and stays out of the adapter layer.
 *
 * `contentDir` is injected rather than read from a config singleton, matching
 * the other piano adapters. Every path is confined below the bank root, so a
 * traversal in a collection or id cannot escape it.
 */
import path from 'path';
import fs from 'fs';
import { loadYaml } from '#system/utils/FileIO.mjs';

export class YamlExerciseBank {
  #root;

  constructor({ contentDir }) {
    if (!contentDir) throw new Error('YamlExerciseBank: contentDir required');
    this.#root = path.join(contentDir, 'music');
  }

  /** Segments are single path components; the resolved path is confined below the root. */
  #resolve(...segments) {
    if (segments.some((s) => typeof s !== 'string' || !s || s.includes('/') || s.includes('\\') || s.includes('..'))) {
      return null;
    }
    const resolved = path.join(this.#root, ...segments);
    return resolved.startsWith(this.#root + path.sep) || resolved === this.#root ? resolved : null;
  }

  /** True when the bank is present at all — lets the router answer 503 rather than 404. */
  available() {
    return fs.existsSync(this.#root);
  }

  /** Root manifest: collections, seed and instance totals. */
  getIndex() {
    return loadYaml(path.join(this.#root, 'index')) || null;
  }

  /** Collection ids actually on disk, whether or not the manifest lists them. */
  listCollections() {
    if (!this.available()) return [];
    return fs.readdirSync(this.#root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }

  getCollection(collection) {
    const dir = this.#resolve(collection);
    if (!dir || !fs.existsSync(dir)) return null;
    return loadYaml(path.join(dir, 'index')) || null;
  }

  /** Seed ids in a collection, excluding the collection's own index. */
  listSeeds(collection) {
    const dir = this.#resolve(collection);
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((file) => file.endsWith('.yml') && file !== 'index.yml')
      .map((file) => file.replace(/\.yml$/, ''))
      .sort();
  }

  /** Every seed in the bank, for search. Small enough to read whole (tens of files). */
  allSeeds() {
    return this.listCollections().flatMap((collection) => (
      this.listSeeds(collection)
        .map((id) => this.getSeed(collection, id))
        .filter(Boolean)
    ));
  }

  getSeed(collection, id) {
    // loadYaml appends the extension, so resolve on the bare id and check the file.
    const stem = this.#resolve(collection, id);
    if (!stem || !fs.existsSync(`${stem}.yml`)) return null;
    return loadYaml(stem) || null;
  }
}

export default YamlExerciseBank;
