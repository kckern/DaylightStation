import { execSync } from 'node:child_process';
import { fileExists } from '#system/utils/FileIO.mjs';

/** Resolves baked production metadata or a development Git commit reference. */
export class BuildMetadataSource {
  constructor({ bakedFile = '/build.txt', checkoutDirectory } = {}) {
    this.bakedFile = bakedFile;
    this.checkoutDirectory = checkoutDirectory;
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
