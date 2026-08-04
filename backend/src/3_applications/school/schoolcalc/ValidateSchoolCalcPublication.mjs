import { listCatalogLessons, validateLearningCatalog } from '#domains/school/catalog/index.mjs';

const REPORT_SCHEMA = 'school.calc.publication-report/v1';

/**
 * Eagerly validate every published SchoolCalc lesson and all of its referenced
 * content. This is the promotion gate: runtime projections may assume that a
 * mounted catalog has already passed this use case.
 *
 * The use case knows only School concepts and repository/bundle ports. YAML,
 * mount paths, calculator families, and command-line exit codes stay outside.
 */
export class ValidateSchoolCalcPublication {
  #catalogs;
  #bundles;

  constructor({ catalogs, bundles } = {}) {
    if (!catalogs || !bundles) {
      throw new Error('ValidateSchoolCalcPublication requires catalogs and bundles');
    }
    this.#catalogs = catalogs;
    this.#bundles = bundles;
  }

  async execute() {
    const catalogErrors = {};
    const lessonErrors = {};
    const capabilities = new Set();
    const summary = {
      catalogs: 0,
      validCatalogs: 0,
      installSets: 0,
      lessons: 0,
      validLessons: 0,
      modules: 0,
      resolvedModules: 0,
    };

    let listed;
    try {
      listed = await this.#catalogs.listCatalogs();
    } catch (error) {
      addError(catalogErrors, '$catalogs', `catalog discovery failed: ${messageOf(error)}`);
      return finish({ catalogErrors, lessonErrors, capabilities, summary });
    }

    if (!Array.isArray(listed)) {
      addError(catalogErrors, '$catalogs', 'catalog repository must return an array');
      return finish({ catalogErrors, lessonErrors, capabilities, summary });
    }

    summary.catalogs = listed.length;
    if (listed.length === 0) {
      addError(catalogErrors, '$catalogs', 'no catalogs were published');
      return finish({ catalogErrors, lessonErrors, capabilities, summary });
    }
    const ordered = listed
      .map((entry, index) => ({ entry, index }))
      .sort((left, right) => summaryKey(left).localeCompare(summaryKey(right)));
    const seenCatalogIds = new Set();

    for (const { entry, index } of ordered) {
      const fallbackKey = `$catalogs[${index}]`;
      const catalogId = entry?.catalogId;
      if (typeof catalogId !== 'string' || catalogId.trim().length === 0) {
        addError(catalogErrors, fallbackKey, 'catalog summary has no catalogId');
        continue;
      }
      if (seenCatalogIds.has(catalogId)) {
        addError(catalogErrors, catalogId, `duplicate catalog summary '${catalogId}'`);
        continue;
      }
      seenCatalogIds.add(catalogId);

      let raw;
      try {
        // Sequential reads keep the report deterministic for repositories that
        // span several configured mounts.
        // eslint-disable-next-line no-await-in-loop
        raw = await this.#catalogs.getCatalog(catalogId);
      } catch (error) {
        addError(catalogErrors, catalogId, `catalog load failed: ${messageOf(error)}`);
        continue;
      }
      if (!raw) {
        addError(catalogErrors, catalogId, `catalog '${catalogId}' was listed but could not be loaded`);
        continue;
      }

      const validation = validateLearningCatalog(raw);
      if (validation.errors.length) {
        validation.errors.forEach((error) => addError(catalogErrors, catalogId, error));
        continue;
      }
      if (validation.catalog.catalogId !== catalogId) {
        addError(
          catalogErrors,
          catalogId,
          `catalog '${catalogId}' declares catalogId '${validation.catalog.catalogId}'`,
        );
        continue;
      }

      summary.validCatalogs += 1;
      summary.installSets += validation.catalog.installSets?.length ?? 0;
      const lessons = listCatalogLessons(validation.catalog);
      summary.lessons += lessons.length;
      summary.modules += lessons.reduce((count, lesson) => count + lesson.lesson.modules.length, 0);

      for (const lesson of lessons) {
        try {
          // Bundle resolution performs the authoritative cross-reference and
          // registered tool/custom-module validation used by every codec.
          // eslint-disable-next-line no-await-in-loop
          const bundle = await this.#bundles.execute(lesson.context);
          summary.validLessons += 1;
          summary.resolvedModules += bundle.lesson.modules.length;
          bundle.capabilities.forEach((capability) => capabilities.add(capability));
        } catch (error) {
          addError(lessonErrors, lesson.address, messageOf(error));
        }
      }
    }

    return finish({ catalogErrors, lessonErrors, capabilities, summary });
  }
}

function summaryKey({ entry, index }) {
  return typeof entry?.catalogId === 'string'
    ? `0:${entry.catalogId}:${String(index).padStart(10, '0')}`
    : `1:${String(index).padStart(10, '0')}`;
}

function addError(target, key, error) {
  (target[key] ??= []).push(error);
}

function messageOf(error) {
  return error?.message ?? String(error);
}

function finish({ catalogErrors, lessonErrors, capabilities, summary }) {
  return {
    schema: REPORT_SCHEMA,
    ok: Object.keys(catalogErrors).length === 0 && Object.keys(lessonErrors).length === 0,
    catalogErrors,
    lessonErrors,
    capabilities: [...capabilities].sort(),
    summary,
  };
}

export default ValidateSchoolCalcPublication;
