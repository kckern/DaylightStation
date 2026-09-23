/**
 * Card lexicon for the card ladder (design "Data model"). Pure.
 *
 * A lexicon is authored once per PACKAGE on the media mount. It is the single
 * source of the package's identity — the target side's language (what is
 * being acquired), the anchor side's language (what the learner already holds
 * it by), the program's title and the printed quiz's copy — and names every
 * card's two sides, kind, course-unit group and quiz decoys. Adding a language
 * (or an English-to-English definitions set, or a history deck) is a new
 * package (lexicon + media + deck), never a code change.
 *
 * SIDES. `term` is the TARGET side and `gloss` the ANCHOR side; those two
 * readable names stay the internal field names (and the API's). An entry may
 * spell them `target:` / `anchor:` instead, and so may its decoys.
 *
 * SCHEMAS. `school.word-lexicon/v2` names the target language `language:` and
 * the anchor language `gloss:` (a header block, not the entry field).
 * `school.card-lexicon/v3` names them `target:` and `anchor:`. Both are read;
 * the parsed lexicon carries `language`/`gloss` (as before) AND
 * `targetLanguage`/`anchorLanguage`/`targetScript`.
 *
 * A weekly deck lists card ids only; `expandLexiconDeck` turns it into
 * ordinary flashcard cards BEFORE `validateFlashcardDeck` sees it, so every
 * existing deck consumer works on it.
 */
import { scriptFor } from './targetScript.mjs';

export const LEXICON_SCHEMA = 'school.word-lexicon/v2';
/** Same content as v2 with side-neutral header names (`target:` / `anchor:` language blocks). */
export const LEXICON_SCHEMA_V3 = 'school.card-lexicon/v3';
export const LEXICON_SCHEMAS = Object.freeze([LEXICON_SCHEMA, LEXICON_SCHEMA_V3]);
const RETIRED_SCHEMAS = new Set(['school.word-lexicon/v1']);
/** An entry's side field → its side-neutral spelling. */
const SIDE_ALIASES = Object.freeze({ term: 'target', gloss: 'anchor' });
export const WORD_KINDS = Object.freeze(['word', 'phrase']);
export const DECOY_SIDES = Object.freeze(['term', 'gloss']);

/** Word ids, group slugs and package ids: one strict slug rule (also path-safe). */
export const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const MEDIA_PREFIX = 'media:';
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const fold = (value) => String(value).trim().toLocaleLowerCase();
const isMap = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** `media:<relative path>` → the relative path, refusing anything that could leave the root. */
export function parseMediaRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith(MEDIA_PREFIX)) return { ok: false, error: 'must start with media:' };
  const relative = ref.slice(MEDIA_PREFIX.length);
  if (!relative || relative.includes('\0') || relative.startsWith('/') || relative.includes('\\')) {
    return { ok: false, error: 'must be a relative path' };
  }
  if (relative.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')) {
    return { ok: false, error: 'must not contain empty, . or .. segments' };
  }
  return { ok: true, path: relative };
}

/** The package directory a `media:<dir>/lexicon.yml` reference names, or null. */
export function wordPackageDir(lexiconRef) {
  const parsed = parseMediaRef(lexiconRef);
  if (!parsed.ok || !parsed.path.endsWith('/lexicon.yml')) return null;
  return parsed.path.slice(0, -'/lexicon.yml'.length);
}

/**
 * Media is found by convention, never listed in the lexicon:
 * `<package dir>/words/<group>/<id>/{image.jpg, term.mp3, gloss.mp3}`. The
 * group is the course unit that introduced the word, so a package's word
 * folders stay grouped; status is keyed by id alone, so moving a word to
 * another group loses nothing.
 */
export function wordAssetIds(lexiconRef, word) {
  const dir = wordPackageDir(lexiconRef);
  if (!dir || !SLUG.test(word?.group ?? '') || !SLUG.test(word?.id ?? '')) {
    throw new Error(`no asset path for word '${word?.id}' in group '${word?.group}'`);
  }
  const base = `${MEDIA_PREFIX}${dir}/words/${word.group}/${word.id}`;
  return { image: `${base}/image.jpg`, audio: `${base}/term.mp3`, glossAudio: `${base}/gloss.mp3` };
}

function validateLanguage(value, at, errors) {
  if (!isMap(value)) { errors.push(`${at}: must be a mapping with code and name`); return null; }
  if (typeof value.code !== 'string' || !LANGUAGE_CODE.test(value.code)) errors.push(`${at}.code: must be a BCP-47 language code`);
  if (!text(value.name)) errors.push(`${at}.name: is required`);
  return { code: String(value.code ?? '').trim(), name: String(value.name ?? '').trim() };
}

