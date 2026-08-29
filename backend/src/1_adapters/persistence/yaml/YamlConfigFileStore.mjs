/**
 * Read/write a YAML file under the data root, by absolute path.
 *
 * WHY THIS EXISTS. Four admin services — apps config, household admin,
 * integrations query, scheduler admin — each imported `fs` to run the same
 * four primitives: does it exist, read and parse it, dump and write it
 * (creating the parent), and stat it. Decision D5 bans `fs` in
 * `3_applications` outright: data operations go through datastore ports.
 *
 * The services keep what is theirs — WHICH file, what the contents mean, and
 * the allow/mask policy over `household/config` and `household/auth`. This
 * owns only the four primitives.
 *
 * Absolute paths in, deliberately. These callers resolve their own locations
 * (they are an admin surface over config, which is not a domain and does not
 * move), so this does not second-guess where the file is. It is the I/O, not
 * the policy.
 */
import path from 'node:path';
import yaml from 'js-yaml';
import { fileExists, getStats, readDirectory, readTextFromPath, writeFileAtomic } from '#system/utils/FileIO.mjs';

/** Matches the dump options the admin services already used. */
const DUMP_OPTS = { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false };

export class YamlConfigFileStore {
  #logger;

  constructor({ logger = console } = {}) {
    this.#logger = logger;
  }

  /** @returns {boolean} */
  exists(absPath) {
    return fileExists(absPath);
  }

  /** `{ size, mtime }` for an existing file, or null. */
  stat(absPath) {
    const s = getStats(absPath);
    if (!s) return null;
    return { size: s.size, mtime: s.mtime };
  }

  /** Walk a persistence root and return YAML file metadata. */
  listYamlFiles(rootDir, dataRoot) {
    const files = [];
    const walk = (dir) => {
      if (!fileExists(dir)) return;
      for (const entry of readDirectory(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          walk(fullPath);
        } else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
          const stat = getStats(fullPath);
          if (!stat) continue;
          files.push({
            path: path.relative(dataRoot, fullPath).replace(/\\/g, '/'),
            name: entry.name,
            size: stat.size,
            modified: stat.mtime.toISOString(),
          });
        }
      }
    };
    walk(rootDir);
    return files;
  }

  /** Raw text, or null when absent. Callers that want YAML use readYaml. */
  readText(absPath) {
    if (!fileExists(absPath)) return null;
    return readTextFromPath(absPath);
  }

  /**
   * Parsed YAML, or `fallback` when the file is absent.
   *
   * A present-but-unparseable file is NOT silently treated as empty — that is
   * how a syntax error in a config file turns into a wiped config on the next
   * write. It throws, and the admin surface reports it.
   */
  readYaml(absPath, fallback = {}) {
    const raw = this.readText(absPath);
    if (raw === null) return fallback;
    return yaml.load(raw) ?? fallback;
  }

  /** Write text, creating the parent directory. Atomic: a full replacement
   *  that truncates first can be read (or crashed into) mid-write, and this
   *  store owns config files that something else is always reading. */
  writeText(absPath, contents) {
    writeFileAtomic(absPath, contents);
    return absPath;
  }

  /** Dump and write, creating the parent directory. */
  writeYaml(absPath, data) {
    return this.writeText(absPath, yaml.dump(data, DUMP_OPTS));
  }
}

export default YamlConfigFileStore;
