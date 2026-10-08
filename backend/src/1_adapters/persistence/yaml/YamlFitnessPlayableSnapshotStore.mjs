/**
 * Regenerable disk snapshot for FitnessPlayableService's provider-backed
 * course structure. Progress is deliberately excluded and remains a live
 * local-store read on every request.
 */
import path from 'path';
import { loadYaml, saveYamlToPathAtomic, resolveYamlPath } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const FLUSH_DEBOUNCE_MS = 250;

export class YamlFitnessPlayableSnapshotStore {
  #configService; #logger; #io; #map = null; #flushTimer = null;

  constructor({ configService, logger = console, io = null } = {}) {
    if (!configService || typeof configService.getRuntimeCachePath !== 'function') {
      throw new InfrastructureError('YamlFitnessPlayableSnapshotStore requires configService with getRuntimeCachePath()', {
        code: 'MISSING_DEPENDENCY', dependency: 'configService',
      });
    }
    this.#configService = configService;
    this.#logger = logger;
    this.#io = io ?? { loadYaml, saveYamlToPathAtomic, resolveYamlPath };
  }

  #base() { return path.join(this.#configService.getRuntimeCachePath('fitness'), 'playable-structure'); }

  load() {
    const base = this.#base();
    let raw = null;
    if (this.#io.resolveYamlPath(base)) {
      try { raw = this.#io.loadYaml(base); }
      catch (err) {
        this.#logger.warn?.('fitness.playable.snapshot-corrupt', { file: `${base}.yml`, error: err?.message });
      }
    }
    this.#map = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
    const out = new Map();
    for (const [key, entry] of Object.entries(this.#map)) {
      const at = Date.parse(entry?.fetchedAt ?? '');
      if (!Object.hasOwn(entry ?? {}, 'value') || Number.isNaN(at)) continue;
      out.set(key, { value: entry.value, at });
    }
    return out;
  }

  put(key, value, at = Date.now()) {
    try {
      if (this.#map == null) this.load();
      this.#map[key] = { fetchedAt: new Date(at).toISOString(), value };
      if (!this.#flushTimer) {
        this.#flushTimer = setTimeout(() => this.flush(), FLUSH_DEBOUNCE_MS);
        this.#flushTimer.unref?.();
      }
    } catch (err) {
      this.#logger.warn?.('fitness.playable.snapshot-write-failed', { key, error: err?.message });
    }
  }

  flush() {
    if (this.#flushTimer) { clearTimeout(this.#flushTimer); this.#flushTimer = null; }
    if (this.#map == null) return;
    try { this.#io.saveYamlToPathAtomic(`${this.#base()}.yml`, this.#map, { noRefs: true }); }
    catch (err) { this.#logger.warn?.('fitness.playable.snapshot-write-failed', { error: err?.message }); }
  }
}

export default YamlFitnessPlayableSnapshotStore;
