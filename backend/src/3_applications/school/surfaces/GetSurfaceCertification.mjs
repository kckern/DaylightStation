import { createHash } from 'node:crypto';
import { findCatalogLesson } from '#domains/school/catalog/index.mjs';
import { capabilityReasons, moduleVerdict, rollUpLesson } from '#domains/school/surfaces/index.mjs';

const BANK_NOT_DELIVERABLE_REASON = 'standalone banks are not deliverable to calculators in v1';

/** Recursively sort object keys so structurally-equal values digest identically. */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((sorted, key) => {
      sorted[key] = sortKeys(value[key]);
      return sorted;
    }, {});
  }
  return value;
}

/** sha256 hex of a value's canonical (sorted-key) JSON form. */
function digest(value) {
  return createHash('sha256').update(JSON.stringify(sortKeys(value))).digest('hex');
}

function parseAddress(address) {
  const [catalogId, subjectId, courseId, unitId, lessonId] = String(address).split('/');
  return { catalogId, subjectId, courseId, unitId, lessonId };
}

function uniqueList(values) {
  return [...new Set(values)];
}

/**
 * Application-layer projection producing the certification matrix (spec §8):
 * one row per registered surface profile plus one per injected codec
 * baseline, for either a catalog lesson address or a standalone bank.
 *
 * Declared lesson-level `requiredCapabilities` (spec §3.3 item 2) are folded
 * in *after* the port certifies, because ports only see module-derived
 * demands — the authored requirement is lesson-wide, not tied to any one
 * module's shape. This never mutates the bundle a port certified against
 * (Task 11's manifest digests hash it as returned by `BuildLearningLesson`).
 *
 * Caching: the built bundle is memoized per address (repeated `lesson()`
 * calls for the same address do not re-invoke `buildLesson.execute`), and
 * the certified row itself is memoized per `(contentDigest, profileDigest)`
 * pair — a new bundle (changed content -> changed digest) always
 * re-certifies. Both caches are process-lifetime, in-memory only.
 */
export class GetSurfaceCertification {
  #buildLesson;
  #catalogs;
  #banks;
  #registry;
  #bundleCache = new Map();
  #rowCache = new Map();

  constructor({ buildLesson, catalogs, banks, registry } = {}) {
    if (!buildLesson || !catalogs || !banks || !registry) {
      throw new Error('GetSurfaceCertification requires buildLesson, catalogs, banks, and registry');
    }
    this.#buildLesson = buildLesson;
    this.#catalogs = catalogs;
    this.#banks = banks;
    this.#registry = registry;
  }

  /** @returns {Promise<object[]>} One certification row per profile + codec baseline. */
  async lesson(address) {
    const { catalogId, subjectId, courseId, unitId, lessonId } = parseAddress(address);

    let built = this.#bundleCache.get(address);
    if (!built) {
      const bundle = await this.#buildLesson.execute({
        catalogId, subjectId, courseId, unitId, lessonId,
      });
      built = { bundle, contentDigest: digest(bundle) };
      this.#bundleCache.set(address, built);
    }
    const { bundle, contentDigest } = built;

    const rawCatalog = await this.#catalogs.getCatalog(catalogId);
    const entry = findCatalogLesson(rawCatalog, { subjectId, courseId, unitId, lessonId });
    const requiredCapabilities = entry?.lesson?.requiredCapabilities ?? [];

    return this.#targets().map(({ profile, baseline }) => ({
      address,
      ...this.#lessonRow({
        bundle, contentDigest, profile, baseline, requiredCapabilities,
      }),
    }));
  }

  /** @returns {Promise<object[]>} One certification row per profile + codec baseline. */
  async bank(bankId) {
    const bank = await this.#banks.getBank(bankId);
    const contentDigest = digest(bank);
    const address = `bank:${bankId}`;

    return this.#targets().map(({ profile, baseline }) => ({
      address,
      ...this.#bankRow({
        bank, contentDigest, profile, baseline,
      }),
    }));
  }

  #targets() {
    return [
      ...this.#registry.list().map((profile) => ({ profile })),
      ...this.#registry.codecBaselines(),
    ];
  }

  #lessonRow({
    bundle, contentDigest, profile, baseline, requiredCapabilities,
  }) {
    const profileDigest = digest(profile);
    const cacheKey = `lesson:${contentDigest}:${profileDigest}`;
    const cached = this.#rowCache.get(cacheKey);
    if (cached) return cached;

    const port = this.#registry.portFor(profile);
    const result = port.certify(bundle, profile);

    const declaredReasons = capabilityReasons(
      { capabilities: requiredCapabilities, tracked: false },
      profile,
    );
    const modules = declaredReasons.length === 0
      ? result.modules
      : result.modules.map((module) => moduleVerdict({
        moduleId: module.moduleId,
        reasons: [...module.reasons, ...declaredReasons],
        warnings: module.warnings,
      }));

    const verdict = rollUpLesson(modules, { fullOrNothing: profile.family === 'schoolcalc' });

    const row = {
      surfaceId: profile.surfaceId,
      ...(baseline ? { baseline } : {}),
      verdict,
      reasons: uniqueList(modules.flatMap((module) => module.reasons)),
      warnings: uniqueList(modules.flatMap((module) => module.warnings)),
      ...(result.resource ? { resource: result.resource } : {}),
      moduleVerdicts: modules,
      contentDigest,
      profileDigest,
    };
    this.#rowCache.set(cacheKey, row);
    return row;
  }

  #bankRow({
    bank, contentDigest, profile, baseline,
  }) {
    const profileDigest = digest(profile);
    const cacheKey = `bank:${contentDigest}:${profileDigest}`;
    const cached = this.#rowCache.get(cacheKey);
    if (cached) return cached;

    const port = this.#registry.portFor(profile);
    const result = typeof port.certifyBank === 'function'
      ? port.certifyBank(bank, profile)
      : { verdict: 'incompatible', reasons: [BANK_NOT_DELIVERABLE_REASON], warnings: [] };

    const row = {
      surfaceId: profile.surfaceId,
      ...(baseline ? { baseline } : {}),
      verdict: result.verdict,
      reasons: [...(result.reasons ?? [])],
      warnings: [...(result.warnings ?? [])],
      moduleVerdicts: null,
      contentDigest,
      profileDigest,
    };
    this.#rowCache.set(cacheKey, row);
    return row;
  }
}

export default GetSurfaceCertification;
