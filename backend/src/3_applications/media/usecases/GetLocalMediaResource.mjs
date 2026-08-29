import { isLocalMediaRepository } from '../ports/ILocalMediaRepository.mjs';

/** Resolve one local-media playback resource without exposing its storage. */
export class GetLocalMediaResource {
  #repository;

  constructor({ repository }) {
    if (!isLocalMediaRepository(repository)) {
      throw new Error('GetLocalMediaResource requires repository');
    }
    this.#repository = repository;
  }

  async execute(mediaId) {
    return this.#repository.getMediaResource(mediaId);
  }
}

export default GetLocalMediaResource;
