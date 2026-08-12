/**
 * YamlExerciseBank — read-only access to the exercise bank.
 *
 *   Root manifest    <dataDir>/content/music/index.yml
 *   Category index   <dataDir>/content/music/<category…>/index.yml
 *   Seed             <dataDir>/content/music/<category…>/<id>.yml
 *
 * Categories nest to any depth, because the tree is taxonomy: `chords/triads`
 * sits beside `drills/hanon/001`, and a method book is a category under the
 * family it belongs to rather than a peer of every musical form. A seed's id is
 * its path without the extension, so the id and the location cannot drift apart.
 *
 * The bank stores seeds; instances are computed by `shared/music/exerciseBank`
 * and never live on disk. This adapter owns path resolution and reading only —
 * expansion is pure and stays out of the adapter layer.
 *
 * Every resolved path is confined below the bank root, so a traversal in any
 * segment cannot escape it. Directories beginning with `_` are ignored: they
 * hold superseded material kept for reference, not content to serve.
 */
import path from 'path';
import fs from 'fs';
import { loadYaml } from '#system/utils/FileIO.mjs';

const HIDDEN = (name) => name.startsWith('_') || name.startsWith('.');

export class YamlExerciseBank {
  #root;

  constructor({ contentDir }) {
    if (!contentDir) throw new Error('YamlExerciseBank: contentDir required');
    this.#root = path.join(contentDir, 'music');
  }

  /** Resolves a bank-relative path, refusing anything that escapes the root. */
  #resolve(relative) {
    if (typeof relative !== 'string' || relative.includes('\\') || relative.includes('..')) return null;
    const segments = relative.split('/').filter(Boolean);
    if (!segments.length || segments.some(HIDDEN)) return null;
    const resolved = path.join(this.#root, ...segments);
    return resolved.startsWith(this.#root + path.sep) ? resolved : null;
  }

  available() {
    return fs.existsSync(this.#root);
  }

  getIndex() {
    return loadYaml(path.join(this.#root, 'index')) || null;
  }

  /** Every category path in the tree, depth-first: `chords`, `drills`, `drills/hanon`. */
  listCategories(under = '') {
    const dir = under ? this.#resolve(under) : this.#root;
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !HIDDEN(entry.name))
      .flatMap((entry) => {
        const relative = under ? `${under}/${entry.name}` : entry.name;
        return [relative, ...this.listCategories(relative)];
      })
      .sort();
  }

  /** Kept for callers that only want the top level. */
  listCollections() {
    return this.listCategories().filter((category) => !category.includes('/'));
  }

  getCategory(category) {
    const dir = this.#resolve(category);
    if (!dir || !fs.existsSync(dir)) return null;
    return loadYaml(path.join(dir, 'index')) || null;
  }

  /** Seed ids directly in one category — full paths, not bare filenames. */
  listSeeds(category) {
    const dir = this.#resolve(category);
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((file) => file.endsWith('.yml') && file !== 'index.yml')
      .map((file) => `${category}/${file.replace(/\.yml$/, '')}`)
      .sort();
  }

  /** Every seed in the bank, at any depth. Small enough to read whole. */
  allSeeds() {
    if (!this.available()) return [];
    return this.listCategories()
      .flatMap((category) => this.listSeeds(category))
      .map((id) => this.getSeed(id))
      .filter(Boolean);
  }

  /** `chords/triads` or `drills/hanon/001` — the id is the path. */
  getSeed(id) {
    const stem = this.#resolve(id);
    if (!stem || !fs.existsSync(`${stem}.yml`)) return null;
    return loadYaml(stem) || null;
  }
}

export default YamlExerciseBank;
