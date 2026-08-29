import { IStaticImageRepository } from './ports/IStaticImageRepository.mjs';

export class StaticAssetService {
  #repository;
  #resizeImage;
  #logger;

  constructor({ repository, resizeImage, logger = console }) {
    if (!(repository instanceof IStaticImageRepository)) throw new TypeError('StaticAssetService requires IStaticImageRepository');
    if (typeof resizeImage !== 'function') throw new TypeError('StaticAssetService requires resizeImage');
    this.#repository = repository;
    this.#resizeImage = resizeImage;
    this.#logger = logger;
  }

  async getImage({ kind, id, width = null, height = null }) {
    const image = await this.#repository.getImage(kind, id);
    if (!image) return null;
    if (kind !== 'image' || (!width && !height) || !['image/png', 'image/jpeg'].includes(image.contentType)) {
      return image;
    }
    try {
      return await this.#resizeImage(image, { width, height });
    } catch (error) {
      this.#logger.warn?.('static.img.resize_failed', {
        image: image.identity,
        error: error.message,
      });
      return image;
    }
  }
}
