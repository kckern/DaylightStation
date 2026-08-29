import path from 'node:path';
import {
  createReadStream,
  fileExists,
  getFileStats,
  readBinaryFromPathAsync,
} from '#system/utils/FileIO.mjs';
import { IProxyMediaRepository } from '#apps/proxy/ports/IProxyMediaRepository.mjs';

const LOCAL_MIME_TYPES = Object.freeze({
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.mkv': 'video/x-matroska',
});
const MEDIA_MIME_TYPES = Object.freeze({
  mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', wav: 'audio/wav',
  ogg: 'audio/ogg', flac: 'audio/flac', webm: 'video/webm', gif: 'image/gif',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  avif: 'image/avif',
});
const EXTENSION_FALLBACKS = ['mp3', 'm4a', 'mp4', 'wav', 'ogg', 'flac'];

function resource(filePath, mimeType, stat = getFileStats(filePath)) {
  return Object.freeze({
    size: stat.size,
    mimeType,
    open(options) { return createReadStream(filePath, options); },
  });
}

/** Extract MusicXML text from a compressed score archive. */
export async function extractMusicXmlFromMxl(buffer) {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(buffer);
  const container = zip.getEntry('META-INF/container.xml');
  if (container) {
    const xml = container.getData().toString('utf-8');
    const match = xml.match(/<rootfile\b[^>]*\bfull-path\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    const rootPath = match && (match[1] || match[2]);
    if (rootPath) {
      const entry = zip.getEntry(rootPath);
      if (entry) return entry.getData().toString('utf-8');
    }
  }
  const entry = zip.getEntries().find((candidate) =>
    !candidate.entryName.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(candidate.entryName));
  if (entry) return entry.getData().toString('utf-8');
  throw new Error('No MusicXML entry found in .mxl archive');
}

/** Filesystem/content-registry implementation for proxy media resources. */
export class FilesystemProxyMediaRepository extends IProxyMediaRepository {
  #registry;
  #mediaBasePath;
  #logger;

  constructor({ registry, mediaBasePath = null, logger = console } = {}) {
    super();
    if (!registry || typeof registry.get !== 'function') {
      throw new Error('FilesystemProxyMediaRepository requires registry');
    }
    this.#registry = registry;
    this.#mediaBasePath = mediaBasePath;
    this.#logger = logger;
  }

  async findContentMedia(mediaRef) {
    const adapter = this.#registry.get('files') || this.#registry.get('media');
    if (!adapter) return { kind: 'unconfigured' };
    const item = await adapter.getItem(mediaRef);
    const filePath = item?.metadata?.filePath;
    if (!filePath) return { kind: 'not_found' };

    if (/\.mxl$/i.test(filePath)) {
      try {
        return {
          kind: 'document',
          body: await extractMusicXmlFromMxl(await readBinaryFromPathAsync(filePath)),
        };
      } catch (error) {
        this.#logger.warn?.('proxy.mxl.extract_failed', { filePath, error: error.message });
        return { kind: 'archive_error' };
      }
    }
    return {
      kind: 'found',
      resource: resource(filePath, item.metadata.mimeType || 'application/octet-stream'),
    };
  }

  async findLocalContentMedia(type, mediaRef) {
    const adapter = this.#registry.get('local-content');
    if (!adapter) return { kind: 'unconfigured' };
    const item = await adapter.getItem(`${type}:${mediaRef}`);
    if (!item?.metadata?.mediaFile) return { kind: 'not_found' };
    const filePath = path.join(adapter.mediaPath, item.metadata.mediaFile);
    if (!fileExists(filePath)) return { kind: 'disk_missing', path: filePath };
    const mimeType = LOCAL_MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    return { kind: 'found', resource: resource(filePath, mimeType) };
  }

  async findMediaTreeResource(mediaRef) {
    if (!this.#mediaBasePath) return { kind: 'unconfigured' };
    const safePath = path.normalize(mediaRef).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(this.#mediaBasePath, safePath);
    if (!fullPath.startsWith(path.resolve(this.#mediaBasePath))) return { kind: 'forbidden' };

    let resolvedPath = fullPath;
    if (!fileExists(resolvedPath)) {
      for (const extension of EXTENSION_FALLBACKS) {
        const candidate = `${fullPath}.${extension}`;
        if (fileExists(candidate)) {
          resolvedPath = candidate;
          break;
        }
      }
    }
    if (!fileExists(resolvedPath)) return { kind: 'not_found' };
    const stat = getFileStats(resolvedPath);
    if (!stat.isFile()) return { kind: 'not_file' };
    const extension = path.extname(resolvedPath).toLowerCase().slice(1);
    return {
      kind: 'found',
      resource: resource(resolvedPath, MEDIA_MIME_TYPES[extension] || 'application/octet-stream', stat),
    };
  }
}

export default FilesystemProxyMediaRepository;
