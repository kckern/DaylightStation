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
function reflow(pageFragments, contentTopPt, spacing, leadingFillPt = 0) {
  let cursor = contentTopPt;
  let previousClass = null;
  for (const fragment of pageFragments) {
    if (fragment.fillAfter === true && leadingFillPt > 0) {
      cursor += leadingFillPt;
      leadingFillPt = 0;
    }
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

  // A generated mastery sheet can explicitly ask for balanced question
  // rhythm. Once real answer spaces have taken their share, distribute any
  // remaining page height like CSS `space-around`: half a share before the
  // first marked question, a full share between questions, and half a share
  // after the last question.
  let leadingFillPt = 0;
  if (sparePt > EPSILON) {
    const flexible = pageFragments.filter((fragment) => fragment.fillAfter === true);
    if (flexible.length) {
      const share = sparePt / flexible.length;
      leadingFillPt = share / 2;
      flexible.slice(0, -1).forEach((fragment) => { fragment.heightPt += share; });
      sparePt = 0;
    }
  }

  reflow(pageFragments, contentTopPt, spacing, leadingFillPt);
}

/**
 * BALANCED SPILL (household rule, spec appendix: "we're not just having a
 * dangling question number 10 at the end" — equal vertical FILL across
 * pages, never equal question count). `placeFragments`'s ordinary loop
 * below is first-fit: pack page one to capacity, whatever doesn't fit
 * starts page two. For an atomic-fragment document (every `question` block
 * is one unbreakable unit — measure.mjs's own "a page break can never land
 * between a question and the space to answer it") that produces exactly the
 * shape the household rejected: 9 questions on page one with 1.5in of
 * unclaimed white space, question 10 alone on page two. First-fit only ever
 * asks "does the NEXT item fit here" — it never looks back to ask whether
 * moving one more item from a fuller page to page two would leave both
 * pages closer to even.
 *
 * These three helpers are the pure math for `placeFragments`'s `balance`
 * option: given `items` (an ALREADY atomic, already-normalized fragment
 * list — see that option's own precondition check, just below), find where
 * to break them into contiguous groups so the TALLEST group is as short as
 * possible. Minimizing the tallest group is the well-known equivalent of
 * "make every group even": for a fixed total height and a fixed group
 * count, pushing the max down can only happen by moving content off the
 * fullest group, which pulls every other group up toward it — there is no
 * way to lower the max without narrowing the spread. It's solved by binary
 * search on the answer (the candidate per-page cap) validated by a
 * monotonic greedy bin-count (a bigger cap never needs MORE bins) — the
 * classic "split into k parts, minimize the largest part" technique.
 *
 * NEVER attempted on anything but a fully-atomic list (`placeFragments`
 * checks this before calling in): a flowable (`lines`-bearing) fragment can
 * still SPLIT mid-fragment under the ordinary loop below, at a wrap point
 * only `chooseBreakPoint`/`splitFragment` know how to find; teaching this
 * balance search to also reason about line-level splits would mean
 * re-deriving that same split point by a second, independent path — exactly
 * the "fit decision computed one way, drawn another" class of bug this
 * codebase's own doctrine forbids elsewhere (measure.mjs's header comment).
 * A `stickToNextId` pair or an authored `page_break` are excluded for the
 * identical reason: both already have their own placement rule (keep-with-
 * next, unconditional break) that this search does not know how to honor.
 * Whenever any of that is present, `placeFragments` simply skips balancing
 * and falls back to the ordinary greedy result — never a worse or invalid
 * page count, only a missed opportunity to even it out.
 */

/** The gap `items[index]` would pay if placed right after `items[index - 1]` on the SAME page (0 for index 0 — nothing precedes it — and, by the same rule `gapBetween` already applies, 0 for whatever starts a fresh group/page). */
function leadingGapPt(items, index, spacing) {
  if (index <= 0) return 0;
  return gapBetween(spacing, items[index - 1].spacingClass, items[index].spacingClass);
}

/**
 * How many contiguous groups `items` needs if no group's content may exceed
 * `capPt` — the SAME "pack until it doesn't fit, start a new page" rule
 * `placeFragments`'s own loop applies below, just counting instead of
 * placing. `Infinity` when a single item alone (zero leading gap, since it
 * could always start its own group) still exceeds `capPt` — no cap that low
 * could ever place it, which is what makes the search below stop shrinking
 * `capPt` any further.
 */
function groupsNeededForCap(items, spacing, capPt) {
  let groups = 1;
  let usedPt = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.heightPt > capPt + EPSILON) return Infinity;
    const gapPt = usedPt === 0 ? 0 : leadingGapPt(items, index, spacing);
    if (usedPt + gapPt + item.heightPt > capPt + EPSILON) {
      groups += 1;
      usedPt = item.heightPt;
    } else {
      usedPt += gapPt + item.heightPt;
    }
  }
  return groups;
}

/** The same greedy fill as `groupsNeededForCap`, returning WHERE each new group starts instead of just how many there are — the index (into `items`) of the first item of every group after the first. */
function breakIndicesForCap(items, spacing, capPt) {
  const breaks = [];
  let usedPt = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const gapPt = usedPt === 0 ? 0 : leadingGapPt(items, index, spacing);
    if (usedPt + gapPt + item.heightPt > capPt + EPSILON) {
      breaks.push(index);
      usedPt = item.heightPt;
    } else {
      usedPt += gapPt + item.heightPt;
    }
  }
  return breaks;
}

