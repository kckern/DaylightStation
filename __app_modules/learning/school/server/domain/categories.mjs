/**
 * Closed pedagogy categories (spec §3). Deliberately less configurable than
 * an earlier draft: which Plex roots are material, what medium, which
 * pedagogy each gets, and the pass marks are all still config — only
 * *inventing a new pedagogy shape* is a code change, and there are three,
 * all stable. This removes a whole failure class (a broken combination
 * becomes inexpressible) rather than validating against it. No I/O, no Date.
 */
export const CATEGORIES = {
  // Sequenced, gated, credited. Shakespeare Tales, Art Lessons.
  course: {
    sequential: true,
    gated: true,                      // an unsatisfied gate locks the next unit
    completion: ['played', 'gate'],   // ALL listed conditions must hold
    credit: { coins: true, curriculum: true }
  },
  // Look-it-up material. Cliff notes. Resume works; nothing is recorded.
  reference: {
    sequential: false,
    gated: false,
    completion: [],
    credit: { coins: false, curriculum: false }
  },
  // In-order listening/watching. Records "finished", earns nothing, but plays
  // SEQUENTIALLY by default — every episode after the first is locked until the
  // previous is watched (no quiz gate, unlike `course`). This is the sensible
  // default for a show/program (a Bible video series, an audiobook): don't skip
  // ahead. `reference` remains the free-browse escape hatch.
  listening: {
    sequential: true,
    gated: false,
    completion: ['played'],
    credit: { coins: false, curriculum: false }
  }
};

/**
 * Fail-closed, but loudly (spec §3 "Fail-closed, but loudly"). An omitted or
 * unrecognised `category` resolves to `reference` — no gate, no credit — so a
 * config slip makes material inert rather than silently ungated-and-credited.
 * A typo'd category therefore cannot silently become credited work.
 *
 * @param {string} name - the configured category value (may be missing/unknown)
 * @returns {{ key: string, def: object }}
 */
export function resolveCategory(name) {
  if (Object.prototype.hasOwnProperty.call(CATEGORIES, name)) {
    return { key: name, def: CATEGORIES[name] };
  }
  return { key: 'reference', def: CATEGORIES.reference };
}
