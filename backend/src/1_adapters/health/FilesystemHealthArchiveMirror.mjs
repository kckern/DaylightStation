import path from 'node:path';
import crypto from 'node:crypto';
import { IHealthArchiveMirror } from '#apps/health/ports/IHealthArchiveMirror.mjs';
import {
  ensureDirAsync, getFileStatsAsync, readBinaryFromPathAsync, readDirectoryAsync, writeBinaryAsync,
} from '#system/utils/FileIO.mjs';

const systemIo = {
  stat: getFileStatsAsync,
  readFile: readBinaryFromPathAsync,
  writeFile: writeBinaryAsync,
  mkdir: (directory) => ensureDirAsync(directory),
  readdir: readDirectoryAsync,
};

export class FilesystemHealthArchiveMirror extends IHealthArchiveMirror {
  #io;
  constructor({ io = systemIo } = {}) { super(); this.#io = io; }
  async listFiles(sourceRoot) {
    const files = [];
    const walk = async (directory, prefix) => {
      for (const entry of await this.#io.readdir(directory, { withFileTypes: true })) {
        const relativeName = prefix ? path.join(prefix, entry.name) : entry.name;
        if (entry.isDirectory()) await walk(path.join(directory, entry.name), relativeName);
        else if (entry.isFile()) files.push(relativeName);
      }
    };
    await walk(sourceRoot, '');
    return files;
  }
  async needsCopy({ sourceRoot, destinationRoot, relativeName }) {
    const source = path.join(sourceRoot, relativeName);
    const destination = path.join(destinationRoot, relativeName);
    const sourceStat = await this.#io.stat(source);
    let destinationStat;
    try { destinationStat = await this.#io.stat(destination); }
    catch (error) { if (error?.code === 'ENOENT') return true; throw error; }
    const sourceMs = sourceStat.mtimeMs ?? sourceStat.mtime?.getTime?.() ?? 0;
    const destinationMs = destinationStat.mtimeMs ?? destinationStat.mtime?.getTime?.() ?? 0;
    if (destinationMs < sourceMs) return true;
    const [sourceBytes, destinationBytes] = await Promise.all([
      this.#io.readFile(source), this.#io.readFile(destination),
    ]);
    return digest(sourceBytes) !== digest(destinationBytes);
  }
  async copy({ sourceRoot, destinationRoot, relativeName }) {
    const source = path.join(sourceRoot, relativeName);
    const destination = path.join(destinationRoot, relativeName);
    const bytes = await this.#io.readFile(source);
    await this.#io.mkdir(path.dirname(destination), { recursive: true });
    await this.#io.writeFile(destination, bytes);
  }
}

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
