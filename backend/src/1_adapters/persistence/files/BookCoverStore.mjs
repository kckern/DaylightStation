// backend/src/1_adapters/persistence/files/BookCoverStore.mjs

import path from 'path';
import yaml from 'js-yaml';
import {
  deleteFile, ensureDir, fileExists, readBinary, readFile, writeBinaryAtomic, writeFileAtomic,
} from '#system/utils/FileIO.mjs';
import { coverContentType, coverExtension } from '#domains/books/BookCoverArt.mjs';

/**
 * BookCoverStore — the household's own copy of every cover it has found.
 *
 *   <mediaDir>/books/covers/{isbn13}.{jpg|png|gif|webp}   the art
 *   <mediaDir>/books/covers/{isbn13}.yml                  what it is
 *
 * ## MEDIA, NOT DATA
 *
 * The book RECORD lives in `data/household/books/{isbn13}.yml` — it is small,
 * hand-editable, and worth syncing. The ART is neither: tens of kilobytes of
 * JPEG per book, derived entirely from the record plus a network round trip,
 * and re-fetchable at any time. It belongs on the media mount with every other
 * blob the house holds, and the data tree stays a tree of facts.
 *
 * ## THE BYTES ARE KEPT, NOT THE URL
 *
 * A verified URL is only a promise that the art was there at verification time.
 * Providers rotate hosts, spend quotas and go down — OpenLibrary was refusing
 * connections from this host on the afternoon this was written — and none of
 * that may blank a shelf a child is standing in front of. Once the art is in
 * this directory the shelf renders from the household's own disk forever.
 *
 * ## A MISS IS A RECORD TOO
 *
 * Walking the whole ladder costs up to six third-party requests. A book nobody
 * has art for would pay that on every single render, so a miss writes a sidecar
 * with no `file` and the resolver treats it as settled until `retryAfter`.
 *
 * ## READS FAIL OPEN
 *
 * A corrupt or half-written sidecar answers null, which means "look again" —
 * never a dead cover. Writes are atomic, so a crash mid-save cannot produce
 * one anyway.
 *
 * @module adapters/persistence/files/BookCoverStore
 */

const ISBN13 = /^\d{13}$/;
const EXTENSIONS = Object.freeze(['jpg', 'png', 'gif', 'webp']);

export class BookCoverStore {
  #configService; #logger; #clock;

  /**
   * @param {object} deps
   * @param {object} deps.configService - must expose `getMediaDir()`
   */
  constructor({ configService, logger = console, clock = () => new Date() } = {}) {
    if (!configService || typeof configService.getMediaDir !== 'function') {
      throw new Error('BookCoverStore: configService with getMediaDir() is required');
    }
    this.#configService = configService;
    this.#logger = logger;
    this.#clock = typeof clock === 'function' ? clock : () => new Date();
  }

  #dir() { return path.join(this.#configService.getMediaDir(), 'books', 'covers'); }
  #sidecar(isbn13) { return path.join(this.#dir(), `${isbn13}.yml`); }
  #art(isbn13, extension) { return path.join(this.#dir(), `${isbn13}.${extension}`); }

