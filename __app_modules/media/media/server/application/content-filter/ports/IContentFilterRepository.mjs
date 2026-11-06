/**
 * Application-owned persistence port for the content-filter cascade.
 * Implementations own storage roots, paths, and serialization formats.
 */
export class IContentFilterRepository {
  async getEdl(_ratingKey) {
    throw new Error('IContentFilterRepository.getEdl not implemented');
  }

  /**
   * The shareable refined EDL for a VidAngel tag set (cues on VidAngel's clock), or null.
   * @param {{ workId: number|string, tagSetId: number|string }} _ref
   */
  async getRefinedEdl(_ref) {
    throw new Error('IContentFilterRepository.getRefinedEdl not implemented');
  }

  async getProfile(_profileName) {
    throw new Error('IContentFilterRepository.getProfile not implemented');
  }

  async getOverride(_ratingKey) {
    throw new Error('IContentFilterRepository.getOverride not implemented');
  }
}

export default IContentFilterRepository;
