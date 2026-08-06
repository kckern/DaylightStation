import path from 'node:path';
import { loadYaml } from '#system/utils/FileIO.mjs';

const CONCEPT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Household concept label registry — `data/content/school/concepts.yml`
 * (`{concepts: [{id, label, parent?}]}`, kebab ids). Backs Task 10's
 * report-card `concepts` facet: `conceptMastery` (domain, pure) counts every
 * concept id graded evidence names, whether or not it is registered here;
 * this adapter only supplies the friendly LABEL for ids that are.
 *
 * Load-once at construction, same idiom as `ConfiguredAcademicPeriodSource`:
 * the file is small, hand-authored, household-scoped content — re-reading it
 * per lookup buys nothing a process restart doesn't already give a config
 * edit. A registry file that is simply ABSENT (the feature is opt-in) is not
 * an error — `list()`/`has()`/`get()` degrade to empty rather than throwing,
 * so a report card with no registry wired still renders, just without
 * concept labels. A registry file that EXISTS but is malformed (bad id
 * shape, missing label, duplicate id) fails loud at construction — that is
 * authored content, not runtime data, and a typo there deserves to be
 * caught at boot, not silently dropped into a blank label.
 */
export class YamlConceptRegistry {
  #concepts;

  constructor({ dataDir, filePath } = {}) {
    if (!isNonEmptyString(dataDir) && !isNonEmptyString(filePath)) {
      throw new Error('YamlConceptRegistry requires dataDir or filePath');
    }
    const resolvedPath = isNonEmptyString(filePath)
      ? filePath
      : path.join(dataDir, 'content', 'school', 'concepts');
    const raw = loadYaml(resolvedPath);
    this.#concepts = raw === null ? new Map() : parseRegistry(raw);
  }

  get(id) { return this.#concepts.get(id) ?? null; }

  has(id) { return this.#concepts.has(id); }

  list() { return [...this.#concepts.values()]; }
}

function parseRegistry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.concepts)) {
    throw new Error('School concept registry must be a mapping with a `concepts` array');
  }
  const concepts = new Map();
  raw.concepts.forEach((entry, index) => {
    const at = `concepts[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`School concept registry ${at}: must be a mapping`);
    }
    if (!CONCEPT_ID.test(entry.id ?? '')) {
      throw new Error(`School concept registry ${at}.id: must be a lowercase kebab identifier`);
    }
    if (concepts.has(entry.id)) {
      throw new Error(`School concept registry ${at}: duplicate concept id '${entry.id}'`);
    }
    if (!isNonEmptyString(entry.label)) {
      throw new Error(`School concept registry ${at}.label: is required`);
    }
    if (entry.parent !== undefined && !isNonEmptyString(entry.parent)) {
      throw new Error(`School concept registry ${at}.parent: must be non-empty text when present`);
    }
    concepts.set(entry.id, Object.freeze({
      id: entry.id, label: entry.label, ...(entry.parent ? { parent: entry.parent } : {}),
    }));
  });
  return concepts;
}

export default YamlConceptRegistry;
