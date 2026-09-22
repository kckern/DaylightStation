import path from 'node:path';
import { readYamlFromPath } from '#system/utils/FileIO.mjs';
import { parseMediaRef, validateLexicon } from '#domains/school/wordLadder/index.mjs';

/** Reads `media:<dir>/lexicon.yml` word lexicons from the School media root. */
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
    const { errors, entries } = validateLexicon(raw);
    if (errors.length) throw new Error(`lexicon '${ref}': ${errors.join('; ')}`);
    return entries;
  }
}
export default YamlLexiconRepository;
