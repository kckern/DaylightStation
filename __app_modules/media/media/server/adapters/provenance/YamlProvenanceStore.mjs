/**
 * Availability records as one YAML file on the media mount:
 * `media/content-providers/availability.yml` (machine-fetched, like
 * the content filter's machine-fetched maps).
 *
 *   usage: { month: 2026-11, quota: 2500, quotaUsed: 42 }
 *   titles:
 *     plex:50896: { key, kind, title, year, lookupId, checkedAt, offers: [...] }
 *
 * Writes are atomic and queued in-process. The file is re-read when its mtime
 * changes, so an edit by hand (or another checkout) is picked up.
 *
 * Reference: __docs/reference/media/provenance.md
 */
import path from 'path';
import { ensureDir, fileMtimeMs, loadYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { IProvenanceStore } from '../../application/provenance/ports/IProvenanceStore.mjs';

export class YamlProvenanceStore extends IProvenanceStore {
  #file; #cache = null; #mtime = null; #queue = Promise.resolve();

  constructor({ mediaDir }) {
    super();
    if (!mediaDir) throw new Error('YamlProvenanceStore requires mediaDir');
    this.#file = path.join(mediaDir, 'content-providers', 'availability.yml');
  }

  #load() {
    const mtime = fileMtimeMs(this.#file);
    if (this.#cache && mtime === this.#mtime) return this.#cache;
    const doc = loadYamlFromPath(this.#file) || {};
    this.#cache = { usage: doc.usage ?? null, titles: doc.titles && typeof doc.titles === 'object' ? doc.titles : {} };
    this.#mtime = mtime;
    return this.#cache;
  }

  async get(key) {
    return this.#load().titles[`plex:${key}`] ?? null;
  }

  async usage() {
    return this.#load().usage;
  }

  put(key, record, usage) {
    const run = async () => {
      const doc = this.#load();
      doc.titles = { ...doc.titles, [`plex:${key}`]: record };
      if (usage) doc.usage = { ...usage };
      ensureDir(path.dirname(this.#file));
      saveYamlToPathAtomic(this.#file, { usage: doc.usage, titles: doc.titles });
      this.#cache = doc;
      this.#mtime = fileMtimeMs(this.#file);
    };
    this.#queue = this.#queue.then(run, run);
    return this.#queue;
  }
}
