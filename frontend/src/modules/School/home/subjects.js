/**
 * The nine subject shelves — the organizing principle of the School home
 * (spec: 2026-07-22-school-nine-subjects-design). The home grid is these
 * nine, always, in this order (row-major on the 3×3 wall); content flows
 * INTO them via a `subject:` field on materials sources (school.yml) and
 * bank YAMLs. The shelf list is fixed in code because it is the school's
 * curriculum shape, not a data artifact — a new shelf is a curriculum
 * decision, not a config edit.
 *
 * Boundaries that look close but aren't: `english` is the SKILL of our
 * language (vocab, grammar, reading fluency), `literature` is the WORKS
 * (canon, regardless of medium), `writing` is composition, `language` is
 * foreign languages. A book shelved because it's at the child's level is
 * English; shelved because everyone should know it, Literature.
 *
 * `subject` is deliberately a different field from banks' free-form `topics`
 * tags ([geography, us-states]) — one is a curriculum shelf, the other is
 * search metadata; conflating them would make every tag a shelf.
 */

export const SUBJECTS = [
  { id: 'english', label: 'English', hint: 'Vocabulary, grammar, and reading' },
  { id: 'literature', label: 'Literature', hint: 'Great stories and classics' },
  { id: 'writing', label: 'Writing', hint: 'Put it in your own words' },
  { id: 'math', label: 'Math & Money', hint: 'Numbers, patterns, and money' },
  { id: 'science', label: 'Science', hint: 'How the world works' },
  { id: 'skills', label: 'Skills', hint: 'Hands-on — art, cooking, making' },
  { id: 'history', label: 'History', hint: 'People and the past' },
  { id: 'geography', label: 'Geography', hint: 'Places, maps, and the world' },
  { id: 'language', label: 'Language', hint: 'Hear it, say it, write it' },
];

const SUBJECT_IDS = new Set(SUBJECTS.map((s) => s.id));

/**
 * Shelve the catalogues. Rules (spec §grouping):
 *  1. `category: 'reference'` material → Library, always — reference is for
 *     looking things up, even when a subject is stamped on it.
 *  2. Known `subject` → that shelf; unknown/missing → Library.
 *  3. Banks: same, with Library banks forming the Practice group.
 *  4. Language courses (Glossika) → `language`, unconditionally.
 *
 * @param {{materials?: Array, banks?: Array, courses?: Array}} input
 * @returns {{bySubject: Object<string,{materials:Array,banks:Array,courses:Array}>, library: {materials:Array, banks:Array}}}
 */
export function groupBySubject({ materials, banks, courses } = {}) {
  const bySubject = Object.fromEntries(
    SUBJECTS.map((s) => [s.id, { materials: [], banks: [], courses: [] }]),
  );
  const library = { materials: [], banks: [] };

  for (const m of materials ?? []) {
    if (m.category !== 'reference' && SUBJECT_IDS.has(m.subject)) {
      bySubject[m.subject].materials.push(m);
    } else {
      library.materials.push(m);
    }
  }

  for (const b of banks ?? []) {
    if (SUBJECT_IDS.has(b.subject)) bySubject[b.subject].banks.push(b);
    else library.banks.push(b);
  }

  for (const c of courses ?? []) {
    bySubject.language.courses.push(c);
  }

  return { bySubject, library };
}

/** True when a subject shelf has anything on it. */
export function subjectHasContent(shelf) {
  return Boolean(shelf && (shelf.materials.length || shelf.banks.length || shelf.courses.length));
}

export function subjectLabel(id) {
  return SUBJECTS.find((s) => s.id === id)?.label ?? id;
}
