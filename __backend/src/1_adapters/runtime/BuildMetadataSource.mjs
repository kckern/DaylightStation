import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileExists, getFileStats, readTextFromPath } from '#system/utils/FileIO.mjs';

/** Resolves baked production metadata or a development Git commit reference. */
export class BuildMetadataSource {
  constructor({ bakedFile = '/build.txt', checkoutDirectory } = {}) {
    this.bakedFile = bakedFile;
    this.checkoutDirectory = checkoutDirectory;
  }

  /** Bounded source metadata, never a claim that a deployed artifact was verified. */
  diagnosticIdentity() {
    const unavailable = { source: 'unavailable', verification: 'unavailable', commit: null, metadataSha256: null };
    try {
      const metadata = this.read();
      if (metadata.kind === 'file' && getFileStats(metadata.path).size > 8192) return unavailable;
      const text = metadata.kind === 'file' ? readTextFromPath(metadata.path) : metadata.value;
      if (typeof text !== 'string' || !text || Buffer.byteLength(text) > 8192) return unavailable;
      const commit = text.match(/^Commit: (?:https?:\/\/[^\s]+\/commit\/)?([a-f0-9]{40})\r?$/mi)?.[1]?.toLowerCase() ?? null;
      if (metadata.kind !== 'file' && !commit) return unavailable;
      return { source: metadata.kind === 'file' ? 'baked-build-metadata' : 'development-checkout',
        verification: 'declared-unverified', commit, metadataSha256: createHash('sha256').update(text).digest('hex') };
    } catch { return unavailable; }
  }

  read() {
    if (fileExists(this.bakedFile)) return { kind: 'file', path: this.bakedFile };
    let commit = 'unknown';
    try {
      commit = execSync('git rev-parse HEAD', { cwd: this.checkoutDirectory }).toString().trim();
    } catch { /* development tree may not be a Git checkout */ }
    return {
      kind: 'text',
      value: `Build Time: dev (not built)\nCommit: https://github.com/kckern/DaylightStation/commit/${commit}\n`,
    };
  }
}
