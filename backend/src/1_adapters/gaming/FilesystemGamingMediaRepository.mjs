import path from 'node:path';
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
  constructor({ assetCatalog = null, partyMediaRoot = null } = {}) {
    super();
    this.assetCatalog = assetCatalog;
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
    if (!this.partyMediaRoot) return { kind: 'unavailable' };
    const filePath = path.resolve(this.partyMediaRoot, mediaId);
    if (!filePath.startsWith(`${this.partyMediaRoot}${path.sep}`)) return { kind: 'not_found' };
    const resource = fileResource(filePath);
    return resource ? { kind: 'found', value: { resource } } : { kind: 'not_found' };
  }
}

export default FilesystemGamingMediaRepository;
