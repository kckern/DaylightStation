/**
 * YAML persistence for mid-quiz sittings (prod-hardening Task 17). One file
 * per user:
 *
 *   <userDir>/apps/school/sittings.yml
 *   { [bankId]: { mode, sessionId, startedAt, bankRev, answers: [{itemId, correct}] } }
 *
 * A sitting is a CONVENIENCE, not evidence — the append-only attempt log is
 * the record. That asymmetry sets the posture (same as YamlSchoolDatastore
 * #readAttemptShard / YamlAssignmentStore): missing and corrupt are DIFFERENT
 * answers. A corrupt file reads as "no sittings" (warn, never throw — losing
 * a resume point must never block a quiz), but writes REFUSE until a human
 * clears the file: silently clobbering it would destroy every other bank's
 * resume point to save one. Dumb storage — freshness/mode/bankRev policy
 * lives in SchoolService.
 */
import path from 'path';
import { loadYaml, saveYamlToPathAtomic, resolveYamlPath } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';

export class YamlSittingStore {
  #configService;

  #logger;

  // userIds whose sittings file last read as corrupt. A clean read clears the
  // flag, so fixing (or deleting) the file un-wedges writes without a restart.
  #corrupt = new Set();

  constructor(config = {}) {
    if (!config.configService || typeof config.configService.getUserDir !== 'function') {
      throw new InfrastructureError('YamlSittingStore requires configService with getUserDir()', {
        code: 'MISSING_DEPENDENCY', dependency: 'configService',
      });
    }
    this.#configService = config.configService;
    this.#logger = config.logger || console;
  }

  /** Extensionless base path, or null for a user the config layer disowns. */
  #base(userId) {
    if (!this.#configService.getUserProfile?.(userId)) return null;
    return path.join(this.#configService.getUserDir(userId), 'apps', 'school', 'sittings');
  }

  /**
   * Read + parse the whole per-user map, tracking corrupt-vs-missing.
   * `file` is the actual on-disk path when one exists (`.yml` or `.yaml`);
   * for `missing` it falls back to the `.yml` name a write would create.
   */
  #readMap(userId) {
    const base = this.#base(userId);
    if (!base) return { state: 'missing', map: {}, file: null };
    const resolved = resolveYamlPath(base);
    if (!resolved) {
      this.#corrupt.delete(userId);
      return { state: 'missing', map: {}, file: `${base}.yml` };
    }
    let raw;
    try {
      raw = loadYaml(base);
    } catch {
      return this.#markCorrupt(userId, resolved);
    }
    // An empty file loads as null/undefined: that is an empty map, not damage.
    if (raw == null) { this.#corrupt.delete(userId); return { state: 'ok', map: {}, file: resolved }; }
    if (typeof raw !== 'object' || Array.isArray(raw)) return this.#markCorrupt(userId, resolved);
    this.#corrupt.delete(userId);
    return { state: 'ok', map: raw, file: resolved };
  }

  #markCorrupt(userId, file) {
    this.#corrupt.add(userId);
    this.#logger.warn?.('school.sittings.corrupt', { learnerId: userId, file });
    return { state: 'corrupt', map: {}, file };
  }

  #refuseIfCorrupt(userId, file) {
    if (this.#corrupt.has(userId)) {
      throw new DomainInvariantError(
        `sittings file for user '${userId}' is corrupt — refusing to overwrite it`,
        { code: 'SITTINGS_CORRUPT', details: { userId, file } },
      );
    }
  }

  /** One bank's sitting, or null (missing user, missing file, corrupt file, absent/misshapen entry). */
  read(userId, bankId) {
    const { map } = this.#readMap(userId);
    const sitting = map[bankId];
    if (!sitting || typeof sitting !== 'object' || Array.isArray(sitting)) return null;
    if (!Array.isArray(sitting.answers)) return null;
    return sitting;
  }

  /** Insert-or-replace one bank's sitting. Throws on corrupt file / unknown user. */
  upsert(userId, bankId, sitting) {
    const base = this.#base(userId);
    if (!base) {
      throw new InfrastructureError(`cannot resolve a sittings dir for user ${userId}`, {
        code: 'UNKNOWN_USER', details: { userId },
      });
    }
    const { state, map, file } = this.#readMap(userId);
    if (state === 'corrupt') this.#refuseIfCorrupt(userId, file);
    saveYamlToPathAtomic(file, { ...map, [bankId]: sitting }, { noRefs: true });
    return true;
  }

  /** Delete one bank's sitting. Missing is a quiet no-op; corrupt refuses (throws). */
  remove(userId, bankId) {
    const base = this.#base(userId);
    if (!base) return false;
    const { state, map, file } = this.#readMap(userId);
    if (state === 'missing') return false;
    if (state === 'corrupt') this.#refuseIfCorrupt(userId, file);
    if (!(bankId in map)) return false;
    const next = { ...map };
    delete next[bankId];
    saveYamlToPathAtomic(file, next, { noRefs: true });
    return true;
  }
}

export default YamlSittingStore;
