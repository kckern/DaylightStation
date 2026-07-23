/**
 * PlexLabelSource — a label-native School source. Where `plex-album`/`plex-show`
 * walk a fixed Plex root's children, this source lists every item in a Plex
 * section that carries the `school:on` curation label, reading each material's
 * SHELF (`subject:<x>`) and LEVEL (`grade:<x>`) from its own labels. Curation
 * and levelling live in Plex metadata, editable with the same CLI, and read
 * live — no config edit or restart to re-shelve or re-level a course.
 *
 * The injected `plexClient.listLabeled(sectionId)` seam returns Plex item
 * metadata objects (each with a `Label` array of `{tag}`) for the section's
 * `school:on` items; how that is queried against Plex (section-by-label,
 * per-type) is the app.mjs wiring's concern, not this source's.
 *
 * Output materials carry `subject` and `minGrade` fields the catalog use-case
 * consumes: `subject` shelves the tile, `minGrade` feeds the household grade
 * ceiling (`2_domains/school/grades.mjs`). Category is NOT decided here — the
 * catalog stamps it (fail-closed to `reference`), same as the other sources.
 */
import { gradeFromLabels } from '#domains/school/grades.mjs';

const SOURCE = 'plex-label';

function tags(item) {
  return (item?.Label ?? []).map((l) => String(l.tag));
}

function hasSchoolOn(labelTags) {
  return labelTags.some((t) => /^school:on$/i.test(t));
}

function subjectFromLabels(labelTags) {
  for (const t of labelTags) {
    const m = /^subject:(.+)$/i.exec(t);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

export class PlexLabelSource {
  #plexClient;
  #logger;

  constructor({ plexClient, logger = console }) {
    this.#plexClient = plexClient;
    this.#logger = logger;
  }

  /**
   * @param {string} sectionId - Plex library section id to scan for school:on items
   * @returns {Promise<Array>} materials carrying {id,title,poster,source,medium,durationMs,unitCount,subject,minGrade}
   */
  async listMaterials(sectionId) {
    const items = await this.#plexClient.listLabeled(sectionId);
    const materials = [];
    for (const item of items ?? []) {
      const labelTags = tags(item);
      if (!hasSchoolOn(labelTags)) continue;
      materials.push({
        id: `plex:${item.ratingKey}`,
        title: item.title,
        poster: item.thumb ?? null,
        source: SOURCE,
        medium: item.type === 'album' ? 'audio' : 'video',
        durationMs: null,
        unitCount: item.leafCount ?? null,
        subject: subjectFromLabels(labelTags),
        minGrade: gradeFromLabels(labelTags),
      });
    }
    return materials;
  }
}

export default PlexLabelSource;
