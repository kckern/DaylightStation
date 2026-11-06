/**
 * Load the three-part content-filter cascade for one title.
 *
 * The repository owns storage layout and serialization. A missing EDL means
 * there is no filter for the title, so optional policy is not loaded. When the
 * title's VidAngel tag set has a refined EDL, that one is served instead.
 */
import { readiness } from '../readiness.mjs';

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
    const raw = await this.#repository.getEdl(ratingKey);
    if (!raw) return { edl: null, profile: null, override: null };
    // A refined EDL for the same VidAngel tag set replaces the raw one: every cue
    // on VidAngel's clock, refined ones at ms/frame precision. The override's
    // sync maps it onto this household's copy.
    const ref = raw.sourceRef;
    const refined = ref?.workId != null && ref?.tagSetId != null
      ? await this.#repository.getRefinedEdl({ workId: ref.workId, tagSetId: ref.tagSetId })
      : null;
    const edl = refined || raw;

    const [profile, override] = await Promise.all([
      this.#repository.getProfile(profileName),
      this.#repository.getOverride(ratingKey),
    ]);
    return { edl, profile, override, certification: readiness(edl, profile) };
  }
}

export default GetContentFilter;
