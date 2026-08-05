/**
 * Measured page layout for school documents.
 *
 * Pure arithmetic: measurement arrives as data (fragment heights, line heights)
 * so placement is testable without a PDF context. Nothing here draws, fetches,
 * or knows what a block contains.
 *
 * A fragment:
 *   { id, blocks, heightPt, atomic, spacingClass,
 *     lines?: [{ heightPt }], minLinesBeforeBreak?, minLinesAfterBreak?,
 *     answerSpace?: { minPt, maxPt }, stickToNextId?: string }
 *
 * `stickToNextId` (F4, review finding) is keep-with-next affinity: when set,
 * this fragment refuses to place on a page unless the fragment immediately
 * following it in the queue (matched by `id`) ALSO fits right after it on
 * that same page — otherwise both move to the next page together. Used by
 * short_answer/essay's prompt fragment so it can never strand on one page
 * while its own write-space fragment lands on the next.
 *
 * Placement errors (an atomic taller than a page, a contradictory answer space)
 * are returned, not thrown: publish-time validation consumes them so a document
 * fails review rather than printing broken.
 */

/** Tolerance for "exactly fills the remaining space" against float measurement. */
const EPSILON = 1e-9;

const DEFAULT_MIN_LINES_BEFORE_BREAK = 2;
const DEFAULT_MIN_LINES_AFTER_BREAK = 2;

const sumHeights = (items) => items.reduce((total, item) => total + item.heightPt, 0);

function gapBetween(spacing, previousClass, nextClass) {
  if (previousClass === null) return 0;
  return spacing?.[previousClass]?.[nextClass] ?? 0;
}

/**
 * Resolves the height a fragment occupies before any answer-space growth, and
 * collects authoring errors that placement itself cannot fix.
 */
function normalizeFragment(fragment, errors) {
  const { lines, answerSpace } = fragment;
  let heightPt = fragment.heightPt;

  if (Array.isArray(lines)) {
    // Lines are the measurement of record for a flowable fragment; a supplied
    // heightPt cannot stay consistent once the fragment splits.
    heightPt = sumHeights(lines);
  } else if (answerSpace) {
    heightPt = Math.max(heightPt ?? 0, answerSpace.minPt);
  }

  if (answerSpace && answerSpace.maxPt < answerSpace.minPt) {
    errors.push({
      id: fragment.id,
      code: 'answer-space-range-inverted',
      message: `answer space '${fragment.id}' declares maxPt below minPt`,
    });
  }

  return { ...fragment, heightPt, isContinuation: false, continuesOnNextPage: false };
}

/** How many leading lines fit in `availablePt`. */
function countFittingLines(lines, availablePt) {
  let used = 0;
  let count = 0;
  for (const line of lines) {
    if (used + line.heightPt > availablePt + EPSILON) break;
    used += line.heightPt;
    count += 1;
  }
  return count;
}

/**
 * Lines to leave on the earlier page, or 0 when no acceptable break exists.
 * Widow/orphan minima are relaxed on an empty page — there is no earlier page
 * to push to, and dropping the fragment would lose content.
 */
function chooseBreakPoint(fragment, availablePt, pageIsEmpty) {
  const { lines } = fragment;
  const minBefore = fragment.minLinesBeforeBreak ?? DEFAULT_MIN_LINES_BEFORE_BREAK;
  const minAfter = fragment.minLinesAfterBreak ?? DEFAULT_MIN_LINES_AFTER_BREAK;
  const fitting = countFittingLines(lines, availablePt);

  const allowed = Math.min(fitting, lines.length - minAfter);
  if (allowed >= minBefore) return allowed;
  if (pageIsEmpty && fitting >= 1) return Math.min(fitting, lines.length - 1);
  return 0;
}

function splitFragment(fragment, linesBefore) {
  const head = fragment.lines.slice(0, linesBefore);
  const tail = fragment.lines.slice(linesBefore);
  return [
    { ...fragment, lines: head, heightPt: sumHeights(head), continuesOnNextPage: true },
    { ...fragment, lines: tail, heightPt: sumHeights(tail), isContinuation: true },
  ];
}

function overflowError(fragment) {
  return {
    id: fragment.id,
    code: 'fragment-exceeds-page',
    message: fragment.atomic
      ? `atomic fragment '${fragment.id}' exceeds page height`
      : `fragment '${fragment.id}' exceeds page height and cannot be split`,
  };
}

