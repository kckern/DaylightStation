import path from 'node:path';
import { readYamlFromPath } from '#system/utils/FileIO.mjs';
import { parseMediaRef, validateLexicon, wordPackageDir } from '#domains/school/wordLadder/index.mjs';

/**
 * Reads `media:<dir>/lexicon.yml` word lexicons from the School media root and
 * returns the validated lexicon: `{ package, language, gloss, program, quiz, entries }`.
 */
export class YamlLexiconRepository {
  #root; #load;
  constructor({ mediaRoot, io = {} } = {}) {
    if (typeof mediaRoot !== 'string' || !mediaRoot.trim()) throw new Error('YamlLexiconRepository requires mediaRoot');
    this.#root = path.resolve(mediaRoot);
    this.#load = io.load ?? readYamlFromPath;
  }

  getLexicon(ref) {
    const parsed = parseMediaRef(ref);
    if (!parsed.ok) throw new Error(`lexicon '${ref}': ${parsed.error}`);
    const file = path.resolve(this.#root, parsed.path);
    if (file !== this.#root && !file.startsWith(`${this.#root}${path.sep}`)) throw new Error(`lexicon '${ref}': escapes the media root`);
    let raw;
    try { raw = this.#load(file); } catch (error) {
      throw new Error(`lexicon '${ref}': ${error?.code === 'ENOENT' ? 'not found' : error.message}`);
    }
    const { errors, lexicon } = validateLexicon(raw);
    if (errors.length) throw new Error(`lexicon '${ref}': ${errors.join('; ')}`);
    // The package id keys learner status and recordings. Pinning it to the
    // lexicon's own directory means two lexicons can never share a status file.
    const dir = wordPackageDir(ref);
    const expected = dir ? path.posix.basename(dir) : null;
    if (lexicon.package !== expected) {
      throw new Error(`lexicon '${ref}': package '${lexicon.package}' must match its directory name '${expected}'`);
    }
    return lexicon;
  }
}
export default YamlLexiconRepository;
