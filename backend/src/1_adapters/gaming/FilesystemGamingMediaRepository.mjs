import crypto from 'node:crypto';
import path from 'node:path';
import { resolveRealPath, readBinaryFromPath, isFile } from '#system/utils/FileIO.mjs';
import { IGamingMediaRepository } from '#apps/gaming/ports/IGamingMediaRepository.mjs';
import { createLocalFileResource } from '#system/http/streamFile.mjs';

const MIME_TYPES = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json',
};

function fileResource(filePath, fallbackMime = 'application/octet-stream') {
  return createLocalFileResource(filePath, {
    mimeType: MIME_TYPES[path.extname(filePath).toLowerCase()] || fallbackMime,
  });
}

export class FilesystemGamingMediaRepository extends IGamingMediaRepository {
  constructor({ assetCatalog = null, partyMediaRoot = null, contentGamesDir = null, imageArchiveDir = null } = {}) {
    super();
    this.assetCatalog = assetCatalog;
    this.imageArchiveDir = imageArchiveDir ? path.resolve(imageArchiveDir) : null;
    this.contentGamesDir = contentGamesDir ? path.resolve(contentGamesDir) : null;
    this.partyMediaRoot = partyMediaRoot ? path.resolve(partyMediaRoot) : null;
  }

  getCatalog(packId) {
    return this.assetCatalog ? this.assetCatalog.get(packId) : undefined;
  }

  getAssetImage(packId, assetId) {
    if (!this.assetCatalog) return { kind: 'unavailable' };
    const asset = this.assetCatalog.getAsset(packId, assetId);
    if (!asset) return { kind: 'not_found' };
    const resource = fileResource(asset.file, 'image/png');
    return resource
      ? { kind: 'found', value: { resource, contentHash: asset.source_sha256 } }
      : { kind: 'not_found' };
  }

  getPartyMedia(mediaId) {
    const isContent = String(mediaId).startsWith('content/');
    const root = isContent ? this.contentGamesDir : this.partyMediaRoot;
    if (!root) return { kind: 'unavailable' };
    let relative = isContent ? mediaId.slice('content/'.length) : mediaId;
    let hash = null;
    if (isContent) {
      const match = relative.match(/^([a-f0-9]{64})\/(.+)$/);
      if (!match) return { kind: 'not_found' };
      [, hash, relative] = match;
      if (path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').includes('..')) return { kind: 'not_found' };
      const extension = path.extname(relative).toLowerCase();
      if (!['.svg', '.png', '.webp', '.jpg', '.jpeg'].includes(extension)) return { kind: 'not_found' };
      if (this.imageArchiveDir) {
        const archiveRoot = resolveRealPath(this.imageArchiveDir);
        const archived = resolveRealPath(path.join(this.imageArchiveDir, `${hash}${extension}`));
        if (archiveRoot && archived?.startsWith(`${archiveRoot}${path.sep}`) && isFile(archived)
          && crypto.createHash('sha256').update(readBinaryFromPath(archived)).digest('hex') === hash) {
          return { kind: 'found', value: { resource: fileResource(archived) } };
        }
      }
    }
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').includes('..')) return { kind: 'not_found' };
    const filePath = path.resolve(root, relative);
    const realRoot = resolveRealPath(root);
    const realFile = resolveRealPath(filePath);
    if (!realRoot || !realFile?.startsWith(`${realRoot}${path.sep}`) || !isFile(realFile)) return { kind: 'not_found' };
    if (hash && crypto.createHash('sha256').update(readBinaryFromPath(realFile)).digest('hex') !== hash) return { kind: 'not_found' };
    const resource = fileResource(realFile);
    return resource ? { kind: 'found', value: { resource } } : { kind: 'not_found' };
  }
}

export default FilesystemGamingMediaRepository;
