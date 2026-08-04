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
 *     answerSpace?: { minPt, maxPt } }
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
