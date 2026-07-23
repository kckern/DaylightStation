/**
 * The nine subject shelves — the organizing principle of the School home
 * (spec: 2026-07-22-school-nine-subjects-design). The home grid is these
 * nine, always, in this order (row-major on the 3×3 wall); content flows
 * INTO them via a `subject:` field on materials sources (school.yml) and
 * bank YAMLs. The shelf list is fixed in code because it is the school's
 * curriculum shape, not a data artifact — a new shelf is a curriculum
 * decision, not a config edit.
 *
 * Every shelf is a PAIR (X & Y) — one tile, two allied strands. Boundaries
 * that look close but aren't: `english` is our language and its works (vocab,
 * grammar, reading fluency, the canon), `writing` is composition plus the
 * portal's typing rungs, `language` is foreign languages, `arts` is fine arts
 * (draw/sing/play) where `skills` is hands-on practical life (cook/make/do).
 *
 * `subject` is deliberately a different field from banks' free-form `topics`
 * tags ([geography, us-states]) — one is a curriculum shelf, the other is
 * search metadata; conflating them would make every tag a shelf.
 */

export const SUBJECTS = [
  // Row-major on the 3×3 wall. Anchors (per household layout): Math & Money
  // top-right, Scripture & Gospel dead centre, Language & Culture bottom-left,
  // Life & Skills bottom-centre; the rest fill the remaining cells.
  { id: 'english', label: 'English & Literature', hint: 'Reading, grammar, and great books' },
  { id: 'writing', label: 'Writing & Typing', hint: 'Put it in your own words' },
  { id: 'math', label: 'Math & Money', hint: 'Numbers, patterns, and money' },
  { id: 'science', label: 'Science & Nature', hint: 'How the world and nature work' },
  { id: 'scripture', label: 'Scripture & Gospel', hint: 'Scriptures, stories, and faith' },
  { id: 'history', label: 'History & Geography', hint: 'People, places, and the past' },
  { id: 'language', label: 'Language & Culture', hint: 'Hear it, say it, write it' },
  { id: 'skills', label: 'Life & Skills', hint: 'Hands-on — cooking, making, life' },
  { id: 'arts', label: 'Art & Music', hint: 'Draw, paint, sing, and play' },
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
