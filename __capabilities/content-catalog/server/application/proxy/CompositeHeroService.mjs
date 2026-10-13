/** Cache/source/render orchestration for composite hero imagery. */
export class CompositeHeroService {
  #cache;
  #source;
  #render;

  constructor({ cache, source, render } = {}) {
    if (!cache || typeof cache.findComposite !== 'function' || typeof cache.storeComposite !== 'function') {
      throw new Error('CompositeHeroService requires cache');
    }
    if (!source || typeof source.loadImages !== 'function') {
      throw new Error('CompositeHeroService requires source');
    }
    if (typeof render !== 'function') throw new Error('CompositeHeroService requires render');
    this.#cache = cache;
    this.#source = source;
    this.#render = render;
  }

  async get({ id, page }) {
    const pageNumber = Number.parseInt(page, 10);
    if (!id || Number.isNaN(pageNumber) || pageNumber < 1 || !/^[\w-]+$/.test(id)) {
      return { kind: 'invalid' };
    }

    const compositeId = { bookId: id, page: pageNumber };
    const cached = await this.#cache.findComposite(compositeId);
    if (cached) return { kind: 'hit', resource: cached };

    const images = await this.#source.loadImages(id, pageNumber);
    if (images.kind === 'unconfigured') return images;
    if (images.buffers.length === 0) return { kind: 'placeholder' };

    const artifact = await this.#render(images.buffers);
    await this.#cache.storeComposite(compositeId, artifact);
    return { kind: 'miss', artifact };
  }
}

export default CompositeHeroService;
