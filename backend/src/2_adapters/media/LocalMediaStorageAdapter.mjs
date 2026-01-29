/**
 * LocalMediaStorageAdapter - Local filesystem implementation of IMediaStorageRepository
 *
 * @module adapters/media/LocalMediaStorageAdapter
 */

import fs from 'fs';
import path from 'path';
import { nowTs24 } from '#system/utils/index.mjs';

export class LocalMediaStorageAdapter {
  #logger;
  #basePath;

  constructor({ basePath, logger } = {}) {
    this.#basePath = basePath || '';
    this.#logger = logger || console;
  }

  async ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  async exists(filePath) {
    return fs.existsSync(filePath);
  }

  async listSubdirectories(dirPath) {
    if (!fs.existsSync(dirPath)) return [];
    const entries = fs.readdirSync(dirPath);
    const dirs = [];
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      try {
        if (fs.statSync(fullPath).isDirectory()) dirs.push(entry);
      } catch (_) {}
    }
    return dirs;
  }

  async listFiles(dirPath, options = {}) {
    if (!fs.existsSync(dirPath)) return [];
    const { extension, pattern } = options;
    const entries = fs.readdirSync(dirPath);
    const files = [];
    for (const name of entries) {
      const fullPath = path.join(dirPath, name);
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue;
        if (extension && !name.endsWith(extension)) continue;
        if (pattern && !pattern.test(name)) continue;
        const datePrefix = name.split('.')[0];
        files.push({ path: fullPath, name, datePrefix, mtimeMs: stat.mtimeMs });
      } catch (_) {}
    }
    return files;
  }

  async deleteFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) return false;
      fs.unlinkSync(filePath);
      return true;
    } catch (e) {
      this.#logger.warn?.('storage.deleteError', { path: filePath, error: e.message });
      return false;
    }
  }

  async acquireLock(lockName, options = {}) {
    const { staleMs = 60 * 60 * 1000 } = options;
    const lockPath = path.join(this.#basePath, `${lockName}.lock`);
    try {
      if (fs.existsSync(lockPath)) {
        const stat = fs.statSync(lockPath);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs > staleMs) {
          this.#logger.warn?.('storage.staleLock', { lockName, ageMins: Math.round(ageMs / 60000) });
          fs.unlinkSync(lockPath);
        }
      }
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, ts: nowTs24() }));
      fs.closeSync(fd);
      return {
        acquired: true,
        release: () => { try { fs.unlinkSync(lockPath); } catch (_) {} }
      };
    } catch (e) {
      return { acquired: false };
    }
  }

  async stat(filePath) {
    try {
      const stat = fs.statSync(filePath);
      return { mtimeMs: stat.mtimeMs, isDirectory: stat.isDirectory(), isFile: stat.isFile() };
    } catch (_) {
      return null;
    }
  }

  joinPath(...segments) {
    return path.join(...segments);
  }
}

export default LocalMediaStorageAdapter;
