import path from 'node:path';
import { FilesystemEmulatorCheckpointRepository } from './FilesystemEmulatorCheckpointRepository.mjs';
import { assertLegacySaveWritable, withEmulatorSaveLock } from './emulatorSaveLock.mjs';
import {
  fileExists,
  getStats,
  listDirs,
  readDirectory,
  removeFileAsync,
  writeBinaryAtomic,
} from '#system/utils/FileIO.mjs';
import { IEmulatorSaveRepository } from "../application/ports/IEmulatorSaveRepository.mjs";
import { assertSafeSegment, containedPath, fileResource } from "./emulatorFileSupport.mjs";

/** Filesystem adapter for per-user battery saves and emulator states. */
export class FilesystemEmulatorSaveRepository extends IEmulatorSaveRepository {
  #emulationDir;
  #checkpoints;

  constructor({ emulationDir } = {}) {
    super();
    if (!emulationDir) throw new Error('FilesystemEmulatorSaveRepository requires emulationDir');
    this.#emulationDir = emulationDir;
    this.#checkpoints = new FilesystemEmulatorCheckpointRepository({ emulationDir });
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

  getSaveResource(key) { return this.#checkpoints.getArtifactResource(key, 'battery') ?? fileResource(this.#savePath(key)); }
  async storeSaveArtifact(key, artifact) {
    const target = this.#savePath(key);
    const bytes = await this.#materialize(artifact);
    return withEmulatorSaveLock(this.#emulationDir, key, () => {
      assertLegacySaveWritable(this.#emulationDir, key);
      writeBinaryAtomic(target, bytes);
    });
  }
  async deleteSave(key) {
    const target = this.#savePath(key);
    return withEmulatorSaveLock(this.#emulationDir, key, () => {
      assertLegacySaveWritable(this.#emulationDir, key);
      return removeFileAsync(target, { force: true });
    });
  }
  getStateResource(key) {
    if (key.slot === 'auto') {
      const checkpoint = this.#checkpoints.getArtifactResource(key, 'snapshot');
      if (checkpoint) return checkpoint;
    }
    return fileResource(this.#statePath(key));
  }
  async storeStateArtifact(key, artifact) {
    const target = this.#statePath(key);
    const bytes = await this.#materialize(artifact);
    return withEmulatorSaveLock(this.#emulationDir, key, () => {
      assertLegacySaveWritable(this.#emulationDir, key);
      writeBinaryAtomic(target, bytes);
    });
  }
  async deleteState(key) {
    const target = this.#statePath(key);
    return withEmulatorSaveLock(this.#emulationDir, key, () => {
      assertLegacySaveWritable(this.#emulationDir, key);
      return removeFileAsync(target, { force: true });
    });
  }

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

    const checkpointUsers = containedPath(this.#emulationDir, path.join('_checkpoints', system));
    for (const user of listDirs(checkpointUsers)) {
      const gameDir = containedPath(checkpointUsers, path.join(user, gameId));
      if (fileExists(path.join(gameDir, 'head.json'))) users.add(user);
      else {
        try { if (readDirectory(path.join(gameDir, 'revisions')).length > 0) users.add(user); }
        catch (err) { if (err.code !== 'ENOENT') throw err; }
      }
    }
    return [...users].sort();
  }
}

export default FilesystemEmulatorSaveRepository;
