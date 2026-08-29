import path from 'path';
import crypto from 'crypto';
import { IAudioAssetResolver } from '../../3_applications/livestream/ports/IAudioAssetResolver.mjs';
import {
  createReadStream, deleteFileStrict, ensureDir, fileExists, getFileStats,
  readDirectory, resolveRealPath, writeBinary,
} from '#system/utils/FileIO.mjs';

/**
 * TTSAssetResolver — resolves semantic audio specs to opaque resources.
 */
export class TTSAssetResolver extends IAudioAssetResolver {
  #ttsAdapter;
  #cacheDir;
  #logger;
  #fileAssetRoot;
  #cache = new Map();
  #pinned = new Set();

  constructor({ ttsAdapter, cacheDir, fileAssetRoot = cacheDir, logger = console }) {
    super();
    this.#ttsAdapter = ttsAdapter;
    this.#cacheDir = cacheDir;
    this.#fileAssetRoot = path.resolve(fileAssetRoot);
    this.#logger = logger;
    ensureDir(cacheDir);
  }

  async resolve(spec) {
    if (spec.type === 'file') return this.#resolveFile(spec.assetId);
    if (spec.type === 'tts') return this.#resolveTTS(spec);
    throw new Error(`Unknown audio spec type: ${spec.type}`);
  }

  #resource(filePath) {
    const stat = getFileStats(filePath);
    return Object.freeze({
      size: stat.size,
      mimeType: 'audio/mpeg',
      open(options) { return createReadStream(filePath, options); },
    });
  }

  #resolveFile(assetId) {
    if (typeof assetId !== 'string' || !assetId) throw new TypeError('Audio file assetId is required');
    const candidate = path.resolve(this.#fileAssetRoot, assetId);
    const realRoot = resolveRealPath(this.#fileAssetRoot) || this.#fileAssetRoot;
    const realFile = resolveRealPath(candidate);
    if (!realFile || (realFile !== realRoot && !realFile.startsWith(`${realRoot}${path.sep}`))) {
      throw new Error(`Unknown audio asset: ${assetId}`);
    }
    return { assetId, duration: null, resource: this.#resource(realFile) };
  }

  pin(text, voice = 'default') {
    this.#pinned.add(this.#hash(text, voice));
  }

  cleanup(ttlMs) {
    const now = Date.now();
    const files = readDirectory(this.#cacheDir);
    for (const file of files) {
      const filePath = path.join(this.#cacheDir, file);
      const stat = getFileStats(filePath);
      const age = now - stat.mtimeMs;
      const hashFromName = path.basename(file, path.extname(file));
      if (this.#pinned.has(hashFromName)) continue;
      if (age > ttlMs) {
        deleteFileStrict(filePath);
        this.#cache.delete(hashFromName);
        this.#logger.debug?.('livestream.tts.cache.evict', { file, ageHours: Math.round(age / 3600000) });
      }
    }
  }

  async #resolveTTS(spec) {
    const hash = this.#hash(spec.text, spec.voice || 'default');
    if (this.#cache.has(hash)) {
      const cached = this.#cache.get(hash);
      if (fileExists(cached)) {
        this.#logger.debug?.('livestream.tts.cache.hit', { hash });
        return { assetId: `tts:${hash}`, duration: null, resource: this.#resource(cached) };
      }
      this.#cache.delete(hash);
    }

    this.#logger.info?.('livestream.tts.generate', { textLength: spec.text.length, voice: spec.voice });
    const buffer = await this.#ttsAdapter.generateSpeechBuffer(spec.text, {
      voice: spec.voice, model: spec.model, responseFormat: 'mp3',
    });

    const filePath = path.join(this.#cacheDir, `${hash}.mp3`);
    writeBinary(filePath, buffer);
    this.#cache.set(hash, filePath);
    this.#logger.info?.('livestream.tts.cached', { hash, path: filePath, bytes: buffer.length });
    return { assetId: `tts:${hash}`, duration: null, resource: this.#resource(filePath) };
  }

  #hash(text, voice) {
    return crypto.createHash('sha256').update(`${voice}:${text}`).digest('hex').slice(0, 16);
  }
}

export default TTSAssetResolver;