function validateHeader(raw, errors) {
  if (!SLUG.test(raw.package ?? '')) errors.push('package: must be a lowercase slug');
  const v3 = raw.schema === LEXICON_SCHEMA_V3;
  const language = validateLanguage(v3 ? raw.target : raw.language, v3 ? 'target' : 'language', errors);
  const gloss = validateLanguage(v3 ? raw.anchor : raw.gloss, v3 ? 'anchor' : 'gloss', errors);
  const title = raw.program?.title;
  if (!text(title)) errors.push('program.title: is required');
  const quiz = raw.quiz ?? {};
  if (!isMap(quiz)) errors.push('quiz: must be a mapping');
  if (quiz.topics !== undefined && (!Array.isArray(quiz.topics) || quiz.topics.length === 0 || !quiz.topics.every(text))) {
    errors.push('quiz.topics: must be a non-empty list of text');
  }
  if (quiz.instructions !== undefined && !text(quiz.instructions)) errors.push('quiz.instructions: must be text');
  const programTitle = text(title) ? title.trim() : '';
  return {
    package: raw.package,
    language,
    gloss,
    targetLanguage: language,
    anchorLanguage: gloss,
    targetScript: scriptFor(language?.code),
    program: { title: programTitle },
    quiz: {
      topics: Array.isArray(quiz.topics) && quiz.topics.every(text)
        ? quiz.topics.map((topic) => topic.trim())
        : [language?.name?.toLocaleLowerCase() ?? '', 'vocabulary'],
      instructions: text(quiz.instructions)
        ? quiz.instructions.trim()
        : `Not sure of a word? Open ${programTitle} on the Portal and review the cards, then come back.`,
    },
  };
}

/**
 * One entry with `target:`/`anchor:` (and `decoys.target`/`decoys.anchor`)
 * folded into the internal `term`/`gloss` names. Both spellings at once must
 * agree — a lexicon that says two different things about one side is an error.
 */
function withSideNames(entry, at, errors) {
  const out = { ...entry };
  const decoys = isMap(entry.decoys) ? { ...entry.decoys } : entry.decoys;
  for (const [side, alias] of Object.entries(SIDE_ALIASES)) {
    if (entry[alias] !== undefined) {
      if (entry[side] !== undefined && String(entry[side]).trim() !== String(entry[alias]).trim()) {
        errors.push(`${at}: ${side} and ${alias} name the same side and must agree`);
      }
      out[side] = entry[alias];
    }
    if (isMap(decoys) && decoys[alias] !== undefined) {
      if (decoys[side] !== undefined) errors.push(`${at}.decoys: give ${side} or ${alias}, not both`);
      decoys[side] = decoys[alias];
      delete decoys[alias];
    }
    delete out[alias];
  }
  if (decoys !== undefined) out.decoys = decoys;
  return out;
}

