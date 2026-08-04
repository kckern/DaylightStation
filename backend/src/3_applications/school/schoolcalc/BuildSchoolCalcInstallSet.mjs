import { listCatalogInstallSets, validateLearningCatalog } from '#domains/school/catalog/index.mjs';
import { stableRecordDigest } from '#apps/common/stableRecord.mjs';

/** Compile every lesson in one authored delivery grouping for one device. */
export class BuildSchoolCalcInstallSet {
  #catalogs;
  #buildArtifact;

  constructor({ catalogs, buildArtifact } = {}) {
    if (!catalogs || !buildArtifact) {
      throw new Error('BuildSchoolCalcInstallSet requires catalogs and buildArtifact');
    }
    this.#catalogs = catalogs;
    this.#buildArtifact = buildArtifact;
  }

  async execute({ deviceId, catalogId, installSetId } = {}) {
    const raw = await this.#catalogs.getCatalog(catalogId);
    if (!raw) throw new Error(`SchoolCalc catalog '${catalogId}' was not found`);
    const validation = validateLearningCatalog(raw);
    if (validation.errors.length) {
      throw new Error(`SchoolCalc catalog '${catalogId}' is invalid: ${validation.errors.join('; ')}`);
    }
    if (validation.catalog.catalogId !== catalogId) {
      throw new Error(`SchoolCalc catalog '${catalogId}' declares catalogId '${validation.catalog.catalogId}'`);
    }
    const definition = listCatalogInstallSets(validation.catalog)
      .find((candidate) => candidate.installSetId === installSetId);
    if (!definition) {
      throw new Error(`SchoolCalc install set '${catalogId}/${installSetId}' was not found`);
    }

    const artifacts = [];
    for (const address of definition.lessonAddresses) {
      // Preserve authored ordering. Persisted artifacts are immutable, so an
      // interrupted later member may leave only harmless reusable artifacts.
      // eslint-disable-next-line no-await-in-loop
      artifacts.push(await this.#buildArtifact.execute({ deviceId, address }));
    }
    const artifactIds = artifacts.map(({ artifactId }) => artifactId);
    return {
      schema: 'school.calc.install-set/v1',
      catalogId,
      installSetId,
      title: definition.title,
      lessonAddresses: [...definition.lessonAddresses],
      artifactIds,
      versionId: `sha256:${stableRecordDigest({ catalogId, installSetId, artifactIds })}`,
      artifacts,
    };
  }
}

export default BuildSchoolCalcInstallSet;
