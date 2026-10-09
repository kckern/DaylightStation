/** Cache-first remote thumbnail workflow with one delayed retry. */
export class RemoteThumbnailService {
  #cache;
  #source;
  #delay;
  #retryDelayMs;
  #logger;

  constructor({ cache, source, delay, retryDelayMs = 1500, logger = console } = {}) {
    if (!cache || typeof cache.findThumbnail !== 'function' || typeof cache.storeThumbnail !== 'function') {
      throw new Error('RemoteThumbnailService requires cache');
    }
    if (!source || typeof source.fetchThumbnail !== 'function') {
      throw new Error('RemoteThumbnailService requires source');
    }
    if (typeof delay !== 'function') throw new Error('RemoteThumbnailService requires delay');
    this.#cache = cache;
    this.#source = source;
    this.#delay = delay;
    this.#retryDelayMs = retryDelayMs;
    this.#logger = logger;
  }

  async get(thumbnailId) {
    if (!thumbnailId) return { kind: 'missing_path' };
    if (thumbnailId.includes('..')) return { kind: 'forbidden' };

    const cached = await this.#cache.findThumbnail(thumbnailId);
    if (cached) return { kind: 'hit', resource: cached };

    let result;
    try {
      result = await this.#source.fetchThumbnail(thumbnailId);
    } catch (firstError) {
      this.#logger.warn?.('proxy.retroarch.thumbnail.retry', {
        path: thumbnailId,
        error: firstError.message,
      });
      try {
        await this.#delay(this.#retryDelayMs);
        result = await this.#source.fetchThumbnail(thumbnailId);
      } catch (secondError) {
        this.#logger.warn?.('proxy.retroarch.thumbnail.failed', {
          path: thumbnailId,
          error: secondError.message,
        });
        return { kind: 'unavailable' };
      }
    }

    try {
      await this.#cache.storeThumbnail(thumbnailId, result.artifact);
    } catch (error) {
      this.#logger.warn?.('proxy.retroarch.thumbnail.cacheWrite', {
        path: thumbnailId,
        error: error.message,
      });
    }
    return { kind: 'miss', ...result };
  }
}

export default RemoteThumbnailService;
