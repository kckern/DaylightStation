/**
 * Surface certification composition root (spec §7.1/§9). Wires the static
 * profile repository, the per-family certification ports, and the TI-86
 * codec baseline into a `SurfaceRegistry`, then exposes a `certification`
 * facade the HTTP router can call per-request.
 *
 * Mirrors `cli/school-certify.cli.mjs`'s `buildRegistry` — same profile
 * repository, same ports, same baseline — so a lesson certifies identically
 * whether queried from the CLI or from `/api/v1/school/certification`.
 *
 * `GetSurfaceCertification`'s bundle cache is documented as instance-
 * lifetime, not self-invalidating (see its class doc). A long-lived router
 * dependency would therefore serve stale certification after a content edit
 * until process restart. `certification.lesson`/`certification.bank` here
 * construct a fresh `GetSurfaceCertification` per call instead of holding
 * one across requests, trading its cross-call bundle-cache memoization for
 * always-fresh content — the documented safe pattern for a long-lived
 * caller that cannot reliably call `invalidate()` on every content change.
 */
import path from 'node:path';
import { YamlSurfaceProfileRepository } from '#adapters/school/catalog/index.mjs';
import { PaperCertification } from '#adapters/school/paper/PaperCertification.mjs';
import { ScreenCertification } from '#adapters/school/screen/ScreenCertification.mjs';
import { Ti86SchoolCalcCodec } from '#adapters/schoolcalc/ti86/index.mjs';
import {
  Ti86SurfaceCertification, ti86CodecBaselineProfile,
} from '#adapters/schoolcalc/ti86/Ti86SurfaceCertification.mjs';
import { GetSurfaceCertification } from '#apps/school/surfaces/GetSurfaceCertification.mjs';
import { SurfaceRegistry } from '#apps/school/surfaces/SurfaceRegistry.mjs';

/**
 * @param {object} deps
 * @param {object} deps.schoolCatalog - The `createSchoolCatalog` composition
 *   result (needs `wired`, `catalogs`, `content`, `lessonBundles`,
 *   `moduleRegistry`, `diagnostics.contentRoot`).
 * @param {object} [deps.logger]
 * @returns {Promise<{wired: boolean, reason: string|null, registry: object|null, certification: object|null}>}
 */
export async function createSchoolSurfaces({ schoolCatalog, logger = null } = {}) {
  if (!schoolCatalog?.wired || !schoolCatalog.catalogs || !schoolCatalog.content
      || !schoolCatalog.lessonBundles || !schoolCatalog.moduleRegistry) {
    return inert('School Catalog is not wired');
  }
  try {
    const { contentRoot } = schoolCatalog.diagnostics;
    const surfacesDirectory = path.join(contentRoot, 'surfaces');
    const profileRepository = new YamlSurfaceProfileRepository({
      directory: surfacesDirectory,
      customCapabilities: schoolCatalog.moduleRegistry.list().map((definition) => definition.capability),
    });
    const entries = await profileRepository.listProfiles();
    entries.filter((entry) => !entry.profile).forEach((entry) => {
      logger?.warn?.('school.surfaces.profile-invalid', { file: entry.file, errors: entry.errors });
    });

    const registry = new SurfaceRegistry({
      profiles: entries,
      ports: {
        schoolcalc: new Ti86SurfaceCertification({ codec: new Ti86SchoolCalcCodec() }),
        paper: new PaperCertification(),
        screen: new ScreenCertification(),
      },
      baselines: [{ profile: ti86CodecBaselineProfile(), baseline: 'codec' }],
    });

    const { catalogs, lessonBundles, content } = schoolCatalog;
    const banks = { getBank: (bankId) => content.getQuestionBank(bankId) };
    // A fresh instance per call — see file doc: avoids stale-bundle
    // memoization across the process lifetime of an HTTP router dependency.
    const buildCertification = () => new GetSurfaceCertification({
      buildLesson: lessonBundles, catalogs, banks, registry,
    });
    const certification = {
      lesson: (address) => buildCertification().lesson(address),
      bank: (bankId) => buildCertification().bank(bankId),
    };

    return Object.freeze({
      wired: true, reason: null, registry, certification,
    });
  } catch (error) {
    logger?.error?.('school.surfaces.wiring-failed', { error: error.message });
    return inert(error.message);
  }
}

function inert(reason) {
  return Object.freeze({
    wired: false, reason, registry: null, certification: null,
  });
}

export default createSchoolSurfaces;
