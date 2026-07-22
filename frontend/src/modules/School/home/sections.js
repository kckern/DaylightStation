/**
 * Built-in School sections (spec §8). This list is the home grid, and it is
 * deliberately short: 2a ships built-ins only. Category sections (Courses,
 * Reference, Listening) join as sub-project 2b delivers their endpoints, and
 * Games/Writing as their sub-projects land — a tile must never point at an
 * absent endpoint.
 */
// `progress` is deliberately ABSENT. It is the cross-learner board — parent
// instrumentation — and its own hint was written in the third person ("who is
// studying what"). A child's progress surface is their home card, not a tile
// that shows them beside their siblings. Adults reach it from their own home
// (see LearnerHome); the section id still routes, it just is not on the wall.
export const SECTIONS = [
  { id: 'banks', label: 'Practice', hint: 'Quizzes and flashcards' },
];

// Hints for catalog-driven category sections (spec §2b). A category with no
// entry here still renders -- just without a hint line, same as any SECTIONS
// tile that omits `hint`.
const CATEGORY_HINTS = {
  course: 'Watch, listen, and pass the quiz',
  reference: 'Look things up',
  listening: 'Stories and audiobooks',
};

/**
 * Builds the full home grid: built-in sections first, then one tile per
 * catalog section (`GET /api/v1/school/materials`'s `sections` array), then
 * one per language course (`GET /api/v1/school/language/courses`).
 *
 * Language courses are data-driven for the same reason a tile never points at
 * an absent endpoint: the corpus is a file on the media mount, and until it is
 * ingested there is no course to open. An empty list simply adds no tiles.
 *
 * @param {Array<{category:string,label:string}>} catalogSections
 * @param {Array<{id:string,label:string,languages?:{source:string,target:string}}>} [courses]
 * @returns {Array<{id:string,label:string,hint?:string}>}
 */
export function sectionsFromCatalog(catalogSections, courses) {
  const mapped = (catalogSections || []).map((s) => ({
    id: `cat:${s.category}`,
    label: s.label,
    hint: CATEGORY_HINTS[s.category],
  }));
  // No `EN → KR` hint: language codes are a config field, and a six-year-old
  // cannot parse an arrow between two two-letter codes on a wall panel.
  const language = (courses || []).map((c) => ({
    id: `lang:${c.id}`,
    label: c.label,
    hint: 'Listen, say it, write it',
  }));
  return [...SECTIONS, ...mapped, ...language];
}
