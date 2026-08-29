import path from 'node:path';
import { IFreshVideoMediaStore } from '#apps/media/ports/IFreshVideoMediaStore.mjs';
import {
  closeFileDescriptor,
  deleteFile,
  ensureDir,
  fileExists,
  getStats,
  listEntries,
  openFileExclusive,
  loadYamlSafe,
  saveYaml,
  writeToFileDescriptor,
} from '#system/utils/FileIO.mjs';

export class FilesystemFreshVideoMediaStore extends IFreshVideoMediaStore {
  constructor({ mediaRoot, logger = console }) {
    super();
    if (!mediaRoot) throw new Error('FilesystemFreshVideoMediaStore requires mediaRoot');
    this.mediaRoot = mediaRoot;
    this.logger = logger;
    ensureDir(mediaRoot);
  }

  acquireRunLock(ownerId, staleMs, timestamp) {
    const lockPath = path.join(this.mediaRoot, 'freshvideo.lock');
    try {
      if (fileExists(lockPath)) {
        const ageMs = Date.now() - getStats(lockPath).mtimeMs;
        if (ageMs > staleMs) {
          this.logger.warn?.('freshvideo.staleLock', { ageMins: Math.round(ageMs / 60000) });
          deleteFile(lockPath);
        }
      }
      const descriptor = openFileExclusive(lockPath);
      try {
        writeToFileDescriptor(descriptor, JSON.stringify({ pid: ownerId, ts: timestamp }));
      } finally {
        closeFileDescriptor(descriptor);
      }
      return () => { try { deleteFile(lockPath); } catch { /* best-effort release */ } };
    } catch {
      return null;
    }
  }

  ensureProvider(provider) {
    const directory = path.join(this.mediaRoot, provider);
    ensureDir(directory);
  }

  loadProviderMetadata(provider) {
    return loadYamlSafe(path.join(this.mediaRoot, provider, 'metadata'));
  }

  saveProviderMetadata(provider, metadata) {
    saveYaml(path.join(this.mediaRoot, provider, 'metadata'), metadata);
  }

  findDatedVideo(provider, date) {
    const candidate = path.join(this.mediaRoot, provider, `${date}.mp4`);
    return fileExists(candidate) ? Object.freeze({ provider, name: `${date}.mp4` }) : null;
  }

  cleanupOlderThan(cutoff) {
    const deleted = [];
    for (const folder of listEntries(this.mediaRoot)) {
      const directory = path.join(this.mediaRoot, folder);
      if (!getStats(directory)?.isDirectory()) continue;
      for (const name of listEntries(directory)) {
        if (name.split('.')[0] >= cutoff) continue;
        const target = path.join(directory, name);
        try {
          deleteFile(target);
          deleted.push(Object.freeze({ provider: folder, name }));
          this.logger.info?.('freshvideo.deletedOld', { path: target });
        } catch (error) {
          this.logger.warn?.('freshvideo.deleteError', { path: target, error: error.message });
        }
      }
    }
    return deleted;
  }

  cleanupInvalid(provider = null) {
    const directory = provider ? path.join(this.mediaRoot, provider) : this.mediaRoot;
    if (!fileExists(directory)) return 0;
    let count = 0;
    for (const name of listEntries(directory)) {
      const target = path.join(directory, name);
      if (getStats(target)?.isFile() && !/^\d{8}\.mp4$/.test(name)) {
        try {
          deleteFile(target);
          count += 1;
          this.logger.debug?.('freshvideo.removedInvalid', { path: target });
        } catch { /* cleanup is best effort */ }
      }
    }
    return count;
  }

  listVideosSince(cutoff) {
    const videos = [];
    for (const folder of listEntries(this.mediaRoot)) {
      const directory = path.join(this.mediaRoot, folder);
      if (!getStats(directory)?.isDirectory()) continue;
      for (const name of listEntries(directory)) {
        if (name.endsWith('.mp4') && name.split('.')[0] >= cutoff) {
          videos.push(Object.freeze({ provider: folder, name }));
        }
      }
    }
    return videos;
  }

  /** Restore the historical scheduler result shape at the infrastructure edge. */
  presentRunResult(result) {
    const legacyPath = (resource) => resource
      ? path.join(this.mediaRoot, resource.provider, resource.name)
      : null;
    return {
      ...result,
      deleted: (result.deleted || []).map(legacyPath),
      files: (result.files || []).map(legacyPath),
      results: (result.results || []).map(({ resource, ...entry }) => ({
        ...entry,
        ...(resource ? { filePath: legacyPath(resource) } : {}),
      })),
    };
  }
}

export default FilesystemFreshVideoMediaStore;
