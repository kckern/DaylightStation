import { ICanvasImageRepository } from '../ports/ICanvasImageRepository.mjs';

export class GetCanvasImage {
  #repository;

  constructor({ repository }) {
    if (!(repository instanceof ICanvasImageRepository)) {
      throw new TypeError('GetCanvasImage requires ICanvasImageRepository');
    }
    this.#repository = repository;
  }

  execute(imageId) {
    return this.#repository.getImageResource(imageId);
  }
}
