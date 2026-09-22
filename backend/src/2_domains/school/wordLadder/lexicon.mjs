/**
 * Word lexicon for the word ladder (Korean vocab design, "Data model"). Pure.
 *
 * A lexicon is authored once per word package on the media mount and names
 * every word's Korean, English, kind and quiz decoys. A weekly deck lists word
 * ids only; `expandLexiconDeck` turns it into ordinary flashcard cards BEFORE
 * `validateFlashcardDeck` sees it, so every existing deck consumer works on it.
 */
export const LEXICON_SCHEMA = 'school.word-lexicon/v1';
export const WORD_KINDS = Object.freeze(['word', 'phrase']);

const WORD_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MEDIA_PREFIX = 'media:';
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const fold = (value) => String(value).trim().toLocaleLowerCase();

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

/** Media is found by convention, never listed in the lexicon. */
export function wordAssetIds(lexiconRef, wordId) {
  const dir = wordPackageDir(lexiconRef);
  const base = `${MEDIA_PREFIX}${dir}/words/${wordId}`;
  return { image: `${base}/image.jpg`, audio: `${base}/ko.mp3`, englishAudio: `${base}/en.mp3` };
}

export function validateLexicon(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { errors: ['lexicon must be a mapping'] };
  if (raw.schema !== LEXICON_SCHEMA) errors.push(`schema must be ${LEXICON_SCHEMA}`);
  if (!Array.isArray(raw.entries) || raw.entries.length === 0) {
    errors.push('entries must be a non-empty list');
    return { errors };
  }
  const entries = new Map();
  raw.entries.forEach((entry, index) => {
    const at = `entries[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { errors.push(`${at}: must be a mapping`); return; }
    if (!WORD_ID.test(entry.id ?? '')) { errors.push(`${at}.id: must be a lowercase slug`); return; }
    if (entries.has(entry.id)) { errors.push(`${at}.id: duplicates '${entry.id}'`); return; }
    if (!WORD_KINDS.includes(entry.kind)) errors.push(`${at}.kind: must be word or phrase`);
    if (!text(entry.korean)) errors.push(`${at}.korean: is required`);
    if (!text(entry.english)) errors.push(`${at}.english: is required`);
    if (entry.kind === 'phrase' && !text(entry.pronunciation)) errors.push(`${at}.pronunciation: is required for a phrase`);
    else if (entry.pronunciation != null && !text(entry.pronunciation)) errors.push(`${at}.pronunciation: must be text or null`);
    const decoys = {};
    for (const side of ['korean', 'english']) {
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
      korean: String(entry.korean ?? '').trim(),
      english: String(entry.english ?? '').trim(),
      pronunciation: text(entry.pronunciation) ? entry.pronunciation.trim() : null,
      decoys,
    });
  });
  // "Phrase decoys only from phrases": a decoy that IS another in-set entry
  // must be of the same kind, so a check never pits a phrase against a word.
  const owners = { korean: new Map(), english: new Map() };
  for (const candidate of entries.values()) {
    owners.korean.set(fold(candidate.korean), candidate);
    owners.english.set(fold(candidate.english), candidate);
  }
  for (const candidate of entries.values()) {
    for (const side of ['korean', 'english']) {
      for (const decoy of candidate.decoys[side]) {
        const other = owners[side].get(fold(decoy));
        if (other && other.id !== candidate.id && other.kind !== candidate.kind) {
          errors.push(`entry '${candidate.id}': decoy '${decoy}' is the ${other.kind} '${other.id}' — decoys must be the same kind`);
        }
      }
    }
  }
  if (errors.length) return { errors };
  return { errors: [], entries };
}

export function isLexiconDeck(raw) {
  return Boolean(raw) && typeof raw === 'object' && Array.isArray(raw.words) && typeof raw.lexicon === 'string';
}

/** A lexicon deck → the same deck with ordinary `cards`. `words`/`lexicon` are kept. */
export function expandLexiconDeck(raw, entries) {
  if (!isLexiconDeck(raw)) return { errors: ['deck is not a lexicon deck (needs lexicon and words)'] };
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
    const assets = wordAssetIds(raw.lexicon, wordId);
    return {
      cardId: wordId,
      front: {
        blocks: [
          { type: 'image', assetId: assets.image, alt: entry.english },
          { type: 'text', text: entry.korean },
          { type: 'audio', assetId: assets.audio, transcript: entry.korean },
        ],
      },
      back: {
        blocks: [
          { type: 'text', text: entry.english },
          ...(entry.kind === 'phrase' ? [{ type: 'text', text: entry.pronunciation }] : []),
        ],
      },
    };
  });
  return { errors: [], deck: { ...raw, cards } };
}
