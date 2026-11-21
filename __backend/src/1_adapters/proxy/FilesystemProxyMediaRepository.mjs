import path from 'node:path';
import {
  createReadStream,
  fileExists,
  getFileStats,
  readBinaryFromPathAsync,
} from '#system/utils/FileIO.mjs';
import { IProxyMediaRepository } from "../../../../__capabilities/content-catalog/server/application/proxy/ports/IProxyMediaRepository.mjs";
import { extractMusicXmlFromMxl } from "../../../../__capabilities/music-notation/server/mxlArchive.mjs";

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
    // Lets the HTTP layer emit a validator, so a file replaced in place under
    // the same name is re-fetched instead of served from a stale browser cache.
    mtimeMs: stat.mtimeMs,
    mimeType,
    open(options) { return createReadStream(filePath, options); },
  });
}

/** Filesystem/content-registry implementation for proxy media resources. */
export class FilesystemProxyMediaRepository extends IProxyMediaRepository {
  #registry;
  #mediaBasePath;
  #logger;
  #providerAccess;
  #audioStreams;

  constructor({ registry, mediaBasePath = null, logger = console, providerAccess = () => {}, audioStreams = null } = {}) {
    super();
    if (!registry || typeof registry.get !== 'function') {
      throw new Error('FilesystemProxyMediaRepository requires registry');
    }
    this.#registry = registry;
    this.#mediaBasePath = mediaBasePath;
    this.#logger = logger;
    this.#providerAccess = providerAccess;
    this.#audioStreams = audioStreams;
  }

  async findContentMedia(mediaRef, { stream } = {}) {
    const adapter = this.#registry.get('files') || this.#registry.get('media');
    if (!adapter) return { kind: 'unconfigured' };
    const item = await adapter.getItem(mediaRef);
    const filePath = item?.metadata?.filePath;
    if (!filePath) return { kind: 'not_found' };
    if (stream === 'audio') {
      const source = await adapter.audioSource?.(item);
      if (!source || !this.#audioStreams) return { kind: 'unsupported_audio' };
      return { kind: 'audio_stream', open: signal => this.#audioStreams.file(source, signal) };
    }

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

  async findProviderAudio(source, mediaRef, signal) {
    const adapter = this.#registry.get(source);
    if (!adapter?.openAudioSource || !this.#audioStreams) return { kind: 'unsupported_audio' };
    await this.#providerAccess(source);
    const input = await adapter.openAudioSource(mediaRef, signal);
    if (!input) return { kind: 'unsupported_audio' };
    return { kind: 'audio_stream', open: signal => this.#audioStreams.provider(input, signal) };
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
