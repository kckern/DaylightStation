/**
 * Bounded leniency for multi-mark rows (2026-08-22 policy, print-documents.md
 * §5.4).
 *
 * A child who erases one bubble and fills another often leaves enough graphite
 * for the reader to see both. That is an eraser, not a guess, and it used to
 * cost the whole question AND stall the sheet in the review queue. Two marks
 * with one correct is credited; anything that looks like shotgunning is not:
 *
 *   1. Exactly two marks, one of them correct -> full credit (the eraser
 *      signature).
 *   2. Three or more marks never earn credit. Neither does a two-mark row
 *      where BOTH marks are wrong.
 *   3. Marks covering EVERY available choice never earn credit, regardless of
 *      count — this is what stops a true/false row (2 choices) from being
 *      auto-credited by rule 1: marking both options IS marking everything.
 *   4. At most `max(1, floor(rowCount / 5))` credited rows per sheet
 *      (`leniencyCap` below) — rows beyond the cap fall through to the
 *      review queue exactly as an ordinary ambiguous row does today.
 *   5. Cap spend order is by question number (the caller's job — see
 *      `ResolveCardScan.mjs`'s `applyLeniency`), so it is deterministic and
 *      the earliest rows get the benefit.
 *   6. Strictness is archetype-driven: `worksheet` is lenient, `quiz` and
 *      `infopage` are strict (cap 0) — low-stakes work is generous, a real
 *      quiz is not.
 */
const LENIENT_ARCHETYPES = new Set(['worksheet']);

/**
 * Does this multi-mark row read as an eraser signature? `given` is the raw
 * decoded letters for the row (spec §5.4); `correctLetter` is the letter the
 * answer key expects (see `ResolveCardScan.mjs`'s `correctLetterFor`, the
 * inverse of `letterToChoice`) — `null`/`undefined` when it can't be derived,
 * which this function treats as "never credit" rather than guessing.
 */
export function creditsAsEraser({ item, given, correctLetter } = {}) {
  if (!Array.isArray(given) || given.length !== 2) return false;
  if (!correctLetter) return false;
  const choiceCount = Number(item?.choiceCount) || 0;
  // Marking every choice is marking everything — never an eraser (rule 3).
  if (choiceCount > 0 && given.length >= choiceCount) return false;
  return given.includes(correctLetter);
}

/**
 * Per-sheet credit budget (rule 4/6). `archetype` outside `worksheet` (i.e.
 * `quiz`, `infopage`, or anything unrecognised) is strict — cap 0, no
 * promotion ever runs.
 */
export function leniencyCap({ archetype, rowCount } = {}) {
  if (!LENIENT_ARCHETYPES.has(archetype)) return 0;
  const rows = Number(rowCount) || 0;
  if (rows <= 0) return 0;
  return Math.max(1, Math.floor(rows / 5));
}

export default { creditsAsEraser, leniencyCap };
