import { isContentMediaRepository } from '../ports/IContentMediaRepository.mjs';

/** Resolve singalong, readalong, and ambient playback through one use case. */
export class GetContentMediaResource {
  #repository;

  constructor({ repository }) {
    if (!isContentMediaRepository(repository)) {
      throw new Error('GetContentMediaResource requires repository');
    }
    this.#repository = repository;
  }

  async execute(request) {
    switch (request?.type) {
      case 'singalong':
        return this.#repository.findSingalong(request.collection, request.id);
      case 'readalong':
        return this.#repository.findReadalong(request.collection, request.itemPath);
      case 'ambient':
        return this.#repository.findAmbient(request.id);
      default:
        throw new Error(`Unsupported content media type: ${request?.type}`);
    }
  }
}

export default GetContentMediaResource;
