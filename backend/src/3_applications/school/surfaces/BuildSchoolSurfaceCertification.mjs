import { GetSurfaceCertification } from './GetSurfaceCertification.mjs';
import { SurfaceRegistry } from './SurfaceRegistry.mjs';

const inert = (reason) => Object.freeze({ wired: false, reason, registry: null, certification: null });

/** Application assembly policy for validated surface profiles and fresh certification queries. */
export class BuildSchoolSurfaceCertification {
  constructor({ logger = console } = {}) { this.logger = logger; }

  async execute({ schoolCatalog, profileRepository, ports, baselines = [] } = {}) {
    if (!schoolCatalog?.wired || !schoolCatalog.catalogs || !schoolCatalog.content
      || !schoolCatalog.lessonBundles || !schoolCatalog.moduleRegistry) {
      return inert('School Catalog is not wired');
    }
    try {
      const entries = await profileRepository.listProfiles();
      entries.filter((entry) => !entry.profile).forEach((entry) => {
        this.logger.warn?.('school.surfaces.profile-invalid', { file: entry.file, errors: entry.errors });
      });
      const registry = new SurfaceRegistry({ profiles: entries, ports, baselines });
      const banks = { getBank: (bankId) => schoolCatalog.content.getQuestionBank(bankId) };
      const build = () => new GetSurfaceCertification({
        buildLesson: schoolCatalog.lessonBundles,
        catalogs: schoolCatalog.catalogs,
        banks,
        registry,
      });
      return Object.freeze({
        wired: true,
        reason: null,
        registry,
        certification: Object.freeze({
          lesson: (address) => build().lesson(address),
          bank: (bankId) => build().bank(bankId),
        }),
      });
    } catch (error) {
      this.logger.error?.('school.surfaces.wiring-failed', { error: error.message });
      return inert(error.message);
    }
  }
}