  /**
   * What this book's art is, without reading the art itself.
   *
   * @returns {{source: string|null, url: string|null, file: string|null,
   *   contentType: string|null, checkedAt: string|null, width: number|null,
   *   height: number|null, byteLength: number|null, attempts: number|null}|null}
   */
  readMeta(isbn13) {
    if (!ISBN13.test(String(isbn13 ?? ''))) return null;
    const file = this.#sidecar(isbn13);
    if (!fileExists(file)) return null;
    try {
      const loaded = yaml.load(readFile(file));
      if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) throw new Error('not a mapping');
      return loaded;
    } catch (error) {
      this.#logger.warn?.('books.cover.sidecar-corrupt', { isbn13, file, error: error.message });
      return null;
    }
  }

  /**
   * The stored art, or null when there is none on disk.
   *
   * Tolerates a sidecar that names an extension the file no longer has (a
   * hand-swapped cover): the directory is the authority, the sidecar is notes.
   *
   * @returns {{bytes: Buffer, contentType: string, source: string|null, url: string|null}|null}
   */
  read(isbn13) {
    if (!ISBN13.test(String(isbn13 ?? ''))) return null;
    const meta = this.readMeta(isbn13);
    const ordered = meta?.file ? [String(meta.file).split('.').pop(), ...EXTENSIONS] : EXTENSIONS;
    for (const extension of ordered) {
      const file = this.#art(isbn13, extension);
      if (!fileExists(file)) continue;
      const bytes = readBinary(file);
      if (!bytes) {
        this.#logger.warn?.('books.cover.read-failed', { isbn13, file });
        return null;
      }
      return {
        bytes,
        contentType: meta?.contentType ?? coverContentType(extension),
        source: meta?.source ?? null,
        url: meta?.url ?? null,
        checkedAt: meta?.checkedAt ?? null,
      };
    }
    return null;
  }

  /** True when this book has art on disk. */
  has(isbn13) {
    if (!ISBN13.test(String(isbn13 ?? ''))) return false;
    return EXTENSIONS.some((extension) => fileExists(this.#art(isbn13, extension)));
  }

  /**
   * Keep the art and say where it came from.
   *
   * @param {string} isbn13
   * @param {{bytes: Buffer, contentType?: string, format?: string, source: string,
   *   url: string, width?: number, height?: number, attempts?: number}} art
   */
  save(isbn13, { bytes, contentType = null, format = null, source, url, width = null, height = null, attempts = null } = {}) {
    if (!ISBN13.test(String(isbn13 ?? ''))) throw new Error(`BookCoverStore.save needs a thirteen-digit isbn13, got: ${isbn13}`);
    if (!bytes?.length) throw new Error('BookCoverStore.save needs image bytes');
    const extension = coverExtension({ format, contentType });
    const dir = this.#dir();
    ensureDir(dir);
    // A format change (jpg -> png on a re-resolve) would otherwise leave the
    // old file behind for `read` to find first.
    // `deleteFile` already swallows a failure: a leftover file is not a reason
    // to lose the cover we just found.
    for (const stale of EXTENSIONS.filter((value) => value !== extension)) deleteFile(this.#art(isbn13, stale));
    // Binary, not text: `writeFileAtomic` stages as utf8 and would mangle a JPEG.
    writeBinaryAtomic(this.#art(isbn13, extension), bytes);
    this.#writeSidecar(isbn13, {
      source, url, file: `${isbn13}.${extension}`,
      contentType: contentType ?? coverContentType(extension),
      width, height, byteLength: bytes.length, attempts,
      checkedAt: this.#clock().toISOString(), retryAfter: null,
    });
    this.#logger.info?.('books.cover.stored', { isbn13, source, byteLength: bytes.length, width, height });
    return { file: `${isbn13}.${extension}`, source, url };
  }

  /**
   * Nobody had art. Remember that, with a date after which it is worth asking
   * again — catalogues gain covers, and a book bought last week often gets one.
   *
   * @param {string} isbn13
   * @param {{attempts?: number, retryAfter?: string|null, tried?: string[]}} [detail]
   */
  saveMiss(isbn13, { attempts = 0, retryAfter = null, tried = [] } = {}) {
    if (!ISBN13.test(String(isbn13 ?? ''))) throw new Error(`BookCoverStore.saveMiss needs a thirteen-digit isbn13, got: ${isbn13}`);
    ensureDir(this.#dir());
    this.#writeSidecar(isbn13, {
      source: null, url: null, file: null, contentType: null,
      width: null, height: null, byteLength: null, attempts,
      checkedAt: this.#clock().toISOString(), retryAfter, tried,
    });
    this.#logger.info?.('books.cover.none-found', { isbn13, attempts, retryAfter });
  }

  #writeSidecar(isbn13, meta) {
    try {
      writeFileAtomic(this.#sidecar(isbn13), yaml.dump(meta, { lineWidth: 120 }));
    } catch (error) {
      // The art is what matters; losing the notes costs one re-probe.
      this.#logger.warn?.('books.cover.sidecar-write-failed', { isbn13, error: error.message });
    }
  }
}

export default BookCoverStore;
