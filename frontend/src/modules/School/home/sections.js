/**
 * Built-in School sections (spec §8). This list is the home grid, and it is
 * deliberately short: 2a ships built-ins only. Category sections (Courses,
 * Reference, Listening) join as sub-project 2b delivers their endpoints, and
 * Games/Writing as their sub-projects land — a tile must never point at an
 * absent endpoint.
 */
export const SECTIONS = [
  { id: 'banks', label: 'Quizzes & Flashcards', hint: 'Practice sets and tests' },
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
 * catalog section (`GET /api/v1/school/materials`'s `sections` array).
 *
 * @param {Array<{category:string,label:string}>} catalogSections
 * @returns {Array<{id:string,label:string,hint?:string}>}
 */
export function sectionsFromCatalog(catalogSections) {
  const mapped = (catalogSections || []).map((s) => ({
    id: `cat:${s.category}`,
    label: s.label,
    hint: CATEGORY_HINTS[s.category],
  }));
  return [...SECTIONS, ...mapped];
}