/** Raw YAML → `{ errors, lexicon: { package, language, gloss, program, quiz, entries: Map } }`. */
export function validateLexicon(raw) {
  const errors = [];
  if (!isMap(raw)) return { errors: ['lexicon must be a mapping'] };
  if (RETIRED_SCHEMAS.has(raw.schema)) {
    return {
      errors: [`${raw.schema} is no longer read: migrate to ${LEXICON_SCHEMA} (entry fields term/gloss, `
        + 'decoys.term/decoys.gloss, a group per entry, and package/language/gloss/program headers)'],
    };
  }
  if (!LEXICON_SCHEMAS.includes(raw.schema)) errors.push(`schema must be ${LEXICON_SCHEMA} or ${LEXICON_SCHEMA_V3}`);
  const header = validateHeader(raw, errors);
  if (!Array.isArray(raw.entries) || raw.entries.length === 0) {
    errors.push('entries must be a non-empty list');
    return { errors };
  }
  const entries = new Map();
  raw.entries.forEach((rawEntry, index) => {
    const at = `entries[${index}]`;
    if (!isMap(rawEntry)) { errors.push(`${at}: must be a mapping`); return; }
    const entry = withSideNames(rawEntry, at, errors);
    if (!SLUG.test(entry.id ?? '')) { errors.push(`${at}.id: must be a lowercase slug`); return; }
    if (entries.has(entry.id)) { errors.push(`${at}.id: duplicates '${entry.id}'`); return; }
    if (!SLUG.test(entry.group ?? '')) errors.push(`${at}.group: must be a lowercase slug (the course unit that introduced the word)`);
    if (!WORD_KINDS.includes(entry.kind)) errors.push(`${at}.kind: must be word or phrase`);
    if (!text(entry.term)) errors.push(`${at}.term: is required`);
    if (!text(entry.gloss)) errors.push(`${at}.gloss: is required`);
    if (entry.kind === 'phrase' && !text(entry.pronunciation)) errors.push(`${at}.pronunciation: is required for a phrase`);
    else if (entry.pronunciation != null && !text(entry.pronunciation)) errors.push(`${at}.pronunciation: must be text or null`);
    const decoys = {};
    for (const side of DECOY_SIDES) {
      const list = entry.decoys?.[side];
      if (!Array.isArray(list) || list.length < 3 || !list.every(text)) {
        errors.push(`${at}.decoys.${side}: needs at least 3 non-empty entries`);
        decoys[side] = [];
        continue;
      }
      if (new Set(list.map(fold)).size !== list.length) errors.push(`${at}.decoys.${side}: must be unique`);
      if (text(entry[side]) && list.some((decoy) => fold(decoy) === fold(entry[side]))) {
        errors.push(`${at}.decoys.${side}: must not contain the answer '${entry[side]}'`);
      }
      decoys[side] = list.map((decoy) => decoy.trim());
    }
    entries.set(entry.id, {
      id: entry.id,
      kind: entry.kind,
      group: entry.group,
      term: String(entry.term ?? '').trim(),
      gloss: String(entry.gloss ?? '').trim(),
      pronunciation: text(entry.pronunciation) ? entry.pronunciation.trim() : null,
      decoys,
    });
  });
  // "Phrase decoys only from phrases": a decoy that IS another in-set entry
  // must be of the same kind, so a check never pits a phrase against a word.
  const owners = { term: new Map(), gloss: new Map() };
  for (const candidate of entries.values()) {
    owners.term.set(fold(candidate.term), candidate);
    owners.gloss.set(fold(candidate.gloss), candidate);
  }
  for (const candidate of entries.values()) {
    for (const side of DECOY_SIDES) {
      for (const decoy of candidate.decoys[side]) {
        const other = owners[side].get(fold(decoy));
        if (other && other.id !== candidate.id && other.kind !== candidate.kind) {
          errors.push(`entry '${candidate.id}': decoy '${decoy}' is the ${other.kind} '${other.id}' — decoys must be the same kind`);
        }
      }
    }
  }
  if (errors.length) return { errors };
  return { errors: [], lexicon: { ...header, entries } };
}

export function isLexiconDeck(raw) {
  return Boolean(raw) && typeof raw === 'object' && Array.isArray(raw.words) && typeof raw.lexicon === 'string';
}

/** A lexicon deck → the same deck with ordinary `cards`. `words`/`lexicon` are kept. */
export function expandLexiconDeck(raw, lexicon) {
  if (!isLexiconDeck(raw)) return { errors: ['deck is not a lexicon deck (needs lexicon and words)'] };
  const entries = lexicon?.entries;
  const errors = [];
  if (raw.cards !== undefined) errors.push('a lexicon deck must not also author cards');
  if (!wordPackageDir(raw.lexicon)) errors.push(`lexicon '${raw.lexicon}' must be a media:<dir>/lexicon.yml reference`);
  if (raw.words.length === 0) errors.push('words must not be empty');
  const seen = new Set();
  raw.words.forEach((wordId, index) => {
    if (seen.has(wordId)) errors.push(`words[${index}]: duplicates '${wordId}'`);
    seen.add(wordId);
    if (!entries?.has?.(wordId)) errors.push(`words[${index}]: '${wordId}' is not in the lexicon`);
  });
  if (errors.length) return { errors };
  const cards = raw.words.map((wordId) => {
    const entry = entries.get(wordId);
    const assets = wordAssetIds(raw.lexicon, entry);
    return {
      cardId: wordId,
      front: {
        blocks: [
          { type: 'image', assetId: assets.image, alt: entry.gloss },
          { type: 'text', text: entry.term },
          { type: 'audio', assetId: assets.audio, transcript: entry.term },
        ],
      },
      back: {
        blocks: [
          { type: 'text', text: entry.gloss },
          ...(entry.kind === 'phrase' ? [{ type: 'text', text: entry.pronunciation }] : []),
        ],
      },
    };
  });
  return { errors: [], deck: { ...raw, cards } };
}
