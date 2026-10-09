import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import { fileExists, readBinaryFromPath, readDirectory, readTextFromPath, writeFile } from '#system/utils/FileIO.mjs';

/**
 * ContentTreeManifest — drift gets a diff (admin advocacy #20). The authored
 * content mount has no version control (a `.git` inside the Dropbox-synced
 * volume risks sync churn), so "what changed last week" was unanswerable
 * even in principle. This adapter hashes every YAML/MD file under the school
 * content tree into a manifest, diffs it against the previous run, and
 * persists both — the nightly task logs the diff, and the manifest file IS
 * the record an administrator can compare across backups.
 *
 * Storage: machine-local runtime cache at `school/content-manifest.yml`
 *   { generatedAt, fileCount, files: { <relative path>: <sha1-12> } }
 */
export class ContentTreeManifest {
  #contentDir; #manifestFile; #logger;

  constructor({ contentDir, manifestFile, logger = console } = {}) {
    if (!contentDir) throw new Error('ContentTreeManifest requires contentDir');
    if (!manifestFile) throw new Error('ContentTreeManifest requires manifestFile');
    this.#contentDir = contentDir;
    this.#manifestFile = manifestFile;
    this.#logger = logger;
  }

  #walk(dir, base = dir, out = []) {
    if (!fileExists(dir)) return out;
    for (const entry of readDirectory(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) this.#walk(full, base, out);
      else if (/\.(ya?ml|md)$/.test(entry.name)) out.push(path.relative(base, full));
    }
    return out;
  }

  buildManifest() {
    const files = {};
    for (const rel of this.#walk(this.#contentDir).sort()) {
      try {
        const bytes = readBinaryFromPath(path.join(this.#contentDir, rel));
        files[rel] = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 12);
      } catch { /* a file deleted mid-walk is tomorrow's diff, not today's crash */ }
    }
    return files;
  }

  /** Build, diff against the stored manifest, persist, and return the diff. */
  run({ now = () => new Date() } = {}) {
    const files = this.buildManifest();
    let previous = null;
    try {
      const raw = yaml.load(readTextFromPath(this.#manifestFile));
      if (raw && typeof raw === 'object' && raw.files) previous = raw.files;
    } catch { /* first run, or unreadable — diff against nothing */ }

    const added = [];
    const removed = [];
    const changed = [];
    if (previous) {
      for (const rel of Object.keys(files)) {
        if (!(rel in previous)) added.push(rel);
        else if (previous[rel] !== files[rel]) changed.push(rel);
      }
      for (const rel of Object.keys(previous)) if (!(rel in files)) removed.push(rel);
    }

    writeFile(this.#manifestFile, yaml.dump({
      generatedAt: now().toISOString(),
      fileCount: Object.keys(files).length,
      files,
    }, { noRefs: true }));

    const diff = { firstRun: !previous, added, removed, changed };
    if (previous && (added.length || removed.length || changed.length)) {
      this.#logger.info?.('school.content.drift', {
        added: added.length, removed: removed.length, changed: changed.length,
        sample: [...added, ...removed, ...changed].slice(0, 20),
      });
    }
    return diff;
  }
}

export default ContentTreeManifest;
