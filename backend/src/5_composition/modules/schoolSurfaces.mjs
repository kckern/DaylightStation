/**
 * Surface certification composition root (spec §7.1/§9). Wires the static
 * profile repository, the per-family certification ports, and the TI-86
 * codec baseline into a `SurfaceRegistry`, then exposes a `certification`
 * facade the HTTP router can call per-request.
 *
 * Mirrors `cli/school.mjs certify`'s `buildRegistry` — same profile
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
 *
 * Note (spec §7.3/§13): this facade always certifies on-demand — it never
 * reads the publication-time certification manifest
 * (`certificationManifest.mjs`'s `readManifest`, which has no production
 * consumer in v1). Runtime manifest consumption is explicitly deferred past
 * v1; per-request certification is cheap at household corpus scale.
 */
import { YamlSurfaceProfileRepository } from '#adapters/school/catalog/index.mjs';
import { PaperCertification } from '#adapters/school/paper/PaperCertification.mjs';
import { ScreenCertification } from '#adapters/school/screen/ScreenCertification.mjs';
import { Ti86SchoolCalcCodec } from '#adapters/schoolcalc/ti86/index.mjs';
import {
  Ti86SurfaceCertification, ti86CodecBaselineProfile,
} from '#adapters/schoolcalc/ti86/Ti86SurfaceCertification.mjs';
import { BuildSchoolSurfaceCertification } from '#apps/school/surfaces/BuildSchoolSurfaceCertification.mjs';

/**
 * @param {object} deps
 * @param {object} deps.schoolCatalog - The `createSchoolCatalog` composition
 *   result (needs `wired`, `catalogs`, `content`, `lessonBundles`,
 *   `moduleRegistry`).
 * @param {string} deps.dataDir - `configService.getDataDir()`; roots the
 *   household surface-profile directory (see `surfacesDirectory` below).
 * @param {object} [deps.logger]
 * @returns {Promise<{wired: boolean, reason: string|null, registry: object|null, certification: object|null}>}
 */
export async function createSchoolSurfaces({ schoolCatalog, dataDir, logger = null } = {}) {
  const profileRepository = new YamlSurfaceProfileRepository({
    dataDir,
    capabilitySource: schoolCatalog?.moduleRegistry,
  });
  return new BuildSchoolSurfaceCertification({ logger }).execute({
    schoolCatalog,
    profileRepository,
    ports: {
      schoolcalc: new Ti86SurfaceCertification({ codec: new Ti86SchoolCalcCodec() }),
      paper: new PaperCertification(),
      screen: new ScreenCertification(),
    },
    baselines: [{ profile: ti86CodecBaselineProfile(), baseline: 'codec' }],
  });
}

export default createSchoolSurfaces;
