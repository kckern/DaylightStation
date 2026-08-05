import { SURFACE_FAMILIES } from '#domains/school/surfaces/index.mjs';

/**
 * Application-layer registry over resolved surface profiles and their
 * certification ports (spec §7.1/§9). Constructed by callers — Task 10's
 * projection, Task 12's CLI, Task 13's router — there is no singleton; each
 * caller injects the profile set (typically `repository.listProfiles()`),
 * the family→port map, and any codec baselines to certify against.
 *
 * `profiles` accepts either raw `{profile, errors, file}` repository entries
 * or bare validated profile objects — either way, only entries carrying a
 * `profile` (i.e. a `surfaceId`) are exposed; invalid entries are dropped
 * here (they were already surfaced with their errors by the repository).
 *
 * `baselines` is injected rather than imported from the TI-86 adapter
 * (`ti86CodecBaselineProfile`) directly: the application layer is forbidden
 * from importing `1_adapters/` (see `docs/reference/core/layers-of-abstraction/
 * application-layer-guidelines.md`). Callers pass
 * `[{ profile: ti86CodecBaselineProfile(), baseline: 'codec' }]` so the CLI
 * can certify calculators without a physical device (spec §6.2).
 */
export class SurfaceRegistry {
  #profiles; #ports; #baselines;

  constructor({ profiles = [], ports, baselines = [] } = {}) {
    if (!ports || typeof ports !== 'object') {
      throw new Error('SurfaceRegistry requires ports (schoolcalc, paper, screen)');
    }
    for (const family of SURFACE_FAMILIES) {
      if (!ports[family]) throw new Error(`SurfaceRegistry requires a port for family '${family}'`);
    }
    this.#ports = { ...ports };
    this.#baselines = Object.freeze([...baselines]);

    this.#profiles = new Map();
    for (const entry of profiles) {
      const profile = entry?.profile ?? entry;
      if (profile && typeof profile.surfaceId === 'string' && profile.surfaceId) {
        this.#profiles.set(profile.surfaceId, profile);
      }
    }
  }

  /** @returns {object[]} All valid profiles known to this registry. */
  list() {
    return [...this.#profiles.values()];
  }

  /** @returns {object|undefined} The profile for `surfaceId`, if known. */
  get(surfaceId) {
    return this.#profiles.get(surfaceId);
  }

  /**
   * Resolves the certification port for a profile's family.
   * @throws {Error} On an unknown/missing family (malformed input, spec §7.1).
   */
  portFor(profile) {
    const family = profile?.family;
    const port = family ? this.#ports[family] : undefined;
    if (!port) throw new Error(`SurfaceRegistry: unknown surface family '${family}'`);
    return port;
  }

  /**
   * @returns {Array<{profile: object, baseline: string}>} Device-independent
   *   baseline profiles (e.g. the TI-86 codec) injected at construction —
   *   lets the CLI certify without a live device (spec §6.2).
   */
  codecBaselines() {
    return this.#baselines;
  }
}

export default SurfaceRegistry;
