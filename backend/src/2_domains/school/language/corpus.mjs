/**
 * Corpus validation (design §2). Pure: no I/O.
 *
 * A corpus is a list of sentences, each carrying its text in every language
 * the course binds, plus the role→code binding itself. Text is keyed BY
 * LANGUAGE CODE rather than by fixed `en:`/`kr:` fields, so every language
 * pair has the identical shape and the domain reads target text as
 * `text[languages.target]`.
 *
 * Validation is strict and fails the whole file, not per-sentence. A corpus
 * with holes would produce a ladder that silently skips sentences, and a
 * learner would have no way to tell that from having finished them.
 */

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const LANG_RE = /^[A-Za-z]{2,8}$/;

/**
 * @param {object} raw - parsed YAML
 * @returns {{ok: boolean, corpus?: object, errors?: string[]}}
 */
export function validateCorpus(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['corpus is empty or not a mapping'] };
  }

  if (!ID_RE.test(String(raw.id ?? ''))) errors.push('id must be alphanumeric with - or _');

  const languages = raw.languages ?? {};
  const source = languages.source;
  const target = languages.target;
  if (!LANG_RE.test(String(source ?? ''))) errors.push('languages.source must be a language code');
  if (!LANG_RE.test(String(target ?? ''))) errors.push('languages.target must be a language code');
  if (source && target && source === target) {
    // Not pedantry: identical roles would make `interpretation` ask the
    // learner to translate a sentence into the language it is already in.
    errors.push('languages.source and languages.target must differ');
  }

  if (!Array.isArray(raw.sentences) || raw.sentences.length === 0) {
    errors.push('sentences must be a non-empty list');
    return { ok: false, errors };
  }

  const seen = new Set();
  raw.sentences.forEach((sentence, i) => {
    const where = `sentences[${i}]`;
    const seq = Number(sentence?.seq);
    if (!Number.isInteger(seq) || seq < 1) {
      errors.push(`${where}: seq must be a positive integer`);
      return;
    }
    if (seen.has(seq)) {
      // A duplicate would make the ladder ambiguous — two different texts
      // would answer to one log event.
      errors.push(`${where}: duplicate seq ${seq}`);
      return;
    }
    seen.add(seq);

    const text = sentence?.text;
    if (!text || typeof text !== 'object') {
      errors.push(`${where}: text must be a mapping keyed by language code`);
      return;
    }
    for (const code of [source, target]) {
      if (!code) continue;
      if (typeof text[code] !== 'string' || text[code].trim() === '') {
        errors.push(`${where}: missing text for ${code}`);
      }
    }
  });

  if (errors.length) return { ok: false, errors };

  const sentences = raw.sentences
    .map((s) => ({ seq: Number(s.seq), text: { ...s.text } }))
    .sort((a, b) => a.seq - b.seq);

  return {
    ok: true,
    corpus: {
      id: String(raw.id),
      label: String(raw.label ?? raw.id),
      languages: { source: String(source), target: String(target) },
      audioBase: raw.audio_base ? String(raw.audio_base) : null,
      sentences,
      // The ladder admits new material by scanning 1..size, so the highest seq
      // is the ceiling — not the count, which would strand the tail whenever
      // the corpus has gaps.
      size: sentences[sentences.length - 1].seq,
    },
  };
}

/**
 * Index a validated corpus for O(1) lookup by sequence number.
 * @returns {Map<number, {seq: number, text: object}>}
 */
export function indexBySeq(corpus) {
  return new Map(corpus.sentences.map((s) => [s.seq, s]));
}
