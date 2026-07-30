/**
 * Machine-written NFC discovery store: history/triggers/nfc.observed.yml.
 * Separate writer from the curated config bindings (spec/status split).
 * Layer: ADAPTER (1_adapters/persistence/yaml).
 *
 * Keys are CANONICAL uids (see domains/trigger/nfcUid). Keying by a merely
 * lowercased uid split one physical tag across two records once a reader
 * reported it packed (`04669c0fcb2a81`) where an older reader had written it
 * separated (`04_66_9c_0f_cb_2a_81`) — which also made a long-known tag look
 * like a first sighting and fire `notify_unknown`. Legacy separated keys are
 * folded on load rather than left to accumulate a second record each.
 *
 * @module adapters/persistence/yaml/YamlObservedStateStore
 */
import { canonicalizeNfcUid } from '#domains/trigger/nfcUid.mjs';

export class YamlObservedStateStore {
  #loadFile; #saveFile; #path; #cache = null; #writeChain = Promise.resolve();

  constructor({ loadFile, saveFile, path = 'history/triggers/nfc.observed' } = {}) {
    this.#loadFile = loadFile;
    this.#saveFile = saveFile;
    this.#path = path;
  }

  load() {
    let raw;
    try {
      raw = this.#loadFile?.(this.#path);
    } catch {
      raw = null;
    }
    const parsed = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    // Fold legacy separated keys onto their canonical form. Done on load so a
    // pre-existing history file keeps answering has() for tags first seen under
    // the old spelling, instead of reporting every one as a new discovery.
    this.#cache = {};
    for (const [rawKey, entry] of Object.entries(parsed)) {
      const key = canonicalizeNfcUid(rawKey) || rawKey;
      const prior = this.#cache[key];
      if (!prior) { this.#cache[key] = entry; continue; }
      // Two spellings of one tag already on disk: merge rather than let key
      // order decide, so neither sighting history is discarded.
      this.#cache[key] = {
        first_seen: [prior.first_seen, entry?.first_seen].filter(Boolean).sort()[0] ?? null,
        last_seen: [prior.last_seen, entry?.last_seen].filter(Boolean).sort().pop() ?? null,
        count: (prior.count || 0) + (entry?.count || 0),
      };
    }
    return this.#cache;
  }

  has(uid) {
    return !!(this.#cache && this.#cache[canonicalizeNfcUid(uid)]);
  }

  record(uid, timestampStr) {
    return this.#enqueue(async () => {
      if (!this.#cache) this.load();
      const key = canonicalizeNfcUid(uid);
      const existing = this.#cache[key];
      const entry = existing
        ? { first_seen: existing.first_seen, last_seen: timestampStr, count: (existing.count || 0) + 1 }
        : { first_seen: timestampStr, last_seen: timestampStr, count: 1 };
      this.#cache[key] = entry;
      await Promise.resolve(this.#saveFile?.(this.#path, this.#cache));
      return entry;
    });
  }

  #enqueue(task) {
    const next = this.#writeChain.then(task, task);
    this.#writeChain = next.then(() => undefined, () => undefined);
    return next;
  }
}

export default YamlObservedStateStore;
