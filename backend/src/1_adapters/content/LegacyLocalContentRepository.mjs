import path from 'node:path';
import { parseFile } from 'music-metadata';
import { generateReference, lookupReference } from 'scripture-guide';
import { ILegacyLocalContentRepository } from '#apps/content/ports/ILegacyLocalContentRepository.mjs';
import { createLocalFileResource } from '#system/http/streamFile.mjs';
import {
  dirExists,
  fileExists,
  findMediaFileByPrefix,
  listDirs,
} from '#system/utils/FileIO.mjs';

const VOLUME_RANGES = {
  ot: { start: 1, end: 23145 }, nt: { start: 23146, end: 31102 },
  bom: { start: 31103, end: 37706 }, dc: { start: 37707, end: 41994 },
  pgp: { start: 41995, end: 42663 },
};
const IMAGE_MIMES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

function volumeFromVerseId(verseId) {
  const id = parseInt(verseId, 10);
  return Object.entries(VOLUME_RANGES).find(([, range]) => id >= range.start && id <= range.end)?.[0] || null;
}

function resourceFromPath(filePath, fallbackMime) {
  const resource = createLocalFileResource(filePath, {
    mimeType: IMAGE_MIMES[path.extname(filePath).toLowerCase()] || fallbackMime,
  });
  return resource ? { resource } : null;
}

export class LegacyLocalContentRepository extends ILegacyLocalContentRepository {
  constructor({ registry, dataPath = null, mediaBasePath = null, mediaProgressMemory = null, generatePlaceholder, placeholderFontPath = null }) {
    super();
    this.registry = registry;
    this.dataPath = dataPath;
    this.mediaBasePath = mediaBasePath;
    this.mediaProgressMemory = mediaProgressMemory;
    this.generatePlaceholder = generatePlaceholder;
    this.placeholderFontPath = placeholderFontPath;
  }

  #local() { return this.registry?.get('local-content'); }
  isConfigured() { return Boolean(this.#local()); }
  getItem(key) { return this.#local()?.getItem(key); }
  getList(key) { return this.#local()?.getList(key); }
  listCollection(name) { return this.#local()?.listCollection(name); }

  #scriptureBase() {
    const dataPath = this.#local()?.dataPath || this.dataPath;
    if (!dataPath) return null;
    const candidates = [
      path.join(dataPath, 'readalong', 'scripture'), path.join(dataPath, 'content', 'readalong', 'scripture'),
      path.join(dataPath, 'content', 'scripture'), path.join(dataPath, 'scripture'),
    ];
    return candidates.find(dirExists) || candidates[0];
  }

  #defaultVersion(volume) {
    const base = this.#scriptureBase();
    if (!base || !dirExists(base)) return null;
    const volumePath = path.join(base, volume);
    return dirExists(volumePath) ? (listDirs(volumePath)[0] || null) : null;
  }

  resolveScripture(input) {
    if (input.includes('/')) {
      const parts = input.split('/');
      if (parts.length === 3) return { volume: parts[0], version: parts[1], verseId: parts[2] };
      // Pre-canonical local-content links use `<collection>/<slug>` (for
      // example `cfm/test-chapter`). Preserve that public route while the
      // service still presents the normalized metadata from the resolved item.
      if (parts.length === 2 && parts.every(Boolean)) {
        return { path: input, volume: null, version: parts[0], verseId: parts[1] };
      }
    }
    try {
      const verseId = lookupReference(input)?.verse_ids?.[0];
      if (verseId) {
        const volume = volumeFromVerseId(verseId);
        return { volume, version: this.#defaultVersion(volume), verseId: String(verseId) };
      }
    } catch { /* invalid reference */ }
    const numeric = parseInt(input, 10);
    if (!Number.isNaN(numeric) && numeric > 0) {
      const volume = volumeFromVerseId(numeric);
      return { volume, version: this.#defaultVersion(volume), verseId: String(numeric) };
    }
    if (VOLUME_RANGES[input]) return { volume: input, version: this.#defaultVersion(input), verseId: String(VOLUME_RANGES[input].start) };
    // Legacy links also used an opaque scripture slug. Let the adapter look it
    // up so a missing slug remains a 404, not a validation-shaped 400.
    return input ? { path: input, volume: null, version: null, verseId: input } : null;
  }

  generateScriptureReference(verseId, fallback) {
    try { return generateReference(verseId).replace(/:1$/, ''); }
    catch { return fallback; }
  }

  async #duration(filePath, round = false) {
    if (!filePath) return 0;
    try {
      const duration = (await parseFile(filePath, { native: true }))?.format?.duration;
      return round ? (Math.round(duration) || 0) : (parseInt(duration, 10) || 0);
    } catch { return 0; }
  }

  async resolveAudioDuration(kind, number) {
    if (!this.mediaBasePath) return 0;
    const roots = kind === 'hymn'
      ? [path.join(this.mediaBasePath, 'audio', 'singalong', 'hymn', '_ldsgc'), path.join(this.mediaBasePath, 'audio', 'singalong', 'hymn')]
      : [path.join(this.mediaBasePath, 'audio', 'singalong', 'primary')];
    for (const root of roots) {
      const mediaFile = findMediaFileByPrefix(root, number);
      if (mediaFile) return this.#duration(mediaFile);
    }
    return 0;
  }

  filterPlayableTalks(children) {
    if (!this.mediaBasePath) return children;
    return children.filter(child => child.metadata?.mediaFile && fileExists(path.join(this.mediaBasePath, child.metadata.mediaFile)));
  }

  resolveTalkDuration(item) {
    if (!this.mediaBasePath || !item.metadata?.mediaFile) return 0;
    const mediaFile = path.join(this.mediaBasePath, item.metadata.mediaFile);
    return fileExists(mediaFile) ? this.#duration(mediaFile, true) : 0;
  }

  getTalkProgress() {
    return this.mediaProgressMemory ? this.mediaProgressMemory.listProgress('talk') : null;
  }

  async getCoverArt(mediaKey) {
    const mediaAdapter = this.registry?.get('files') || this.registry?.get('media');
    return mediaAdapter?.getCoverArt ? mediaAdapter.getCoverArt(mediaKey) : null;
  }

  createPlaceholder(mediaKey) {
    if (typeof this.generatePlaceholder !== 'function') throw new TypeError('local content requires generatePlaceholder');
    return this.generatePlaceholder(mediaKey, { fontPath: this.placeholderFontPath });
  }

  getCollectionCover(adapterName, collection, subPath) {
    const adapter = this.registry?.get(adapterName);
    if (!adapter?.resolveCoverImage) return { error: 'unsupported' };
    const filePath = adapter.resolveCoverImage(collection, subPath);
    return { value: filePath ? resourceFromPath(filePath, 'image/jpeg') : null };
  }

  getCollectionIcon(adapterName, collection) {
    const adapter = this.registry?.get(adapterName);
    if (!adapter?.resolveCollectionIcon) return { error: 'unsupported' };
    const filePath = adapter.resolveCollectionIcon(collection);
    return { value: filePath ? resourceFromPath(filePath, 'image/svg+xml') : null };
  }
}

export default LegacyLocalContentRepository;
