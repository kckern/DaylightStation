/**
 * Load the three-part content-filter cascade for one title.
 *
 * The repository owns storage layout and serialization. A missing EDL means
 * there is no filter for the title, so optional policy is not loaded.
 */
export class GetContentFilter {
  /** @type {import('../ports/IContentFilterRepository.mjs').IContentFilterRepository} */
  #repository;

  constructor({ contentFilterRepository } = {}) {
    if (!contentFilterRepository) {
      throw new Error('GetContentFilter requires contentFilterRepository');
    }
    this.#repository = contentFilterRepository;
  }

  async execute({ ratingKey, profileName }) {
    const edl = await this.#repository.getEdl(ratingKey);
    if (!edl) return { edl: null, profile: null, override: null };

    const [profile, override] = await Promise.all([
      this.#repository.getProfile(profileName),
      this.#repository.getOverride(ratingKey),
    ]);
    return { edl, profile, override };
  }
}

export default GetContentFilter;
