import path from 'node:path';
import { loadYaml, resolveYamlPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

const key = (wordId, normalized) => `${wordId}|${normalized}`;

/** `<rootDir>/<package>/judgements.yml` — derived data, shared across learners (spec §2 step 9). */
export class YamlJudgementCache {
  #rootDir;
  constructor({ rootDir }) { this.#rootDir = rootDir; }
  #base(pkg) { return path.join(this.#rootDir, pkg, 'judgements'); }
  #read(pkg) { return resolveYamlPath(this.#base(pkg)) ? (loadYaml(this.#base(pkg)) ?? {}) : {}; }
  get(pkg, wordId, normalized) { return this.#read(pkg)[key(wordId, normalized)] ?? null; }
  set(pkg, wordId, normalized, verdict) {
    const all = this.#read(pkg);
    all[key(wordId, normalized)] = { score: verdict.score, judge: verdict.judge, reason: verdict.reason ?? null };
    saveYamlToPathAtomic(`${this.#base(pkg)}.yml`, all, { noRefs: true });
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
  constructor({ fallback = null } = {}) { this.#fallback = fallback; }
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
