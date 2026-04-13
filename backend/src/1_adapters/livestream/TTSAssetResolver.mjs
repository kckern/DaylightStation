import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { IAudioAssetResolver } from '../../2_domains/livestream/IAudioAssetResolver.mjs';

/**
 * TTSAssetResolver — resolves audio specs to playable file paths.
 * File specs pass through. TTS specs are generated via TTSAdapter and cached.
 */
export class TTSAssetResolver extends IAudioAssetResolver {
  #ttsAdapter;
  #cacheDir;
  #logger;
  #cache = new Map();
  #pinned = new Set();

  constructor({ ttsAdapter, cacheDir, logger = console }) {
    super();
    this.#ttsAdapter = ttsAdapter;
    this.#cacheDir = cacheDir;
    this.#logger = logger;
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  async resolve(spec) {
    if (spec.type === 'file') return { path: spec.path, duration: null };
    if (spec.type === 'tts') return this.#resolveTTS(spec);
    throw new Error(`Unknown audio spec type: ${spec.type}`);
  }

  pin(text, voice = 'default') {
    this.#pinned.add(this.#hash(text, voice));
  }

  cleanup(ttlMs) {
    const now = Date.now();
    const files = fs.readdirSync(this.#cacheDir);
    for (const file of files) {
      const filePath = path.join(this.#cacheDir, file);
      const stat = fs.statSync(filePath);
      const age = now - stat.mtimeMs;
      const hashFromName = path.basename(file, path.extname(file));
      if (this.#pinned.has(hashFromName)) continue;
      if (age > ttlMs) {
        fs.unlinkSync(filePath);
        this.#cache.delete(hashFromName);
        this.#logger.debug?.('livestream.tts.cache.evict', { file, ageHours: Math.round(age / 3600000) });
      }
    }
  }

  async #resolveTTS(spec) {
    const hash = this.#hash(spec.text, spec.voice || 'default');
    if (this.#cache.has(hash)) {
      const cached = this.#cache.get(hash);
      if (fs.existsSync(cached)) {
        this.#logger.debug?.('livestream.tts.cache.hit', { hash });
        return { path: cached, duration: null };
      }
      this.#cache.delete(hash);
    }

    this.#logger.info?.('livestream.tts.generate', { textLength: spec.text.length, voice: spec.voice });
    const buffer = await this.#ttsAdapter.generateSpeechBuffer(spec.text, {
      voice: spec.voice, model: spec.model, responseFormat: 'mp3',
    });

    const filePath = path.join(this.#cacheDir, `${hash}.mp3`);
    fs.writeFileSync(filePath, buffer);
    this.#cache.set(hash, filePath);
    this.#logger.info?.('livestream.tts.cached', { hash, path: filePath, bytes: buffer.length });
    return { path: filePath, duration: null };
  }

  #hash(text, voice) {
    return crypto.createHash('sha256').update(`${voice}:${text}`).digest('hex').slice(0, 16);
  }
}

export default TTSAssetResolver;
