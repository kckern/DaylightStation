/**
 * YamlDocumentFileStore — read/write one YAML document at an absolute path.
 *
 * WHY THIS EXISTS. `3_applications` must not touch the filesystem
 * (`apps-no-fs`; application-layer-guidelines.md). Several school services own
 * genuinely interesting rules — version-pinning a learner's saved cube state
 * against the course revision, deriving a reel's revision from its bytes — but
 * reached for `fs.readFileSync`/`writeFileSync` to do it, which put persistence
 * mechanics in the layer that is supposed to be pure orchestration.
 *
 * This is the smallest adapter that lets those services keep their rules and
 * give up the mechanics: the CALLER still decides which path it wants (that is
 * its own storage layout, resolved through `ConfigService`), and this owns
 * only "turn that path into a document, and back again".
 *
 * `read` answers the fallback for a missing file rather than throwing, because
 * "this learner has no progress yet" is the ordinary first case, not an error.
 * A file that EXISTS but cannot be parsed is a different fact and does throw —
 * silently discarding a corrupt file would hand a learner a fresh record and
 * destroy the broken one on the next write.
 *
 * @module adapters/school/YamlDocumentFileStore
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export class YamlDocumentFileStore {
  /**
   * @param {string} file - absolute path
   * @param {*} [fallback] - returned when the file does not exist
   */
  read(file, fallback = null) {
    if (!fs.existsSync(file)) return fallback;
    return yaml.load(fs.readFileSync(file, 'utf8'));
  }

  /** True when the path exists — for callers whose rule is "have they started?" */
  exists(file) {
    return fs.existsSync(file);
  }

  /** Raw bytes, for callers that hash a file to derive a revision. */
  readBytes(file) {
    return fs.readFileSync(file);
  }

  /** Entry names directly under a directory; `[]` when it does not exist. */
  list(dir) {
    return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  }

  /** Write a document, creating its directory. */
  write(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, yaml.dump(value, { noRefs: true }));
    return value;
  }
}

export default YamlDocumentFileStore;
