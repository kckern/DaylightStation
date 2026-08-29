import path from 'node:path';
import {
  createReadStream,
  fileExists,
  findMediaFileByPrefix,
  getFileStats,
  loadContainedYaml,
  resolveRealPath,
} from '#system/utils/FileIO.mjs';
import { IContentMediaRepository } from '#apps/media/ports/IContentMediaRepository.mjs';

const MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function mediaResource(filePath) {
  const stat = getFileStats(filePath);
  const extension = path.extname(filePath).toLowerCase();
  return Object.freeze({
    size: stat.size,
    mimeType: MIME_TYPES[extension] || 'application/octet-stream',
    open(options) {
      return createReadStream(filePath, options);
    },
  });
}

function isWithin(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function foundResource(filePath, rootPath) {
  if (!filePath || !fileExists(filePath)) return { kind: 'not_found' };
  const realRoot = resolveRealPath(rootPath) || path.resolve(rootPath);
  const realFile = resolveRealPath(filePath);
  if (!realFile || !isWithin(realRoot, realFile)) return { kind: 'forbidden' };
  const stats = getFileStats(realFile);
  if (!stats.isFile()) return { kind: 'not_found' };
  return { kind: 'found', resource: mediaResource(realFile) };
}

/** Filesystem lookup adapter for singalong, readalong, and ambient media. */
export class FilesystemContentMediaRepository extends IContentMediaRepository {
  #singalongMediaPath;
  #singalongDataPath;
  #readalongAudioPath;
  #readalongVideoPath;

  constructor({
    singalongMediaPath,
    singalongDataPath,
    readalongAudioPath,
    readalongVideoPath,
  } = {}) {
    super();
    if (!singalongMediaPath) throw new Error('FilesystemContentMediaRepository requires singalongMediaPath');
    if (!readalongAudioPath) throw new Error('FilesystemContentMediaRepository requires readalongAudioPath');
    if (!readalongVideoPath) throw new Error('FilesystemContentMediaRepository requires readalongVideoPath');

    this.#singalongMediaPath = singalongMediaPath;
    this.#singalongDataPath = singalongDataPath;
    this.#readalongAudioPath = readalongAudioPath;
    this.#readalongVideoPath = readalongVideoPath;
  }

  async findSingalong(collection, id) {
    const collectionMediaDir = path.join(this.#singalongMediaPath, collection);
    let manifest = null;
    if (this.#singalongDataPath) {
      manifest = loadContainedYaml(path.resolve(this.#singalongDataPath, collection), 'manifest');
    }
    const subdirs = manifest?.mediaPreference?.subdirs;
    const searchDirs = Array.isArray(subdirs) && subdirs.length > 0
      ? subdirs.map((subdir) => subdir ? path.join(collectionMediaDir, subdir) : collectionMediaDir)
        .filter((searchDir) => isWithin(collectionMediaDir, searchDir))
      : [collectionMediaDir];

    for (const searchDir of searchDirs) {
      const result = foundResource(findMediaFileByPrefix(searchDir, id), collectionMediaDir);
      if (result.kind === 'found') return result;
    }
    return { kind: 'not_found' };
  }

  async findReadalong(collection, rawItemPath) {
    const itemPath = path.normalize(rawItemPath).replace(/^(\.\.(\/|\\|$))+/, '');
    if (!itemPath || itemPath === '.') return { kind: 'invalid_path' };

    const readalongBasePath = collection === 'talks'
      ? this.#readalongVideoPath
      : this.#readalongAudioPath;
    const searchDir = path.join(readalongBasePath, collection);
    const pathParts = itemPath.split('/');
    const fileName = pathParts.pop();
    const subDir = pathParts.join('/');
    const fullSearchDir = subDir ? path.join(searchDir, subDir) : searchDir;

    if (!isWithin(readalongBasePath, fullSearchDir)) {
      return { kind: 'forbidden' };
    }

    return foundResource(findMediaFileByPrefix(fullSearchDir, fileName), readalongBasePath);
  }

  async findAmbient(id) {
    const ambientDir = path.join(this.#readalongAudioPath, '..', 'ambient');
    return foundResource(findMediaFileByPrefix(ambientDir, id), ambientDir);
  }
}

export default FilesystemContentMediaRepository;