/** Re-runs the vertical walk after answer spaces have grown. */
function reflow(pageFragments, contentTopPt, spacing) {
  let cursor = contentTopPt;
  let previousClass = null;
  for (const fragment of pageFragments) {
    cursor += gapBetween(spacing, previousClass, fragment.spacingClass);
    fragment.yPt = cursor;
    cursor += fragment.heightPt;
    previousClass = fragment.spacingClass;
  }
}

/**
 * Grows the page's answer spaces into its trailing free space, evenly, each
 * capped at its own maxPt, with the remainder re-shared among those still below
 * their cap.
 */
function distributeAnswerSpace(pageFragments, contentTopPt, contentBottomPt, spacing) {
  const last = pageFragments[pageFragments.length - 1];
  let sparePt = contentBottomPt - (last.yPt + last.heightPt);
  if (sparePt <= EPSILON) return;

  let growable = pageFragments
    .filter((fragment) => fragment.answerSpace)
    .map((fragment) => ({ fragment, headroomPt: fragment.answerSpace.maxPt - fragment.heightPt }))
    .filter((entry) => entry.headroomPt > EPSILON);

  while (sparePt > EPSILON && growable.length > 0) {
    const share = sparePt / growable.length;
    let consumed = 0;
    const stillGrowable = [];
    for (const entry of growable) {
      const growth = Math.min(share, entry.headroomPt);
      entry.fragment.heightPt += growth;
      entry.headroomPt -= growth;
      consumed += growth;
      if (entry.headroomPt > EPSILON) stillGrowable.push(entry);
    }
    if (consumed <= EPSILON) break;
    sparePt -= consumed;
    growable = stillGrowable;
  }

  reflow(pageFragments, contentTopPt, spacing);
}

/**
 * Places fragments onto pages.
 *
 * @param {Array<Object>} fragments - Measured fragments, in document order.
 * @param {Object} page
 * @param {number} page.pageHeightPt - Full page height.
 * @param {number} page.marginPt - Top and bottom margin.
 * @param {Object} [page.spacing] - spacing[prevClass][nextClass] gap table; an
 *   unconfigured pair means no gap.
 * @param {boolean} [page.growLastPage=false] - Fit policy `fill` (spec §7):
 *   when true, the LAST page also participates in answer-space/spacer growth.
 *   Default false reproduces the engine's original behavior byte-for-byte —
 *   "trailing space on the last page belongs to the document, not the
 *   answers" — which `flow` and `one-page` still rely on.
 * @returns {{ pages: Array<{ fragments: Array<Object> }>, errors: Array<Object> }}
 *   Each placed fragment carries yPt (absolute page coordinate of its top), its
 *   effective heightPt, and isContinuation/continuesOnNextPage split flags.
 */
/**
 * The height this fragment list would occupy as ONE unbroken flow — no page
 * boundaries, no answer-space growth. This is `RenderPrintDocument`'s (Task
 * 8) building block for fit policy `one-page`'s `oversetPt` (spec §7): how
 * far a document that overflowed a real page would have exceeded a single
 * page's budget, regardless of how `placeFragments` actually broke it up.
 *
 * Reuses the exact same normalization (`normalizeFragment`) and gap lookup
 * (`gapBetween`) `placeFragments` itself walks with, so this number and a real
 * placement can never silently disagree about what one fragment costs.
 *
 * `forceBreak` fragments (a `page_break` block) are skipped and reset the
 * running spacing class to null — the same "first fragment on a fresh page"
 * rule real placement applies — rather than contributing a gap that would
 * never actually print across a page boundary.
 *
 * @param {Array<Object>} fragments - measured fragments, in document order
 * @param {Object} [opts]
 * @param {Object} [opts.spacing] - spacing[prevClass][nextClass] gap table
 * @returns {number} total height in points
 */
export function contentHeightPt(fragments, { spacing = {} } = {}) {
  const errors = [];
  let total = 0;
  let previousClass = null;
  for (const fragment of fragments) {
    const normalized = normalizeFragment(fragment, errors);
    if (normalized.forceBreak) { previousClass = null; continue; }
    total += gapBetween(spacing, previousClass, normalized.spacingClass);
    total += normalized.heightPt;
    previousClass = normalized.spacingClass;
  }
  return total;
}

