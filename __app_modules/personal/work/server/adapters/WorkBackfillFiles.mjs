import path from 'node:path';
import * as FileIO from '#system/utils/FileIO.mjs';
import { WorkBackfillCheckpoint } from './WorkBackfillCheckpoint.mjs';
const outside = (data, target) => {
  const relative = path.relative(data, target);
  return !!relative && (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative));
};
/** Private operator artifacts. This adapter has no user-data writer. */
export class WorkBackfillFiles {
  #root;
  constructor({
    outputDir,
    dataDir
  }) {
    if (typeof outputDir !== 'string' || !outputDir) throw new TypeError('Private output path required');
    const data = FileIO.resolveRealPath(dataDir),
      requested = path.resolve(outputDir);
    let ancestor = requested;
    while (!FileIO.resolveRealPath(ancestor)) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw new Error('Invalid output path');
      ancestor = parent;
    }
    const candidate = path.resolve(FileIO.resolveRealPath(ancestor), path.relative(ancestor, requested));
    if (!data || !outside(data, candidate)) throw new Error('Output must be outside data');
    FileIO.ensureDir(candidate, {
      mode: 0o700
    });
    this.#root = FileIO.resolveRealPath(candidate);
    if (!this.#root || !outside(data, this.#root) || !FileIO.getFileStats(this.#root).isDirectory()) throw new Error('Output must be a directory outside data');
    this.checkpoint = new WorkBackfillCheckpoint({
      outputDir: this.#root,
      dataDir: data
    });
  }
  readJson(filename) {
    const real = FileIO.resolveRealPath(filename);
    if (!real || path.dirname(real) !== this.#root || !real.endsWith('.json')) throw new Error('Invalid artifact path');
    const stat = FileIO.getFileStats(real);
    if (!stat.isFile() || stat.size > 50 * 1024 * 1024) throw new Error('Invalid artifact file');
    return JSON.parse(FileIO.readTextFromPath(real));
  }
  writeJson({
    name,
    value
  }) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}\.json$/.test(name ?? '')) throw new Error('Invalid artifact path');
    const filename = path.join(this.#root, name);
    FileIO.writeBinaryAtomic(filename, Buffer.from(JSON.stringify(value, null, 2) + '\n'), {
      durable: true,
      mode: 0o600,
      directoryMode: 0o700
    });
    return filename;
  }
}
