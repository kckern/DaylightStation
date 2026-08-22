/**
 * YamlMaterialSnapshotStore — disk snapshot of the compiled school material
 * index (the `getMaterial` fulls GetMaterialUnits caches in memory), so a
 * redeploy doesn't throw the cache away and strand the next teacher on the
 * full Plex rebuild (~26s: the provider serializes requests server-side, so
 * concurrency can't shrink it — only persistence can).
 *
 *   <runtime cache>/school/materials.yml
 *   { [materialId]: { fetchedAt: ISO, full: {...} } }
 *
 * This file is a CACHE, not a record — every byte is regenerable from the
 * provider. That inverts the house corrupt-file posture: a corrupt read is
 * still LOUD (`school.material.snapshot-corrupt`) but writes may overwrite
 * it, because rebuilding is the correct repair and refusing would wedge the
 * cache forever over data nobody needs to keep.
 *
 * `full.trackParents` is a Map in memory (track → parent unit, Blocker 2
 * roll-up); it is stored as an entries array and revived on load, so callers
 * see the exact shape the source adapter returned.
 *
 * Writes are coalesced: a refresh sweep touches ~66 materials in seconds,
 * and one debounced atomic write of the whole map beats 66 rewrites. Nothing
 * here may ever throw into a caller — a cache that breaks a fetch has
 * negative value — so `put` and the flush path swallow-and-warn.
 */
import path from 'path';
import { loadYaml, saveYamlToPathAtomic, resolveYamlPath } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const FLUSH_DEBOUNCE_MS = 250;

export class YamlMaterialSnapshotStore {
  #configService;
  #logger;
  #map = null; // materialId -> { fetchedAt: ISO string, full: serialized } — mirror of the file
  #flushTimer = null;

  constructor(config = {}) {
    if (!config.configService || typeof config.configService.getRuntimeCachePath !== 'function') {
      throw new InfrastructureError('YamlMaterialSnapshotStore requires configService with getRuntimeCachePath()', {
        code: 'MISSING_DEPENDENCY', dependency: 'configService',
      });
    }
    this.#configService = config.configService;
    this.#logger = config.logger || console;
  }

  #base() { return path.join(this.#configService.getRuntimeCachePath('school'), 'materials'); }

  #serialize(full) {
    if (!(full?.trackParents instanceof Map)) return full;
    const { trackParents, ...rest } = full;
    return { ...rest, trackParents: [...trackParents.entries()] };
  }

  #revive(full) {
    if (!Array.isArray(full?.trackParents)) return full;
    return { ...full, trackParents: new Map(full.trackParents) };
  }

  /**
   * The whole snapshot as `Map<materialId, {full, at}>` (`at` in epoch ms,
   * trackParents revived). Missing file → empty. Corrupt file → warn + empty;
   * the next flush overwrites it (regenerable — see header).
   */
  load() {
    const base = this.#base();
    let raw = null;
    if (resolveYamlPath(base)) {
      try {
        raw = loadYaml(base);
      } catch (err) {
        this.#logger.warn?.('school.material.snapshot-corrupt', { file: `${base}.yml`, error: err?.message });
        raw = null;
      }
      if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) {
        this.#logger.warn?.('school.material.snapshot-corrupt', { file: `${base}.yml`, error: 'not a mapping' });
        raw = null;
      }
    }
    this.#map = { ...(raw ?? {}) };
    const out = new Map();
    for (const [materialId, entry] of Object.entries(this.#map)) {
      const at = Date.parse(entry?.fetchedAt ?? '');
      if (!entry?.full || Number.isNaN(at)) continue; // one bad row never spoils the rest
      out.set(materialId, { full: this.#revive(entry.full), at });
    }
    return out;
  }

  /** Record one fresh fetch. Never throws; the write itself is debounced. */
  put(materialId, full, at = Date.now()) {
    try {
      if (this.#map == null) this.load();
      this.#map[materialId] = { fetchedAt: new Date(at).toISOString(), full: this.#serialize(full) };
      if (!this.#flushTimer) {
        this.#flushTimer = setTimeout(() => this.flush(), FLUSH_DEBOUNCE_MS);
        this.#flushTimer.unref?.();
      }
    } catch (err) {
      this.#logger.warn?.('school.material.snapshot-write-failed', { materialId, error: err?.message });
    }
  }

  /** Write the mirror out now (also the debounce target). Never throws. */
  flush() {
    if (this.#flushTimer) { clearTimeout(this.#flushTimer); this.#flushTimer = null; }
    if (this.#map == null) return;
    try {
      saveYamlToPathAtomic(`${this.#base()}.yml`, this.#map, { noRefs: true });
    } catch (err) {
      this.#logger.warn?.('school.material.snapshot-write-failed', { error: err?.message });
    }
  }
}

export default YamlMaterialSnapshotStore;
