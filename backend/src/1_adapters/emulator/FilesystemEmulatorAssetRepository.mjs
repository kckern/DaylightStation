import path from 'node:path';
import { Readable } from 'node:stream';
import { getFileStats, readBinaryFromPath } from '#system/utils/FileIO.mjs';
import { IEmulatorAssetRepository } from '#apps/emulator/ports/IEmulatorAssetRepository.mjs';
import {
  assertSafeSegment,
  containedPath,
  contentTypeFor,
  fileResource,
  missing,
} from './emulatorFileSupport.mjs';

export const CORE_LOAD_CALL = 'await loadScript("emulator.min.js");';
const GUARD_MARKER = 'typeof window.EmulatorJS === "undefined"';

export function makeLoaderReentrant(source) {
  if (typeof source !== 'string') return source;
  if (source.includes(GUARD_MARKER) || !source.includes(CORE_LOAD_CALL)) return source;
  return source.replace(
    CORE_LOAD_CALL,
    `if (${GUARD_MARKER}) { ${CORE_LOAD_CALL} }`,
  );
}

function bufferedResource(buffer, mimeType) {
  return Object.freeze({
    size: buffer.length,
    mimeType,
    open(range) {
      const start = range?.start ?? 0;
      const end = range?.end ?? buffer.length - 1;
      return Readable.from(buffer.subarray(start, end + 1));
    },
  });
}

function findGame(config, system, gameId) {
  const game = (config?.games ?? []).find((candidate) =>
    candidate.id === gameId && candidate.system === system);
  if (!game) throw missing(`unknown game ${system}/${gameId}`);
  return game;
}

/** Filesystem adapter for EmulatorJS runtime assets, ROMs, and artwork. */
export class FilesystemEmulatorAssetRepository extends IEmulatorAssetRepository {
  #emulationDir;
  #engineDir;
  #loadCatalog;

  constructor({ emulationDir, engineDir = path.join(emulationDir || '', '_engine'), loadCatalog } = {}) {
    super();
    if (!emulationDir) throw new Error('FilesystemEmulatorAssetRepository requires emulationDir');
    if (typeof loadCatalog !== 'function') throw new Error('FilesystemEmulatorAssetRepository requires loadCatalog');
    this.#emulationDir = emulationDir;
    this.#engineDir = engineDir;
    this.#loadCatalog = loadCatalog;
  }

  getEngineResource(assetId) {
    const filePath = containedPath(this.#engineDir, assetId);
    if (path.basename(assetId) !== 'loader.js') return fileResource(filePath);

    // The loader is a small vendor bootstrap that needs one compatibility patch
    // before delivery; other engine assets remain streaming resources.
    getFileStats(filePath);
    const source = readBinaryFromPath(filePath).toString('utf8');
    const buffer = Buffer.from(makeLoaderReentrant(source), 'utf8');
    return bufferedResource(buffer, contentTypeFor(filePath));
  }

  getRomResource({ system, gameId }) {
    assertSafeSegment(system);
    assertSafeSegment(gameId);
    const game = findGame(this.#loadCatalog(), system, gameId);
    if (!game.rom) throw missing(`no rom for ${system}/${gameId}`);
    const systemDir = containedPath(this.#emulationDir, system);
    return fileResource(containedPath(systemDir, game.rom));
  }

  getArtResource({ system, gameId, kind }) {
    assertSafeSegment(system);
    assertSafeSegment(gameId);
    if (kind !== 'cover' && kind !== 'bezel') throw new Error('unsafe path segment');
    const game = findGame(this.#loadCatalog(), system, gameId);
    const relativePath = kind === 'cover' ? game.boxart : game.bezel;
    if (!relativePath) throw missing(`no ${kind} for ${system}/${gameId}`);
    const systemDir = containedPath(this.#emulationDir, system);
    return fileResource(containedPath(systemDir, relativePath));
  }
}

export default FilesystemEmulatorAssetRepository;
