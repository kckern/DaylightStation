import { isLocalMediaRepository } from '../ports/ILocalMediaRepository.mjs';

/** Resolve or generate one local-media thumbnail resource. */
export class GetLocalMediaThumbnail {
  #repository;

  constructor({ repository }) {
    if (!isLocalMediaRepository(repository)) {
      throw new Error('GetLocalMediaThumbnail requires repository');
    }
    this.#repository = repository;
  }

  async execute(mediaId) {
    return this.#repository.getThumbnailResource(mediaId);
  }
}

export default GetLocalMediaThumbnail;
