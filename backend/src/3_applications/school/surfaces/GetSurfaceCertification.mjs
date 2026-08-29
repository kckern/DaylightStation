import { sha256Text } from '#system/utils/sha256.mjs';
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
  return sha256Text(JSON.stringify(sortKeys(value)));
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
 * re-certifies. The row cache is content-addressed and self-invalidating
 * (a stale row simply never gets looked up again once its content digest
 * changes); the *bundle* cache is address-keyed and does NOT self-invalidate
 * — it lives for the instance's lifetime, so an out-of-band edit to the
 * underlying catalog/document/bank content is invisible to an
 * already-cached address until `invalidate()` is called. A caller that
 * holds a `GetSurfaceCertification` instance across requests (e.g. a
 * long-lived API handler) MUST either construct a fresh instance per
 * request/certification pass, or call `invalidate(address)` (or
 * `invalidate()` for all addresses) whenever content it depends on may have
 * changed. Short-lived callers (e.g. a CLI invocation that constructs one
 * instance per run) get this for free and never need to call it.
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

  /**
   * Evict the address-keyed bundle cache so the next `lesson()` call for
   * `address` re-invokes `buildLesson.execute` instead of reusing a
   * previously-built bundle (spec: bundle cache does not self-invalidate).
   * With no argument, clears every cached address. Row-cache entries are
   * content-addressed and left alone — they simply won't be reused once the
   * refetched bundle's content digest differs.
   *
   * @param {string|null} [address] - The lesson address to evict, or omit
   *   to clear the whole bundle cache.
   */
  invalidate(address = null) {
    if (address === null) {
      this.#bundleCache.clear();
    } else {
      this.#bundleCache.delete(address);
    }
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

  async select({ address = null, bankId = null, surfaceId = null }) {
    const rows = address !== null ? await this.lesson(address) : await this.bank(bankId);
    return surfaceId === null ? rows : rows.filter((row) => row.surfaceId === surfaceId);
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
    // A resource the port compiled reflects its own (pre-declared-requirement)
    // view of compatibility; once a declared requirement demotes the whole
    // lesson to 'none', that compiled artifact is no longer deliverable and
    // must not be reported as available.
    const demotedByDeclaredRequirement = declaredReasons.length > 0 && verdict === 'none';

    const row = {
      surfaceId: profile.surfaceId,
      ...(baseline ? { baseline } : {}),
      verdict,
      reasons: uniqueList(modules.flatMap((module) => module.reasons)),
      warnings: uniqueList(modules.flatMap((module) => module.warnings)),
      ...(result.resource && !demotedByDeclaredRequirement ? { resource: result.resource } : {}),
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
