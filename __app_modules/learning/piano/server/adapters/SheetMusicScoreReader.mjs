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
 * Layer: ADAPTER. All filesystem access through FileIO.
 */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readBinaryFromPathAsync } from '#system/utils/FileIO.mjs';
import { extractMusicXmlFromMxl } from '../../../../../__capabilities/music-notation/portable/mxlArchive.mjs';
import { libraryScoreLocalPath } from '../../portable/music/practiceKey.mjs';

const BOM = '﻿';

export class SheetMusicScoreReader {
  #mediaDir;

  constructor({ mediaDir } = {}) {
    if (!mediaDir) throw new Error('SheetMusicScoreReader requires mediaDir');
    this.#mediaDir = mediaDir;
  }

  /** sha256 hex of the text's UTF-8 bytes: what crypto-js computes in the kiosk. */
  static hash(xml) {
    return createHash('sha256').update(xml, 'utf8').digest('hex');
  }

  /** Absolute file path of a library score; throws for any id the guard refuses. */
  localPath(scoreId) {
    const local = libraryScoreLocalPath(scoreId);
    if (!local) throw new Error(`Not a sheet music score: ${scoreId}`);
    return path.join(this.#mediaDir, local);
  }

  /** @returns {Promise<{ xml: string, contentSha256: string }>} */
  async read(scoreId) {
    const buffer = await readBinaryFromPathAsync(this.localPath(scoreId));
    const xml = /\.mxl$/i.test(scoreId)
      ? stripBom(await extractMusicXmlFromMxl(buffer))
      : new TextDecoder('utf-8').decode(buffer);
    return { xml, contentSha256: SheetMusicScoreReader.hash(xml) };
  }
}

function stripBom(text) {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

export default SheetMusicScoreReader;
