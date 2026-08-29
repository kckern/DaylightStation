import { InvalidInputError, PayloadTooLargeError } from '#apps/common/errors/SemanticErrors.mjs';

const MIME_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

export class AdminImageService {
  static MAX_FILE_SIZE = 5 * 1024 * 1024;
  static ALLOWED_MIME_TYPES = Object.freeze(Object.keys(MIME_EXTENSIONS));

  #store; #source; #createId; #logger;

  constructor({ store, source, createId, logger = console } = {}) {
    if (!store || typeof store.list !== 'function' || typeof store.save !== 'function') {
      throw new Error('AdminImageService requires store');
    }
    if (!source || typeof source.download !== 'function') throw new Error('AdminImageService requires source');
    if (typeof createId !== 'function') throw new Error('AdminImageService requires createId');
    this.#store = store;
    this.#source = source;
    this.#createId = createId;
    this.#logger = logger;
  }

  get maxFileSize() { return AdminImageService.MAX_FILE_SIZE; }
  get allowedMimeTypes() { return AdminImageService.ALLOWED_MIME_TYPES; }
  isAllowedMimeType(mimeType) { return Boolean(MIME_EXTENSIONS[mimeType]); }

  list() { return this.#store.list(); }

  upload({ buffer, mimeType, size = buffer?.length ?? 0 }) {
    if (!buffer) throw new InvalidInputError('No image file provided', { context: { field: 'image' } });
    if (!this.isAllowedMimeType(mimeType)) {
      throw new InvalidInputError('Invalid file type', { context: {
        field: 'image', allowed: this.allowedMimeTypes, received: mimeType,
      } });
    }
    const result = this.#store.save({
      id: this.#createId(), extension: MIME_EXTENSIONS[mimeType], buffer,
    });
    this.#logger.info?.('admin.images.uploaded', { ...result, size, type: mimeType });
    return { path: result.path, size, type: mimeType };
  }

  async uploadFromUrl(url) {
    if (!url) throw new InvalidInputError('No URL provided', { context: { field: 'url' } });
    const response = await this.#source.download(url);
    if (!response.ok) {
      const error = new InvalidInputError('Failed to fetch URL', {
        code: 'IMAGE_SOURCE_REJECTED', context: { url },
      });
      error.sourceResponseCode = response.status;
      throw error;
    }
    const contentType = response.contentType?.split(';')[0];
    if (!this.isAllowedMimeType(contentType)) {
      throw new InvalidInputError('URL does not point to an allowed image type', { context: {
        allowed: this.allowedMimeTypes, received: contentType,
      } });
    }
    if (response.buffer.length > this.maxFileSize) {
      throw new PayloadTooLargeError('Image too large', { limit: this.maxFileSize });
    }
    const result = this.upload({ buffer: response.buffer, mimeType: contentType });
    this.#logger.info?.('admin.images.uploaded_url', {
      filename: result.path.split('/').pop(), size: result.size,
      type: result.type, path: result.path, sourceUrl: url,
    });
    return result;
  }
}