export function placeFragments(fragments, { pageHeightPt, marginPt, spacing = {}, growLastPage = false }) {
  const contentTopPt = marginPt;
  const contentBottomPt = pageHeightPt - marginPt;
  if (!(contentBottomPt - contentTopPt > 0)) {
    throw new Error(`page geometry leaves no content height: ${pageHeightPt}pt page, ${marginPt}pt margins`);
  }

  const errors = [];
  const queue = fragments.map((fragment) => normalizeFragment(fragment, errors));
  const pages = [];

  let pageFragments = [];
  let cursor = contentTopPt;
  let previousClass = null;

  const startNewPage = () => {
    pages.push({ fragments: pageFragments });
    pageFragments = [];
    cursor = contentTopPt;
    previousClass = null;
  };

  while (queue.length > 0) {
    const fragment = queue.shift();
    const pageIsEmpty = pageFragments.length === 0;

    if (fragment.forceBreak) {
      // A `page_break` block (measure.mjs) — a zero-height marker, not
      // content. It ends the page unconditionally (no fit check) and is then
      // dropped rather than placed, so it never occupies a fragment slot and
      // its own spacingClass:null never enters a gap calculation: the next
      // fragment starts a fresh page, where the first-of-page gap is already
      // unconditionally 0 for any spacingClass (see gapBetween above). An
      // empty page is a no-op — consecutive/leading/trailing breaks collapse
      // rather than producing blank pages.
      if (!pageIsEmpty) startNewPage();
      continue;
    }

    const gapPt = gapBetween(spacing, previousClass, fragment.spacingClass);
    const availablePt = contentBottomPt - cursor - gapPt;

    if (fragment.heightPt <= availablePt + EPSILON) {
      // Keep-with-next (F4, review finding): a fragment tagged `stickToNextId`
      // (short_answer/essay's prompt, measure.mjs) must never be stranded on
      // this page while the fragment it names — its own write-space, which
      // `queue[0]` always is, since the two are built and queued back-to-back
      // — gets bumped whole to the next one. Only relevant when THIS fragment
      // fits on its own (the branch we're already in); if it didn't fit, it
      // falls through to the normal split/move-whole handling below and its
      // partner tags along right after it on whichever page it lands on.
      // Skipped on an empty page: there is no earlier page to defer to, and
      // forcing a restart here would either loop forever (nothing fits
      // anywhere) or just delay the identical decision this same fragment
      // faces again immediately, now with pageIsEmpty true.
      if (fragment.stickToNextId && !pageIsEmpty) {
        const partner = queue[0];
        if (partner && partner.id === fragment.stickToNextId) {
          const cursorAfterFragment = cursor + gapPt + fragment.heightPt;
          const gapToPartner = gapBetween(spacing, fragment.spacingClass, partner.spacingClass);
          const partnerAvailablePt = contentBottomPt - cursorAfterFragment - gapToPartner;
          if (partner.heightPt > partnerAvailablePt + EPSILON) {
            queue.unshift(fragment);
            startNewPage();
            continue;
          }
        }
      }
      fragment.yPt = cursor + gapPt;
      cursor = fragment.yPt + fragment.heightPt;
      previousClass = fragment.spacingClass;
      pageFragments.push(fragment);
      continue;
    }

    if (Array.isArray(fragment.lines) && !fragment.atomic) {
      const linesBefore = chooseBreakPoint(fragment, availablePt, pageIsEmpty);
      if (linesBefore >= 1) {
        const [head, tail] = splitFragment(fragment, linesBefore);
        head.yPt = cursor + gapPt;
        pageFragments.push(head);
        queue.unshift(tail);
        startNewPage();
        continue;
      }
    }

    if (pageIsEmpty) {
      // Does not fit a full page and cannot be split — never split it silently.
      errors.push(overflowError(fragment));
      continue;
    }

    queue.unshift(fragment);
    startNewPage();
  }

  if (pageFragments.length > 0) pages.push({ fragments: pageFragments });

  // Trailing space on the last page belongs to the document, not the
  // answers — UNLESS `growLastPage` (fit policy `fill`) asks the last page to
  // bottom out too, in which case it grows exactly like every other page.
  const pagesToGrow = growLastPage ? pages : pages.slice(0, -1);
  for (const finished of pagesToGrow) {
    distributeAnswerSpace(finished.fragments, contentTopPt, contentBottomPt, spacing);
  }

  return { pages, errors };
}