/**
 * Minimal per-page cap that still packs `items` into exactly `targetGroups`
 * contiguous groups, never exceeding the hard page budget `capPt` — see this
 * section's header comment for why minimizing the largest group is the same
 * thing as balancing them. `targetGroups` is expected to be
 * `groupsNeededForCap(items, spacing, capPt)` (the page count the document
 * would ALREADY need at full capacity) — the search only ever tightens that
 * same cap, it never asks for fewer pages than the budget already forces.
 *
 * Returns `null` when `items` cannot be packed into `targetGroups` groups at
 * all within `capPt` (should not happen when `targetGroups` was derived from
 * `capPt` itself, but `placeFragments` treats `null` as "give up, fall back
 * to the plain greedy placement" rather than ever trusting an unproven
 * partition) or when the search's own result doesn't land on exactly
 * `targetGroups` groups.
 */
function balancedBreakIndices(items, spacing, capPt, targetGroups) {
  if (targetGroups <= 1 || items.length === 0) return [];
  let lo = items.reduce((max, item) => Math.max(max, item.heightPt), 0);
  let hi = capPt;
  if (groupsNeededForCap(items, spacing, hi) > targetGroups) return null;
  // Float bisection (a page is ~700pt tall), not an integer search — a fixed
  // iteration count is the correct exit condition, not a `lo === hi` check
  // that float rounding could miss forever.
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const mid = (lo + hi) / 2;
    if (groupsNeededForCap(items, spacing, mid) <= targetGroups) hi = mid; else lo = mid;
  }
  const breaks = breakIndicesForCap(items, spacing, hi);
  return breaks.length === targetGroups - 1 ? breaks : null;
}

/** Splice a zero-height `forceBreak` marker (the same shape measure.mjs's `page_break` block already produces) in front of `fragments[index]` for every index in `breakIndices` — reusing `placeFragments`'s EXISTING unconditional-break handling is what lets balanced placement share every other rule (answer-space growth, widow/orphan minima, errors) with the ordinary path instead of re-implementing them. */
function insertBreakMarkers(fragments, breakIndices) {
  const breakSet = new Set(breakIndices);
  const result = [];
  fragments.forEach((fragment, index) => {
    if (breakSet.has(index)) {
      result.push({
        id: `balance-break-before-${index}`,
        blocks: [],
        atomic: true,
        spacingClass: null,
        widthPt: fragment.widthPt ?? 0,
        nodes: [],
        heightPt: 0,
        baseHeightPt: 0,
        forceBreak: true,
        answerSpace: null,
      });
    }
    result.push(fragment);
  });
  return result;
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
 * @param {boolean} [page.balance=false] - Fit policy `prefer-one-page`'s
 *   spill case (spec appendix, `fit.mjs`'s `balanceSpill`): when true AND
 *   the whole fragment list is atomic with no `stickToNextId`/`forceBreak`
 *   (see this file's "BALANCED SPILL" section above for exactly why those
 *   are excluded), a document that would still spill across N pages is
 *   re-partitioned for even vertical fill across those N pages instead of
 *   first-fit's "pack page one solid, dump the rest." Ineligible content
 *   (any flowable/splittable fragment, a keep-with-next pair, an authored
 *   page_break) or a document that already fits on one page silently
 *   behaves exactly as `false` — this option can only ever make a spilled
 *   render more even, never change WHETHER it spills or reject a document
 *   the ordinary loop would have accepted.
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

export function placeFragments(fragments, {
  pageHeightPt, marginPt, spacing = {}, growLastPage = false, balance = false,
}) {
  const contentTopPt = marginPt;
  const contentBottomPt = pageHeightPt - marginPt;
  if (!(contentBottomPt - contentTopPt > 0)) {
    throw new Error(`page geometry leaves no content height: ${pageHeightPt}pt page, ${marginPt}pt margins`);
  }

  // Balanced spill (see this file's "BALANCED SPILL" section above): decided
  // BEFORE normal placement runs, by measuring the SAME `fragments` list a
  // second, throwaway time (a discarded `errors` sink — real validation
  // errors are collected once, below, off whichever list actually gets
  // placed). Eligibility is deliberately narrow: every fragment must already
  // be atomic with no keep-with-next partner and no authored page break, or
  // this silently falls back to `source = fragments` and behaves exactly as
  // `balance: false` — a missed opportunity to even out a spill is a far
  // safer failure mode than mis-placing content this search does not
  // understand how to split.
  let source = fragments;
  if (balance) {
    const preview = fragments.map((fragment) => normalizeFragment(fragment, []));
    const capPt = contentBottomPt - contentTopPt;
    const eligible = preview.length > 0
      && preview.every((fragment) => fragment.atomic && !fragment.forceBreak && !fragment.stickToNextId);
    if (eligible) {
      const targetGroups = groupsNeededForCap(preview, spacing, capPt);
      if (Number.isFinite(targetGroups) && targetGroups > 1) {
        const breaks = balancedBreakIndices(preview, spacing, capPt, targetGroups);
        if (breaks) source = insertBreakMarkers(fragments, breaks);
      }
    }
  }

  const errors = [];
  const queue = source.map((fragment) => normalizeFragment(fragment, errors));
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
