// Pure ranking helpers for a school subject shelf: order items so started
// work surfaces first, then well-fit fresh work, with finished work sunk to
// the bottom. NO React, NO I/O, NO clock reads — `now` is always a parameter.
//
// The grade ladder mirrors `backend/src/2_domains/school/grades.mjs` but is
// NOT imported from it — frontend/backend module boundary.

export const GRADES = ['early', 'lower', 'upper', 'middle', 'high', 'ap'];

/** Ascending ladder index, or -1 if unknown/absent. */
export function gradeRank(tier) {
  return GRADES.indexOf(String(tier ?? '').toLowerCase());
}

/**
 * Map a birth year to a ladder tier, given the current year.
 * US school year ≈ (now - year - 5), Kindergarten = 0. Then bucketed to a tier.
 * @param {number} year - birth year
 * @param {number} now  - current year (passed in; never read a clock here)
 * @returns {string} one of GRADES
 */
export function gradeFromBirthyear(year, now) {
  const schoolYear = now - year - 5;
  if (schoolYear <= 1) return 'early';
  if (schoolYear <= 3) return 'lower';
  if (schoolYear <= 5) return 'upper';
  if (schoolYear <= 8) return 'middle';
  if (schoolYear <= 12) return 'high';
  return 'ap';
}

/**
 * Order items: started (by lastActivity desc) → fresh (by grade-fit asc, stable)
 * → done (last). Pure — returns a NEW array, does not mutate items or progress.
 * @param {Array<{id:string, minGrade?:string}>} items
 * @param {{ progress?: Array, studentGrade?: string|null }} opts
 * @returns {Array} the same item objects, reordered
 */
export function rankWithin(items, { progress = [], studentGrade = null } = {}) {
  const byId = new Map(progress.map((p) => [p.materialId, p]));

  const started = [];
  const fresh = [];
  const done = [];

  items.forEach((item, index) => {
    const p = byId.get(item.id);
    const isDone = !!(p && p.unitTotal > 0 && p.unitsDone >= p.unitTotal);
    if (isDone) {
      done.push({ item, index });
    } else if (p) {
      started.push({ item, index, progress: p });
    } else {
      fresh.push({ item, index });
    }
  });

  started.sort((a, b) =>
    String(b.progress.lastActivity ?? '').localeCompare(String(a.progress.lastActivity ?? ''))
  );

  if (studentGrade != null) {
    const studentRank = gradeRank(studentGrade);
    const dist = (item) => {
      if (item.minGrade == null) return 0;
      const r = gradeRank(item.minGrade);
      if (r === -1) return Infinity;
      return Math.abs(r - studentRank);
    };
    fresh.sort((a, b) => {
      const diff = dist(a.item) - dist(b.item);
      if (diff !== 0) return diff;
      return a.index - b.index;
    });
  }
  // else: guest / unknown age — skip grade-fit, keep fresh in original order.

  return [
    ...started.map((s) => s.item),
    ...fresh.map((f) => f.item),
    ...done.map((d) => d.item),
  ];
}
