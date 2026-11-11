/**
 * YamlHolidayActivityStore — the date-bound activity units the teacher
 * console writes for enrichment and major-holiday breaks.
 *
 * Shelf: `<contentRoot>/<subject>/holiday-activities/units/<unitId>.yml`. An
 * enrichment activity sits on the shelf of the subject it replaces; a
 * major-holiday activity on scripture's. A rewrite keeps every field it does
 * not own (a written activity's bank, a courseId) and first saves the old
 * text as `<unitId>.yml.bak-<stamp>` beside it, which the catalog does not
 * read. When the subject changes, the old file is RENAMED to that backup name
 * (never deleted) so one id never sits on two shelves.
 */
import path from 'path';
import { isDeepStrictEqual } from 'node:util';
import jsyaml from 'js-yaml';
import { readTextFromPath, writeFileAtomic, fileExists, renameFile } from '#system/utils/FileIO.mjs';
import { SUBJECT_IDS, isPlaceholderUnit } from "../../domain/curriculum/unitValidation.mjs";

const SHELF = 'holiday-activities';
const UNIT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const stampOf = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

export class YamlHolidayActivityStore {
  #contentRoot; #clock;

  constructor({ contentRoot, clock = () => new Date() } = {}) {
    if (!contentRoot) throw new Error('YamlHolidayActivityStore requires contentRoot');
    this.#contentRoot = contentRoot;
    this.#clock = clock;
  }

  #fileFor(subject, unitId) {
    return path.join(this.#contentRoot, subject, SHELF, 'units', `${unitId}.yml`);
  }

  /** @returns {{unitId, subject, file, raw: object}|null} */
  read(unitId) {
    if (!UNIT_ID.test(unitId ?? '')) return null;
    for (const subject of SUBJECT_IDS) {
      const file = this.#fileFor(subject, unitId);
      if (!fileExists(file)) continue;
      // js-yaml, as the curriculum loader reads it.
      const raw = jsyaml.load(readTextFromPath(file)) ?? {};
      return { unitId, subject, file, raw };
    }
    return null;
  }

  /**
   * Build the unit document a write would produce (pure; for validation).
   * @param {{unitId: string, subject: string, title: string, description?: string|null, onDays: Array}} activity
   */
  compose({ unitId, subject, title, description = null, onDays }) {
    const existing = this.read(unitId)?.raw ?? null;
    const base = existing ?? {
      schema: 'school.unit/v1', unitId,
      provenance: { source: 'Household holiday activity', reviewState: 'approved' },
    };
    const next = { ...base, unitId, title, subject, onDays };
    const instructions = typeof description === 'string' ? description.trim() : '';
    if (instructions) next.description = instructions; else delete next.description;
    // Placeholder = no instructions (`isPlaceholderUnit`, the validator's own
    // rule): written instructions make the activity a real assignment that
    // counts toward the day.
    if (isPlaceholderUnit(next)) next.placeholder = true; else delete next.placeholder;
    return next;
  }

  /** Write the composed unit; returns the file written. */
  write(unit) {
    if (!UNIT_ID.test(unit?.unitId ?? '')) throw new Error(`unsafe unitId: ${unit?.unitId}`);
    if (!SUBJECT_IDS.includes(unit.subject)) throw new Error(`unknown subject: ${unit.subject}`);
    const stamp = stampOf(this.#clock().toISOString());
    const current = this.read(unit.unitId);
    const target = this.#fileFor(unit.subject, unit.unitId);
    if (current && current.file !== target) {
      renameFile(current.file, `${current.file}.bak-${stamp}`);
    } else if (current) {
      writeFileAtomic(`${current.file}.bak-${stamp}`, readTextFromPath(current.file));
    }
    // js-yaml's dump quotes date-like strings, so `onDays` never reads back as a
    // YAML 1.1 timestamp the unit validator would refuse.
    const text = jsyaml.dump(unit, { lineWidth: -1, noRefs: true });
    if (!isDeepStrictEqual(jsyaml.load(text), unit)) throw new Error(`unit ${unit.unitId} would not read back as written`);
    writeFileAtomic(target, text);
    return target;
  }
}

export default YamlHolidayActivityStore;
