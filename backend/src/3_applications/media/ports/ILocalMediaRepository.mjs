/**
 * Application-owned port for resolving browseable local media.
 *
 * Implementations return opaque resources; callers never receive storage
 * paths, descriptors, or other filesystem-specific values.
 */
export class ILocalMediaRepository {
  async getMediaResource(_mediaId) {
    throw new Error('ILocalMediaRepository.getMediaResource not implemented');
  }

  async getThumbnailResource(_mediaId) {
    throw new Error('ILocalMediaRepository.getThumbnailResource not implemented');
  }
}

export function isLocalMediaRepository(candidate) {
  return candidate
    && typeof candidate.getMediaResource === 'function'
    && typeof candidate.getThumbnailResource === 'function';
}

export default ILocalMediaRepository;
