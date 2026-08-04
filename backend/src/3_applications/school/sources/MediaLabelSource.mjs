import { gradeFromLabels } from '#domains/school/grades.mjs';

const SOURCE = 'media-label';
const CURATION_LABEL = 'school:on';

/** Label-curated School materials over a provider-neutral media catalog. */
export class MediaLabelSource {
  #mediaCatalog;
  #videoSource;
  #audioSource;

  constructor({ mediaCatalog, videoSource = null, audioSource = null } = {}) {
    if (!mediaCatalog) throw new Error('MediaLabelSource requires mediaCatalog');
    this.#mediaCatalog = mediaCatalog;
    this.#videoSource = videoSource;
    this.#audioSource = audioSource;
  }

  async listMaterials(libraryReference) {
    const items = await this.#mediaCatalog.listTagged(libraryReference, CURATION_LABEL);
    return items
      .filter((item) => item.labels?.some((label) => /^school:on$/i.test(label)))
      .map((item) => ({
        id: item.id,
        title: item.title,
        poster: item.poster ?? null,
        summary: item.summary ?? null,
        source: SOURCE,
        medium: item.medium,
        durationMs: null,
        unitCount: item.childCount ?? null,
        subject: subjectFromLabels(item.labels),
        minGrade: gradeFromLabels(item.labels),
      }));
  }

  async getMaterial(materialId) {
    const item = await this.#mediaCatalog.getItem(materialId);
    if (!item) throw new Error(`media-label: item '${materialId}' was not found`);
    const delegate = item.medium === 'audio' ? this.#audioSource : this.#videoSource;
    if (!delegate) throw new Error(`media-label: no ${item.medium} source can expand '${materialId}'`);
    return { ...await delegate.getMaterial(materialId), source: SOURCE };
  }
}

function subjectFromLabels(labels = []) {
  for (const label of labels) {
    const match = /^subject:(.+)$/i.exec(label);
    if (match) return match[1].toLowerCase();
  }
  return null;
}

export default MediaLabelSource;
