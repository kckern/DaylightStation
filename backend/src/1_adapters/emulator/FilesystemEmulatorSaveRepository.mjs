import path from 'node:path';
import {
  fileExists,
  getStats,
  listDirs,
  readDirectory,
  removeFileAsync,
  writeBinaryAtomic,
} from '#system/utils/FileIO.mjs';
import { IEmulatorSaveRepository } from '#apps/emulator/ports/IEmulatorSaveRepository.mjs';
import { assertSafeSegment, containedPath, fileResource } from './emulatorFileSupport.mjs';

/** Filesystem adapter for per-user battery saves and emulator states. */
export class FilesystemEmulatorSaveRepository extends IEmulatorSaveRepository {
  #emulationDir;

  constructor({ emulationDir } = {}) {
    super();
    if (!emulationDir) throw new Error('FilesystemEmulatorSaveRepository requires emulationDir');
    this.#emulationDir = emulationDir;
  }

  #savePath({ system, gameId, user }) {
    assertSafeSegment(system);
    assertSafeSegment(gameId);
    assertSafeSegment(user);
    return containedPath(
      containedPath(this.#emulationDir, system),
      path.join('saves', user, `${gameId}.srm`),
    );
  }

  #statePath({ system, gameId, slot, user }) {
    assertSafeSegment(system);
    assertSafeSegment(gameId);
    assertSafeSegment(slot, { dot: true });
    assertSafeSegment(user);
    return containedPath(
      containedPath(this.#emulationDir, system),
      path.join('states', user, gameId, `${slot}.state`),
    );
  }

  getSaveResource(key) { return fileResource(this.#savePath(key)); }
  async storeSaveArtifact(key, artifact) { writeBinaryAtomic(this.#savePath(key), await this.#materialize(artifact)); }
  async deleteSave(key) { await removeFileAsync(this.#savePath(key), { force: true }); }
  getStateResource(key) { return fileResource(this.#statePath(key)); }
  async storeStateArtifact(key, artifact) { writeBinaryAtomic(this.#statePath(key), await this.#materialize(artifact)); }
  async deleteState(key) { await removeFileAsync(this.#statePath(key), { force: true }); }

  async #materialize(artifact) {
    if (!artifact || typeof artifact.chunks !== 'function') {
      throw new TypeError('Emulator save artifact must expose chunks()');
    }
    const chunks = [];
    for await (const chunk of artifact.chunks()) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  listUsers(system, gameId) {
    assertSafeSegment(system);
    assertSafeSegment(gameId);
    const systemDir = containedPath(this.#emulationDir, system);
    const users = new Set();

    const savesRoot = containedPath(systemDir, 'saves');
    for (const user of listDirs(savesRoot)) {
      if (fileExists(containedPath(savesRoot, path.join(user, `${gameId}.srm`)))) users.add(user);
    }

    const statesRoot = containedPath(systemDir, 'states');
    for (const user of listDirs(statesRoot)) {
      const gameDir = containedPath(statesRoot, path.join(user, gameId));
      try {
        if (getStats(gameDir)?.isDirectory() && readDirectory(gameDir).length > 0) users.add(user);
      } catch { /* absent or unreadable, matching the prior scan behavior */ }
    }

    return [...users].sort();
  }
}

export default FilesystemEmulatorSaveRepository;
