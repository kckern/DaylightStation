/**
 * BookRecord — the one shape every provider answers in.
 *
 * ## THE MODEL IS THE UNION, NOT THE INTERSECTION
 *
 * If a single vendor knows something useful, it gets a field here and everyone
 * else stubs it. Narrowing to what all providers share would throw away the
 * best thing each one has: OpenLibrary's character list (`subject_people` —
 * Aslan, Mr. Tumnus, Jadis) is what makes a comprehension quiz possible at all,
 * and no other source carries it. Google's `categories`, BiblioCommons'
 * `format` and `libraryRecordId`, a catalogue's `series`/`seriesVolume` — each
 * is one vendor's strength, and each is worth more than the symmetry lost by
 * having other adapters leave it null.
 *
 * The intended consequence: **after a record crosses an adapter boundary, the
 * only way to tell which provider produced it is which fields came back
 * filled.** No shapes, no envelopes, no provider-flavoured strings.
 *
 * ## NORMALISING IS THE ADAPTER'S JOB, AND THIS IS WHAT IT NORMALISES TO
 *
 * Providers disagree about shape as much as content, and every one of those
 * disagreements is settled before it reaches here — a list where another gives
 * a scalar, a `{type, value}` wrapper where another gives a bare string, a MARC
 * series line (`'The Chronicles of Narnia -- bk. 2'`) that has to become
 * `series: 'The Chronicles of Narnia'` plus `seriesVolume: 2`. This module
 * enforces only the last mile of that: lists are lists, scalars are scalars,
 * and anything empty is `null`.
 *
 * ## EMPTY IS `null`, ALWAYS
 *
 * `0` and `''` are normalised away, because a falsy stand-in that survives into
 * a merge OUTRANKS a real value from a lower-precedence source. Google returned
 * `pageCount: 0` for two of three books measured on 2026-09-02 that OpenLibrary
 * knew the length of; had that 0 counted as an answer, the shelf's progress bar
 * would have been dead for those books with nothing logged anywhere.
 *
 * Layer: DOMAIN (2_domains/books). Imports nothing.
 *
 * @module domains/books/BookRecord
 */

/** Fields holding a list. Everything else in the model is a scalar. */
const LIST_FIELDS = Object.freeze([
  'authors', 'subjects', 'people', 'places', 'excerpts', 'categories', 'isbn10s',
]);

/** Scalar fields, grouped by which provider taught us to want them. */
const SCALAR_FIELDS = Object.freeze([
  // Identity
  'isbn13', 'isbn10', 'title', 'subtitle', 'publisher', 'publishedYear', 'pageCount',
  'language', 'description', 'coverUrl',
  // OpenLibrary
  'olWorkKey', 'olEditionKey', 'wikipediaUrl',
  // Google Books
  'googleVolumeId',
  // Catalogue / MARC
  'series', 'seriesVolume',
  // BiblioCommons
  'libraryRecordId', 'format',
  // Ratings, carried by OpenLibrary and Google alike
  'averageRating', 'ratingCount',
]);

/** Every field of the model, in a stable order. */
export const BOOK_RECORD_FIELDS = Object.freeze([...SCALAR_FIELDS, ...LIST_FIELDS]);

/**
 * Which source wins which field, best first. MEASURED 2026-09-02, not guessed.
 *
 * OpenLibrary leads on identity because Google's first hit lands on packaging
 * variants — "Charlotte's Web Book and Charm", "The Lion, the Witch and the
 * Wardrobe (rack)" — and because Google returned `pageCount: 0` for two of
 * three books while OpenLibrary was right every time. Page count draws the
 * progress bar, so that is not a cosmetic difference.
 *
 * Google leads on description, which is the entire reason it is in the chain:
 * it had a real one for all three test books, including the long-tail *Guys
 * from Space*, where OpenLibrary's only came from a second work-record fetch.
 *
 * A field with no entry here, or a source not named for it, falls back to
 * argument order. That is deliberate: an unlisted provider must still be able
 * to contribute rather than being silently ignored.
 */
