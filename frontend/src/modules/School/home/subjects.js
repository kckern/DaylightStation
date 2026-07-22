/**
 * The six subject shelves — the organizing principle of the School home
 * (spec: 2026-07-22-school-home-topics-redesign). The home grid is these six,
 * always, in this order; content flows INTO them via a `subject:` field on
 * materials sources (school.yml) and bank YAMLs. The shelf list is fixed in
 * code because it is the school's curriculum shape, not a data artifact — a
 * new shelf is a curriculum decision, not a config edit.
 *
 * `subject` is deliberately a different field from banks' free-form `topics`
 * tags ([geography, us-states]) — one is a curriculum shelf, the other is
 * search metadata; conflating them would make every tag a shelf.
 */

export const SUBJECTS = [
  { id: 'reading', label: 'Reading', hint: 'Stories and books' },
  { id: 'civilization', label: 'Civilization', hint: 'People, places, and the past' },
  { id: 'language', label: 'Language', hint: 'Hear it, say it, write it' },
  { id: 'math', label: 'Math', hint: 'Numbers and patterns' },
  { id: 'science', label: 'Science', hint: 'How the world works' },
  { id: 'writing', label: 'Writing', hint: 'Put it in your own words' },
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
