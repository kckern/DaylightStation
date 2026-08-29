/**
 * Application-owned persistence port for the content-filter cascade.
 * Implementations own storage roots, paths, and serialization formats.
 */
export class IContentFilterRepository {
  async getEdl(_ratingKey) {
    throw new Error('IContentFilterRepository.getEdl not implemented');
  }

  async getProfile(_profileName) {
    throw new Error('IContentFilterRepository.getProfile not implemented');
  }

  async getOverride(_ratingKey) {
    throw new Error('IContentFilterRepository.getOverride not implemented');
  }
}

export default IContentFilterRepository;
