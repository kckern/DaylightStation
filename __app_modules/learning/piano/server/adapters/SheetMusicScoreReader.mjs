/**
 * Reads a library score as the kiosk sees it: decompressed MusicXML text and its
 * sha256. Approved Learn files carry the `contentSha256` they were cut against;
 * the admin compares it with this reader's hash, so the two must agree with the
 * kiosk's `sha256(musicXml).toString()` (crypto-js over the UTF-8 string) byte
 * for byte.
 *
 * How the kiosk gets the text: `api/v1/proxy/media/stream/<local>` serves a
 * .musicxml file's bytes unchanged and an .mxl archive's root file as a UTF-8
 * string; the browser's `response.text()` then runs WHATWG "UTF-8 decode", which
 * drops one leading byte-order mark and replaces invalid sequences with U+FFFD.
 * TextDecoder is that same algorithm, so .musicxml bytes go through it here, and
 * the .mxl text loses a leading BOM the same way.
 *
 * Failures are ScoreReadError with a `code` (NOT_LIBRARY_SCORE, SCORE_NOT_FOUND,
 * SCORE_UNREADABLE, SCORE_TOO_LARGE), the `scoreId`, and the original error as
 * `cause`. Messages name the score id, never the absolute media path.
 *
 * `writeScoreExclusive` stores a new score's bytes and never overwrites: an
 * existing file fails with `code: 'EEXIST'`, any other failure with
 * SCORE_UNWRITABLE.
 *
 * Layer: ADAPTER. All filesystem access through FileIO.
 */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ensureDirAsync, getFileStatsAsync, readBinaryFromPathAsync, writeBinaryExclusiveAsync } from '#system/utils/FileIO.mjs';
import { extractMusicXmlFromMxl, MAX_MXL_XML_BYTES } from '../../../../../__capabilities/music-notation/server/mxlArchive.mjs';
import { libraryScoreLocalPath } from '../../portable/music/practiceKey.mjs';

/** Largest .mxl file read: compressed scores are rarely over 1 MB. */
export const MAX_MXL_ARCHIVE_BYTES = 16 * 1024 * 1024;

const BOM = '\uFEFF';
const MXL_RE = /\.mxl$/i;

export class ScoreReadError extends Error {
  constructor(code, scoreId, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ScoreReadError';
    this.code = code;
    this.scoreId = scoreId;
  }
}

export class SheetMusicScoreReader {
  #mediaDir;
  #maxArchiveBytes;
  #maxXmlBytes;

  constructor({ mediaDir, maxArchiveBytes = MAX_MXL_ARCHIVE_BYTES, maxXmlBytes = MAX_MXL_XML_BYTES } = {}) {
    if (!mediaDir) throw new Error('SheetMusicScoreReader requires mediaDir');
    this.#mediaDir = mediaDir;
    this.#maxArchiveBytes = maxArchiveBytes;
    this.#maxXmlBytes = maxXmlBytes;
  }

  /** sha256 hex of the text's UTF-8 bytes: what crypto-js computes in the kiosk. */
  static hash(xml) {
    return createHash('sha256').update(xml, 'utf8').digest('hex');
  }

  /** Absolute file path of a library score; throws NOT_LIBRARY_SCORE for any id the guard refuses. */
  localPath(scoreId) {
    return path.join(this.#mediaDir, this.#local(scoreId));
  }

  /**
   * `${mtimeMs}:${size}` of the score file: a cheap change marker for caching
   * the parsed header. Null when the id is not a library score or the path is
   * not a readable file (the caller then reads the score and gets its coded error).
   */
  async signature(scoreId) {
    const local = libraryScoreLocalPath(scoreId);
    if (!local) return null;
    try {
      const stats = await getFileStatsAsync(path.join(this.#mediaDir, local));
      return stats.isFile() ? `${stats.mtimeMs}:${stats.size}` : null;
    } catch {
      return null;
    }
  }

  /** @returns {Promise<{ xml: string, contentSha256: string }>} */
  async read(scoreId) {
    const local = this.#local(scoreId);
    const file = path.join(this.#mediaDir, local);
    const isMxl = MXL_RE.test(local);
    const maxFileBytes = isMxl ? this.#maxArchiveBytes : this.#maxXmlBytes;

    let stats;
    try {
      stats = await getFileStatsAsync(file);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        throw new ScoreReadError('SCORE_NOT_FOUND', scoreId, `Sheet music score not found: ${scoreId}`, error);
      }
      throw new ScoreReadError('SCORE_UNREADABLE', scoreId, `Sheet music score could not be read: ${scoreId}`, error);
    }
    if (!stats.isFile()) {
      throw new ScoreReadError('SCORE_NOT_FOUND', scoreId, `Sheet music score is not a file: ${scoreId}`);
    }
    if (stats.size > maxFileBytes) {
      throw new ScoreReadError('SCORE_TOO_LARGE', scoreId,
        `Sheet music score is too large: ${scoreId} (${stats.size} bytes, limit ${maxFileBytes})`);
    }

    let xml;
    try {
      const buffer = await readBinaryFromPathAsync(file);
      xml = isMxl
        ? stripBom(await extractMusicXmlFromMxl(buffer, { maxXmlBytes: this.#maxXmlBytes }))
        : new TextDecoder('utf-8').decode(buffer);
    } catch (error) {
      if (error?.code === 'MXL_TOO_LARGE') {
        throw new ScoreReadError('SCORE_TOO_LARGE', scoreId, `Sheet music score is too large once decompressed: ${scoreId}`, error);
      }
      throw new ScoreReadError('SCORE_UNREADABLE', scoreId, `Sheet music score could not be read: ${scoreId}`, error);
    }
    return { xml, contentSha256: SheetMusicScoreReader.hash(xml) };
  }

  /**
   * Write a new library score. The folder is created when missing, so a folder
   * configured in `sheetmusic.collections` but absent on disk comes into being on
   * its first upload. Never replaces anything at the path, a symlink included
   * (O_EXCL): that fails with code EEXIST.
   */
  async writeScoreExclusive(scoreId, buffer) {
    const file = this.localPath(scoreId);
    const unwritable = (error) => new ScoreReadError('SCORE_UNWRITABLE', scoreId,
      `Sheet music score could not be written: ${scoreId}`, error);
    try {
      await ensureDirAsync(path.dirname(file));
    } catch (error) {
      // mkdir's EEXIST means a FILE sits where the folder should be: not a duplicate score.
      throw unwritable(error);
    }
    try {
      await writeBinaryExclusiveAsync(file, buffer);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new ScoreReadError('EEXIST', scoreId, `Sheet music score already exists: ${scoreId}`, error);
      }
      throw unwritable(error);
    }
  }

  #local(scoreId) {
    const local = libraryScoreLocalPath(scoreId);
    if (!local) throw new ScoreReadError('NOT_LIBRARY_SCORE', scoreId, `Not a sheet music score: ${scoreId}`);
    return local;
  }
}

function stripBom(text) {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

export default SheetMusicScoreReader;