const FIELD_PRECEDENCE = Object.freeze({
  title: ['openlibrary', 'googlebooks'],
  subtitle: ['openlibrary', 'googlebooks'],
  authors: ['openlibrary', 'googlebooks'],
  pageCount: ['openlibrary', 'googlebooks'],
  coverUrl: ['openlibrary', 'googlebooks'],
  description: ['googlebooks', 'openlibrary'],
  categories: ['googlebooks'],
});

const isBlank = (value) => value === null || value === undefined
  || (typeof value === 'string' && value.trim() === '')
  || (typeof value === 'number' && value === 0);

/** Trim strings; drop anything empty to null. */
function normaliseScalar(value) {
  if (isBlank(value)) return null;
  return typeof value === 'string' ? value.trim() : value;
}

/** Keep order, drop blanks, de-duplicate. */
function normaliseList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const item = normaliseScalar(entry);
    if (item === null) continue;
    const key = typeof item === 'string' ? item : JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Build a complete record from whatever one adapter knows.
 *
 * @param {object} fields - the adapter's values, plus a required `source`
 * @returns {Readonly<object>} every field of the model, stubbed where unknown
 */
export function createBookRecord(fields = {}) {
  const { source, sources, ...rest } = fields ?? {};
  const provenance = Array.isArray(sources) ? normaliseList(sources)
    : (normaliseScalar(source) ? [normaliseScalar(source)] : []);
  if (provenance.length === 0) {
    // Provenance is not decoration: the precedence table is keyed on it, and a
    // sourceless record would merge as an unnamed provider that can never win
    // a field and can never be explained afterwards.
    throw new TypeError('createBookRecord requires a source');
  }
  const record = { sources: Object.freeze(provenance) };
  for (const field of SCALAR_FIELDS) record[field] = normaliseScalar(rest[field]);
  for (const field of LIST_FIELDS) record[field] = Object.freeze(normaliseList(rest[field]));
  return Object.freeze(record);
}

/**
 * Combine one book's records from several providers into one.
 *
 * Never branches on a provider name — by this point nothing provider-shaped is
 * left to branch on. It consults one declarative table and otherwise takes the
 * first non-empty value in argument order.
 *
 * @param {Array<object|null|undefined>} records
 * @returns {Readonly<object>|null} null when nothing was supplied
 */
export function mergeBookRecords(records = []) {
  const present = (Array.isArray(records) ? records : []).filter(Boolean);
  if (present.length === 0) return null;

  const sources = [];
  for (const record of present) {
    for (const source of record.sources ?? []) {
      if (!sources.includes(source)) sources.push(source);
    }
  }

  const merged = { sources };

  for (const field of SCALAR_FIELDS) {
    merged[field] = pickScalar(present, field);
  }
  for (const field of LIST_FIELDS) {
    // Lists UNION rather than winning outright: two providers each holding half
    // an author list, or half a character list, should not shadow each other.
    const ordered = orderForField(present, field);
    merged[field] = ordered.flatMap((record) => record[field] ?? []);
  }

  return createBookRecord(merged);
}

/** Records ordered by this field's precedence, then by argument order. */
function orderForField(records, field) {
  const preference = FIELD_PRECEDENCE[field];
  if (!preference) return records;
  return [...records].sort((left, right) => rank(left, preference) - rank(right, preference));
}

/**
 * A record's position in a field's preference list. An unlisted source sorts
 * after every listed one but keeps its relative argument order, because
 * `Array.prototype.sort` is stable — so an unknown provider contributes rather
 * than being dropped.
 */
function rank(record, preference) {
  let best = Number.MAX_SAFE_INTEGER;
  for (const source of record.sources ?? []) {
    const index = preference.indexOf(source);
    if (index !== -1 && index < best) best = index;
  }
  return best;
}

function pickScalar(records, field) {
  for (const record of orderForField(records, field)) {
    const value = record[field];
    if (!isBlank(value)) return value;
  }
  return null;
}

export default createBookRecord;
