import path from 'node:path';
import { copyFileOnce, loadYaml, resolveYamlPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

const key = (wordId, normalized) => `${wordId}|${normalized}`;

/**
 * `<rootDir>/<package>/judgements.yml` — derived data, shared across learners (spec §2 step 9).
 *
 * `legacyRootDir` is the pre-rename (2026-09-23) `runtime/word-ladder`: the
 * first time a package is touched with no file here but one there, that file
 * is COPIED here (never moved, never written again). `readOnlyView()` reads
 * without copying — the old file in place until a live read moves it.
 */
export class YamlJudgementCache {
  #rootDir; #legacyRootDir; #migrate;
  constructor({ rootDir, legacyRootDir = null, migrate = true }) {
    this.#rootDir = rootDir; this.#legacyRootDir = legacyRootDir; this.#migrate = migrate;
  }
  #file(root, pkg) { return path.join(root, pkg, 'judgements.yml'); }
  #base(pkg) {
    const current = path.join(this.#rootDir, pkg, 'judgements');
    if (!this.#legacyRootDir || resolveYamlPath(current)) return current;
    const legacy = path.join(this.#legacyRootDir, pkg, 'judgements');
    if (!resolveYamlPath(legacy)) return current;
    if (!this.#migrate) return legacy;
    copyFileOnce(this.#file(this.#legacyRootDir, pkg), this.#file(this.#rootDir, pkg));
    return current;
  }
  #read(pkg) { const base = this.#base(pkg); return resolveYamlPath(base) ? (loadYaml(base) ?? {}) : {}; }
  /** Reads only; never copies a pre-rename file and has no writer. */
  readOnlyView() {
    const view = new YamlJudgementCache({ rootDir: this.#rootDir, legacyRootDir: this.#legacyRootDir, migrate: false });
    return { get: (pkg, wordId, normalized) => view.get(pkg, wordId, normalized) };
  }
  get(pkg, wordId, normalized) { return this.#read(pkg)[key(wordId, normalized)] ?? null; }
  set(pkg, wordId, normalized, verdict) {
    const all = this.#read(pkg);
    all[key(wordId, normalized)] = { score: verdict.score, judge: verdict.judge, reason: verdict.reason ?? null };
    saveYamlToPathAtomic(this.#file(this.#rootDir, pkg), all, { noRefs: true });
  }
}

/**
 * In-memory judgements (test mode). With a `fallback` (the live cache), a
 * miss reads through to it, so a grown-up's re-grade is honoured in test
 * mode too; writes stay in memory and never reach the fallback. A fallback
 * that throws reads as a miss.
 */
export class MemoryJudgementCache {
  #map = new Map();
  #fallback;
  constructor({ fallback = null } = {}) {
    // The live cache's read-only view when it has one: a test-mode miss must
    // never migrate (copy) a pre-rename judgements file.
    this.#fallback = typeof fallback?.readOnlyView === 'function' ? fallback.readOnlyView() : fallback;
  }
  get(pkg, wordId, normalized) {
    const own = this.#map.get(`${pkg}|${key(wordId, normalized)}`);
    if (own) return own;
    if (!this.#fallback) return null;
    try {
      const live = this.#fallback.get(pkg, wordId, normalized);
      return live ? { ...live } : null;
    } catch { return null; }
  }
  set(pkg, wordId, normalized, verdict) { this.#map.set(`${pkg}|${key(wordId, normalized)}`, { ...verdict }); }
}
export default YamlJudgementCache;
