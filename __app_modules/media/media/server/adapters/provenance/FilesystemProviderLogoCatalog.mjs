/**
 * Provider logos in `data/content/providers/`: `<id>.svg` (or `.png`), plus an
 * optional `<id>.white.svg` for a logo that is black and would vanish on a dark
 * screen. The folder is listed at most once a minute, so a logo dropped in
 * shows up without a restart.
 *
 * Reference: __docs/reference/media/provenance.md
 */
import path from 'path';
import { createReadStream, listFiles } from '#system/utils/FileIO.mjs';
import { IProviderLogoCatalog } from '../../application/provenance/ports/IProviderLogoCatalog.mjs';

const TYPES = { svg: 'image/svg+xml', png: 'image/png' };
const NAME = /^([a-z0-9-]+?)(\.white)?\.(svg|png)$/;
const TTL_MS = 60_000;

export class FilesystemProviderLogoCatalog extends IProviderLogoCatalog {
  #dir; #index = null; #at = 0; #now;

  constructor({ dir, now = () => Date.now() }) {
    super();
    if (!dir) throw new Error('FilesystemProviderLogoCatalog requires dir');
    this.#dir = dir;
    this.#now = now;
  }

  /** provider -> { base?: file, white?: file } */
  #files() {
    if (this.#index && this.#now() - this.#at < TTL_MS) return this.#index;
    const index = new Map();
    for (const f of listFiles(this.#dir)) {
      const m = f.match(NAME);
      if (!m) continue;
      const entry = index.get(m[1]) || {};
      const slot = m[2] ? 'white' : 'base';
      // SVG wins over PNG for the same slot.
      if (!entry[slot] || m[3] === 'svg') entry[slot] = f;
      index.set(m[1], entry);
    }
    this.#index = index;
    this.#at = this.#now();
    return index;
  }

  has(provider) {
    return !!this.#files().get(provider)?.base;
  }

  /** Whether the provider has a white variant for dark screens. */
  hasWhite(provider) {
    return !!this.#files().get(provider)?.white;
  }

  /**
   * @param {string} provider
   * @param {{ white?: boolean }} [opts] - prefer the white variant (falls back to the base logo)
   * @returns {{ stream: import('stream').Readable, contentType: string }|null}
   */
  open(provider, { white = false } = {}) {
    const entry = this.#files().get(String(provider ?? ''));
    const file = (white && entry?.white) || entry?.base;
    if (!file) return null;
    const ext = file.split('.').pop();
    return { stream: createReadStream(path.join(this.#dir, file)), contentType: TYPES[ext] };
  }
}
