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
  // Freestyle listening (retires R9). Records "finished", earns nothing.
  listening: {
    sequential: false,
    gated: false,
    completion: ['played'],
    credit: { coins: false, curriculum: false }
  }
};

/**
 * Fail-closed, but loudly (spec §3 "Fail-closed, but loudly"). An omitted or
 * unrecognised `category` resolves to `reference` — no gate, no credit — so a
 * config slip makes material inert rather than silently ungated-and-credited.
 * The unrecognised value is logged, naming the source, so the typo is
 * discoverable instead of silent (a typo'd `category: coures` would otherwise
 * serve a whole course ungated and uncredited, with no quiz evidence
 * collected to reconstruct later).
 *
 * @param {string} name - the configured category value (may be missing/unknown)
 * @param {object} opts
 * @param {object} opts.logger - structured logger; `warn` is called on fallback
 * @param {string} opts.sourceLabel - the source's configured label, for the warning
 * @returns {{ key: string, def: object }}
 */
export function resolveCategory(name, { logger, sourceLabel } = {}) {
  if (Object.prototype.hasOwnProperty.call(CATEGORIES, name)) {
    return { key: name, def: CATEGORIES[name] };
  }
  logger?.warn?.('school.materials.category-unknown', { source: sourceLabel, category: name });
  return { key: 'reference', def: CATEGORIES.reference };
}
