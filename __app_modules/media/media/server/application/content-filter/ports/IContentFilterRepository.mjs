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

  /** Write a refined EDL back (scenes, card drafts). */
  async saveRefinedEdl(_ref, _edl) {
    throw new Error('IContentFilterRepository.saveRefinedEdl not implemented');
  }

  /** The refine transcript for one media part: { segments: [{ s, e, text }] }, or null. */
  async getTranscript(_ratingKey, _part) {
    throw new Error('IContentFilterRepository.getTranscript not implemented');
  }

  async getProfile(_profileName) {
    throw new Error('IContentFilterRepository.getProfile not implemented');
  }

  /** Write a household profile back (settings rewrites). */
  async saveProfile(_profileName, _profile) {
    throw new Error('IContentFilterRepository.saveProfile not implemented');
  }

  /** Write a film's base (VidAngel) EDL (a pipeline export). */
  async saveEdl(_ratingKey, _edl) { throw new Error('IContentFilterRepository.saveEdl not implemented'); }
  /** The refine review list (`review/<rk>.refine.yml`), or null. */
  async getRefineReview(_ratingKey) { throw new Error('IContentFilterRepository.getRefineReview not implemented'); }
  async saveRefineReview(_ratingKey, _review) { throw new Error('IContentFilterRepository.saveRefineReview not implemented'); }
  /** Every refine transcript file for a film, raw: { [part]: object }. */
  async listTranscriptFiles(_ratingKey) { throw new Error('IContentFilterRepository.listTranscriptFiles not implemented'); }
  async saveTranscriptFile(_ratingKey, _part, _words) { throw new Error('IContentFilterRepository.saveTranscriptFile not implemented'); }

  /** The Plex -> VidAngel match index: { map: { 'plex:<rk>': { title, vidangel: { id, slug, tagCount }, confidence } } }, or null. */
  async getMatchIndex() {
    throw new Error('IContentFilterRepository.getMatchIndex not implemented');
  }

  /** When the match index file was last written (ISO string), or null. */
  async getMatchIndexWrittenAt() { return null; }

  async getOverride(_ratingKey) {
    throw new Error('IContentFilterRepository.getOverride not implemented');
  }

  /** Rating keys of every title with an override. */
  async listOverrides() {
    throw new Error('IContentFilterRepository.listOverrides not implemented');
  }

  /** Write a title's override (the household's rulings). */
  async saveOverride(_ratingKey, _override) {
    throw new Error('IContentFilterRepository.saveOverride not implemented');
  }

  /** Append one review verdict/undo to a film's append-only history. */
  async appendReviewHistory(_ratingKey, _entry) {
    throw new Error('IContentFilterRepository.appendReviewHistory not implemented');
  }

  /** The newest `limit` history entries for a film, oldest first. */
  async readReviewHistory(_ratingKey, _opts) {
    throw new Error('IContentFilterRepository.readReviewHistory not implemented');
  }
}

export default IContentFilterRepository;
