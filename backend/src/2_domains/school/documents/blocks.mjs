/**
 * Pure validation of the document block set (spec §3.3). No I/O.
 *
 * The block set is CLOSED — same posture as question item types and metric
 * kinds: inventing a block is a code change, never config. A renderer exists
 * for every member, so an unrecognised type has no way to reach paper and is
 * rejected here rather than silently dropped mid-layout.
 *
 * Only structure is checked. Spec shapes for plot/geometry, Markdown grammar,
 * and asset resolution belong to the renderer and its catalog — deep-checking
 * them here would duplicate the layout engine in the domain layer.
 *
 * Errors are reported at a dotted path (`blocks[0].blocks[1]: <message>`), the
 * one notation used across the whole document error list.
 */
import { SHUFFLE_KEY_PATTERN } from './shuffle.mjs';

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isPositiveNumber = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isNonEmptyStringArray = (v) => Array.isArray(v) && v.length > 0 && v.every(isNonEmptyString);
const isShuffleKey = (v) => isNonEmptyString(v) && SHUFFLE_KEY_PATTERN.test(v);
const validTaxonomy = (value) => value && typeof value === 'object' && !Array.isArray(value)
  && ['subject', 'course', 'unit', 'lesson'].every((field) => isNonEmptyString(value[field]));
const keyError = (field) => `${field} must be a non-empty string matching ${SHUFFLE_KEY_PATTERN}`;
const sourceOnlyError = (field) => `${field} is a source-only field and must not appear in a published document`;
// The mirror image of sourceOnlyError (Task 3, spec §3): `itemRef` is the
// publish transform's OWN output field — it points at the derived-bank item
// that carries the answer this field used to hold inline. A hand-authored
// SOURCE document has no derived bank yet (publish hasn't run), so `itemRef`
// there can only be a stale/forged reference, never a legitimate one.
const publishedOnlyError = (field) => `${field} must not appear in a source document (it is stamped by publish, once a derived bank exists)`;

// \require is MathJax's browser-only lazy package loader. Server-side every
// package is preloaded, and the macro renders as literal red error text on the
// printed page (found in the math rendering spike). It is banned in every field
// that reaches the math renderer — rich_text carries inline math to the same
// place as a math block. TeX tolerates space before the argument brace.
const REQUIRE_MACRO = /\\require\s*\{/;
const requireError = (field) => `${field} must not use \\require{} (server rendering loads all packages)`;

/**
 * Types the `inset` box path (`1_rendering/school/documents/measure.mjs`'s
 * `measureBoxNode`/`measureNodes`, and `DocumentPdfRenderer`'s `drawBox`)
 * cannot actually nest one level deep — audited against `measureNodes`'s
 * switch coverage rather than assumed:
 *
 * - `question` has NO case in `measureNodes` at all — it is only
 *   special-cased by `measureBlocks` at the document's TOP level (`if
 *   (block.type === 'question') return [questionFragment(...)]`), so a
 *   question nested in an inset used to validate clean and then throw
 *   `UnsupportedBlockError` at measure time.
 * - `page_break` DOES measure (a zero-height `forceBreak` marker), but the
 *   renderer's `drawNode` has no case for its `pageBreak` node kind, so it
 *   crashed the "Unreachable" default branch at DRAW time instead — a page
 *   break has no meaning inside a box that never spans a page boundary on
 *   its own.
 * - `plot`/`geometry` have no Letter renderer AT ALL yet (documented
 *   directly on `measureNodes`'s default case) — nested in an inset or not.
 * - `wordbank`/`matching`/`cloze` (Task 2) have NO `measureNodes` case
 *   either, yet — Task 4 lands their rendering — so today they fail the
 *   exact same literal-coverage test as `plot`/`geometry` above. But their
 *   v1 disposition here is an ARCHITECTURAL call, not just that current gap:
 *   even once Task 4 wires them up, each introduces a genuinely NEW node
 *   kind (a seeded-shuffle boxed term list, a two-column write-the-letter
 *   grid, fixed-width inline blank atoms inside flowing text) that doesn't
 *   reduce to a kind `measureBoxNode` already stacks — and the spec itself
 *   frames keyed/shuffled exam furniture inside an aside as "layout
 *   trouble" (§6.1). So they stay excluded here even after Task 4 lands,
 *   pending a real v2 of the box path.
 * - `short_answer`/`essay` (Task 2) ALSO have no `measureNodes` case yet —
 *   same literal gap — but the spec defines both as sugar over `prompt`
 *   text + `answer_space` (§4.2, §6.2), and BOTH of those primitives are
 *   already handled directly by `measureNodes` and already legal inside a
 *   box today (see the allow-list below). Once Task 4 wires their case to
 *   emit that exact node pair, nesting costs the box path nothing new — so
 *   they are deliberately left OFF this ban list rather than added
 *   defensively.
 *
 * Every other registered block type is either handled directly by
 * `measureNodes` (rich_text, math, asset, answer_space, omr_response,
 * media_action, scan_action, passage, figure, list, divider, spacer) or
 * already rejected by the inset-nesting check above (`inset`).
 */
const INSET_UNSUPPORTED_CHILD_TYPES = {
  question: 'inset blocks must not contain a question (a question is the exam atomic unit; insets are asides one level deep)',
  page_break: 'inset blocks must not contain a page_break (a box never spans a page boundary on its own)',
  plot: 'inset blocks must not contain a plot (no Letter renderer exists for plot yet)',
  geometry: 'inset blocks must not contain a geometry (no Letter renderer exists for geometry yet)',
  wordbank: 'inset blocks must not contain a wordbank (a seeded-shuffle boxed term set is keyed exam furniture; nesting a box inside a box is deferred to a v2 of the box path)',
  matching: 'inset blocks must not contain a matching (a seeded-shuffle write-the-letter grid is keyed exam furniture — same v1 disposition as wordbank)',
  cloze: 'inset blocks must not contain a cloze (fixed-width numbered blanks are keyed exam furniture — same v1 disposition as wordbank/matching)',
};

const specValidator = (type) => (raw, push) => {
  if (!raw.spec || typeof raw.spec !== 'object' || Array.isArray(raw.spec)) {
    push(`${type} spec must be an object`);
    return;
  }
  if (!isNonEmptyString(raw.spec.kind)) push(`${type} spec.kind must be a non-empty string`);
};

const actionValidator = (type) => (raw, push) => {
  if (!isNonEmptyString(raw.action)) push(`${type} action must be a non-empty string`);
  if (!isNonEmptyString(raw.label)) push(`${type} label must be a non-empty string`);
};

/**
 * `matching.pairs` (SOURCE-only): `[{left: idx|string, right: idx|string}]`.
 * Each side may reference its entry either by array index or by matching the
 * string value itself — an AI author naturally writes the latter. Validates
 * shape, that every reference resolves into `left`/`right`, that no `left`
 * entry is claimed twice, and that `pairs` is a COMPLETE cover of `left` (spec
 * §4.2's matching entry) — a matching item with an unanswered left entry has
 * no correct answer for the derived bank to hold.
 */
function validateMatchingPairs(raw, push) {
  if (!Array.isArray(raw.pairs) || raw.pairs.length === 0) {
    push('matching pairs must be a non-empty array when present');
    return;
  }
  const left = Array.isArray(raw.left) ? raw.left : [];
  const right = Array.isArray(raw.right) ? raw.right : [];
  const isRef = (v) => typeof v === 'string' || Number.isInteger(v);
  let shapeOk = true;
  raw.pairs.forEach((pair, i) => {
    if (!pair || typeof pair !== 'object' || Array.isArray(pair) || !isRef(pair.left) || !isRef(pair.right)) {
      push(`matching pairs[${i}] must be a mapping of {left: idx|string, right: idx|string}`);
      shapeOk = false;
    }
  });
  if (!shapeOk) return;

  const resolve = (ref, arr) => {
    if (Number.isInteger(ref) && ref >= 0 && ref < arr.length) return ref;
    if (typeof ref === 'string') { const i = arr.indexOf(ref); if (i !== -1) return i; }
    return null;
  };
  const leftIdx = raw.pairs.map((p) => resolve(p.left, left));
  const rightIdx = raw.pairs.map((p) => resolve(p.right, right));
  if (leftIdx.some((i) => i === null) || rightIdx.some((i) => i === null)) {
    push('matching pairs must reference entries present in left/right');
    return;
  }
  const coveredLeft = new Set(leftIdx);
  if (coveredLeft.size !== leftIdx.length) push('matching pairs must reference each left entry at most once');
  if (coveredLeft.size !== left.length) push('matching pairs must cover every left entry');
}

/**
 * Key order IS the block-type order (BLOCK_TYPES is derived from it below), so
 * a type can never be declared without a validator or validated without being
 * declared.
 */
const VALIDATORS = {
  rich_text(raw, push) {
    if (!isNonEmptyString(raw.md)) push('rich_text md must be a non-empty string');
    else if (REQUIRE_MACRO.test(raw.md)) push(requireError('rich_text md'));
  },
  math(raw, push) {
    if (!isNonEmptyString(raw.tex)) push('math tex must be a non-empty string');
    else if (REQUIRE_MACRO.test(raw.tex)) push(requireError('math tex'));
    if (raw.display !== undefined && typeof raw.display !== 'boolean') push('math display must be a boolean');
  },
  plot: specValidator('plot'),
  geometry: specValidator('geometry'),
  asset(raw, push) {
    if (!isNonEmptyString(raw.ref)) push('asset ref must be a non-empty string');
    // Alt doubles as the print caption, so it is required even though nothing
    // on paper reads it aloud.
    if (!isNonEmptyString(raw.alt)) push('asset alt must be a non-empty string');
  },
  question(raw, push, ctx) {
    // `points` overrides the envelope's `defaultPoints` (spec §6.1); legal on
    // either question shape below, so it is checked before the branch.
    if (raw.points !== undefined) {
      const pointsOk = typeof raw.points === 'number' && Number.isFinite(raw.points) && raw.points >= 0;
      if (!pointsOk) push('question points must be a number >= 0');
    }
    // `omr` flag (Task 2, spec §6.1): row-consumption gate for non-quiz
    // archetypes — `allocation.mjs`'s `planRows` reads this off the block
    // directly (`block.omr === true`), so it is legal on EITHER question
    // shape below (same reason `points` is checked up here, before the
    // bank-select branch). Validation only: the archetype-dependent default
    // (effectively true for a scored quiz item, false otherwise) is applied
    // by the row planner, not here.
    if (raw.omr !== undefined && typeof raw.omr !== 'boolean') push('question omr must be a boolean');
    if (raw.fillAfter !== undefined && typeof raw.fillAfter !== 'boolean') push('question fillAfter must be a boolean');
    // Bank-select sugar (spec §6.2): `{bankId, select, key, filter?}` REPLACES
    // the itemId/number/blocks shape below — it expands into a seeded list of
    // bank items at publish time (Task 5's job; this is shape-only). `select`
    // is the trigger field: its presence (not `bankId` alone, which resolution
    // needs but shape-checking doesn't gate on) means "this is sugar."
    if (raw.select !== undefined) {
      if (!isNonEmptyString(raw.bankId)) push('question bankId must be a non-empty string');
      if (!Number.isInteger(raw.select) || raw.select < 1) push('question select must be an integer >= 1');
      // Required-with-select: a bank-select block shuffles like wordbank/
      // matching (spec §4.3), so it needs the same document-unique key.
      if (!isShuffleKey(raw.key)) push(keyError('question key (required when select is present)'));
      if (raw.filter !== undefined) {
        if (!raw.filter || typeof raw.filter !== 'object' || Array.isArray(raw.filter)) {
          push('question filter must be a mapping when present');
        } else {
          if (raw.filter.topics !== undefined && !isNonEmptyStringArray(raw.filter.topics)) {
            push('question filter.topics must be an array of non-empty strings when present');
          }
          if (raw.filter.difficulty !== undefined && !isNonEmptyString(raw.filter.difficulty)) {
            push('question filter.difficulty must be a non-empty string when present');
          }
        }
      }
      return;
    }
    if (!isNonEmptyString(raw.itemId)) push('question itemId must be a non-empty string');
    if (!Number.isInteger(raw.number) || raw.number < 1) push('question number must be an integer >= 1');
    // `trueFalse` marker (Task 2, spec §5.3/§6.1): the explicit inline signal
    // that this question's answer is a true_false item, not multiple_choice/
    // short_answer/multi_select — chosen over inferring type from `typeof
    // answer === 'boolean'` because the answer field is banned/absent on a
    // published document (only the marker survives), and an explicit flag
    // reads the same in source and published form, same posture as essay's
    // `box` flag just above/below. `answer`'s own boolean shape and mutual
    // exclusivity with choices/answers are checked at publish time
    // (documentSource.mjs's pre-mint gate) — same deferral as
    // choices/answer/answers shape-checking for the other inline forms
    // (see documentSource.mjs's own doc comments).
    if (raw.trueFalse !== undefined && raw.trueFalse !== true) push('question trueFalse must be true when present');
    if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) {
      push('question blocks must be a non-empty array');
      return;
    }
    raw.blocks.forEach((child, i) => {
      const at = ctx.at ? `${ctx.at}.blocks[${i}]` : `blocks[${i}]`;
      // A question is the keep-together atomic (spec §4); nesting one inside
      // another has no page-break semantics, so it is rejected outright —
      // which is also what bounds this recursion's depth at one level.
      if (child && typeof child === 'object' && child.type === 'question') {
        ctx.errors.push(`${at}: question may not contain another question`);
        return;
      }
      validateInto(child, at, ctx.errors, ctx.allowAnswers);
    });
  },
  answer_space(raw, push) {
    const minOk = isPositiveNumber(raw.minPt);
    const maxOk = isPositiveNumber(raw.maxPt);
    if (!minOk) push('answer_space minPt must be a number > 0');
    if (!maxOk) push('answer_space maxPt must be a number > 0');
    if (minOk && maxOk && raw.minPt > raw.maxPt) push('answer_space minPt must be <= maxPt');
  },
  omr_response(raw, push) {
    if (!isNonEmptyString(raw.itemId)) push('omr_response itemId must be a non-empty string');
    // 2..8 is what a printed mark row can carry legibly at receipt width.
    if (!Number.isInteger(raw.choices) || raw.choices < 2 || raw.choices > 8) {
      push('omr_response choices must be an integer between 2 and 8');
    }
    if (raw.layout !== undefined && !['row', 'compact'].includes(raw.layout)) {
      push('omr_response layout must be row|compact when present');
    }
  },
  media_action: actionValidator('media_action'),
  scan_action(raw, push) {
    actionValidator('scan_action')(raw, push);
    // Optional decoration (a subject shelf icon id). Raster renderers draw it,
    // text renderers ignore it — so an unknown id degrades to no icon, and only
    // the SHAPE is validated here.
    if (raw.icon !== undefined && !isNonEmptyString(raw.icon)) {
      push('scan_action icon must be a non-empty string when present');
    }
    if (raw.presentation !== undefined && !['default', 'lesson', 'bulk_print'].includes(raw.presentation)) {
      push('scan_action presentation must be default|lesson|bulk_print when present');
    }
    if (raw.eyebrow !== undefined && !isNonEmptyString(raw.eyebrow)) {
      push('scan_action eyebrow must be a non-empty string when present');
    }
    if (raw.description !== undefined && !isNonEmptyString(raw.description)) {
      push('scan_action description must be a non-empty string when present');
    }
    if (raw.meta !== undefined && !isNonEmptyString(raw.meta)) {
      push('scan_action meta must be a non-empty string when present');
    }
    if (raw.taxonomy !== undefined && !validTaxonomy(raw.taxonomy)) {
      push('scan_action taxonomy requires non-empty subject, course, unit, and lesson strings');
    }
    if (raw.hideCode !== undefined && typeof raw.hideCode !== 'boolean') {
      push('scan_action hideCode must be a boolean when present');
    }
    if (raw.subjects !== undefined) {
      if (!Array.isArray(raw.subjects) || raw.subjects.length === 0
          || raw.subjects.some((s) => !isNonEmptyString(s))) {
        push('scan_action subjects must be a non-empty array of non-empty strings when present');
      }
    }
  },
  result_summary(raw, push) {
    if (!isNonEmptyString(raw.headline)) push('result_summary headline must be a non-empty string');
    if (!isNonEmptyString(raw.title)) push('result_summary title must be a non-empty string');
    if (raw.correctCount !== undefined && (!Number.isInteger(raw.correctCount) || raw.correctCount < 0)) {
      push('result_summary correctCount must be an integer >= 0 when present');
    }
    if (raw.totalCount !== undefined && (!Number.isInteger(raw.totalCount) || raw.totalCount < 1)) {
      push('result_summary totalCount must be an integer >= 1 when present');
    }
    if (Number.isInteger(raw.correctCount) && Number.isInteger(raw.totalCount)
        && raw.correctCount > raw.totalCount) push('result_summary correctCount must not exceed totalCount');
    if (raw.questionStart !== undefined && (!Number.isInteger(raw.questionStart) || raw.questionStart < 1)) {
      push('result_summary questionStart must be an integer >= 1 when present');
    }
    if (raw.marks !== undefined) {
      if (!Array.isArray(raw.marks) || !raw.marks.length || raw.marks.some((m) => typeof m !== 'boolean')) {
        push('result_summary marks must be a non-empty array of booleans when present');
      } else if (Number.isInteger(raw.totalCount) && raw.marks.length !== raw.totalCount) {
        push('result_summary marks length must equal totalCount when both are present');
      }
    }
    if (raw.percent !== undefined && (typeof raw.percent !== 'number' || !Number.isFinite(raw.percent))) {
      push('result_summary percent must be a finite number when present');
    }
    if (raw.passingPercent !== undefined && (typeof raw.passingPercent !== 'number'
        || !Number.isFinite(raw.passingPercent) || raw.passingPercent < 1 || raw.passingPercent > 100)) {
      push('result_summary passingPercent must be a number from 1-100 when present');
    }
    if (raw.icon !== undefined && !isNonEmptyString(raw.icon)) {
      push('result_summary icon must be a non-empty string when present');
    }
    for (const field of ['learnerName', 'date', 'time', 'studentNo']) {
      if (raw[field] !== undefined && !isNonEmptyString(raw[field])) {
        push(`result_summary ${field} must be a non-empty string when present`);
      }
    }
    if (raw.taxonomy !== undefined && !validTaxonomy(raw.taxonomy)) {
      push('result_summary taxonomy requires non-empty subject, course, unit, and lesson strings');
    }
    if (raw.reviewHints !== undefined && (!Array.isArray(raw.reviewHints)
        || !raw.reviewHints.length || raw.reviewHints.some((hint) => !isNonEmptyString(hint)))) {
      push('result_summary reviewHints must be a non-empty array of strings when present');
    }
    if (raw.progress !== undefined) {
      const rows = Array.isArray(raw.progress) ? raw.progress : [raw.progress];
      if (!rows.length || rows.some((progress) => !progress || typeof progress !== 'object'
          || Array.isArray(progress) || !isNonEmptyString(progress.label)
          || !Number.isInteger(progress.completed) || !Number.isInteger(progress.total)
          || progress.completed < 0 || progress.total < 1 || progress.completed > progress.total)) {
        push('result_summary progress requires one or more rows with a label and integers 0 <= completed <= total');
      }
    }
  },
  /**
   * The agenda's finished-work tally: one strip naming every subject already
   * served today. Receipt-only — it exists to keep completed subjects off the
   * page's headline stack, a problem no Letter document has.
   */
  done_summary(raw, push) {
    if (!isNonEmptyString(raw.label)) push('done_summary label must be a non-empty string');
    if (!Array.isArray(raw.entries) || raw.entries.length === 0) {
      push('done_summary entries must be a non-empty array');
      return;
    }
    raw.entries.forEach((entry, i) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        push(`done_summary entries[${i}] must be a mapping`);
        return;
      }
      if (!isNonEmptyString(entry.subject)) push(`done_summary entries[${i}].subject must be a non-empty string`);
      if (entry.icon !== undefined && !isNonEmptyString(entry.icon)) {
        push(`done_summary entries[${i}].icon must be a non-empty string when present`);
      }
      if (entry.titles !== undefined && !(Array.isArray(entry.titles) && entry.titles.every(isNonEmptyString))) {
        push(`done_summary entries[${i}].titles must be an array of non-empty strings when present`);
      }
      if (entry.percent !== undefined
          && (typeof entry.percent !== 'number' || !Number.isFinite(entry.percent))) {
        push(`done_summary entries[${i}].percent must be a finite number when present`);
      }
    });
  },
  passage(raw, push) {
    if (!isNonEmptyString(raw.text)) push('passage text must be a non-empty string');
    else if (REQUIRE_MACRO.test(raw.text)) push(requireError('passage text'));
    if (raw.source !== undefined) {
      if (!raw.source || typeof raw.source !== 'object' || Array.isArray(raw.source)) {
        push('passage source must be an object');
      } else {
        if (!isNonEmptyString(raw.source.title)) push('passage source.title must be a non-empty string');
        if (raw.source.author !== undefined && !isNonEmptyString(raw.source.author)) {
          push('passage source.author must be a non-empty string when present');
        }
        if (raw.source.locator !== undefined && !isNonEmptyString(raw.source.locator)) {
          push('passage source.locator must be a non-empty string when present');
        }
      }
    }
    // Default 'reprint' is applied downstream (this layer only checks shape).
    if (raw.mode !== undefined && raw.mode !== 'reprint' && raw.mode !== 'cite') {
      push("passage mode must be 'reprint' or 'cite'");
    }
    if (raw.lineNumbers !== undefined && typeof raw.lineNumbers !== 'boolean') {
      push('passage lineNumbers must be a boolean');
    }
  },
  figure(raw, push) {
    if (!isNonEmptyString(raw.asset)) push('figure asset must be a non-empty string');
    if (!isNonEmptyString(raw.caption)) push('figure caption must be a non-empty string');
    if (raw.credit !== undefined && !isNonEmptyString(raw.credit)) {
      push('figure credit must be a non-empty string when present');
    }
  },
  inset(raw, push, ctx) {
    if (raw.title !== undefined && !isNonEmptyString(raw.title)) {
      push('inset title must be a non-empty string when present');
    }
    if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) {
      push('inset blocks must be a non-empty array');
      return;
    }
    raw.blocks.forEach((child, i) => {
      const at = ctx.at ? `${ctx.at}.blocks[${i}]` : `blocks[${i}]`;
      // One level deep is the whole rule: an inset is already a boxed aside, so
      // an inset inside an inset has no more page-break/box semantics to add.
      if (child && typeof child === 'object' && child.type === 'inset') {
        ctx.errors.push(`${at}: inset blocks must not nest insets`);
        return;
      }
      // Fail closed at validate time (spec principle), not at measure/draw:
      // reject the types the box path cannot actually render nested — see
      // INSET_UNSUPPORTED_CHILD_TYPES above for the audit against
      // measureNodes'/measureBoxNode's real coverage.
      if (child && typeof child === 'object'
        && Object.prototype.hasOwnProperty.call(INSET_UNSUPPORTED_CHILD_TYPES, child.type)) {
        ctx.errors.push(`${at}: ${INSET_UNSUPPORTED_CHILD_TYPES[child.type]}`);
        return;
      }
      validateInto(child, at, ctx.errors, ctx.allowAnswers);
    });
  },
  list(raw, push) {
    if (!['bullet', 'numbered', 'checklist'].includes(raw.style)) {
      push("list style must be one of 'bullet', 'numbered', 'checklist'");
    }
    if (!Array.isArray(raw.items) || raw.items.length === 0) {
      push('list items must be a non-empty array');
    } else if (raw.items.some((item) => !isNonEmptyString(item))) {
      push('list items must be non-empty strings');
    }
  },
  // Boxed, seeded-shuffled term set (spec §6.2). Terms are presentation
  // (what shuffles on the page), never answers — legal in published documents
  // without an `allowAnswers` gate.
  wordbank(raw, push) {
    if (!isShuffleKey(raw.key)) push(keyError('wordbank key'));
    if (!Array.isArray(raw.terms) || raw.terms.length === 0) {
      push('wordbank terms must be a non-empty array');
    } else if (!raw.terms.every(isNonEmptyString)) {
      push('wordbank terms must be non-empty strings');
    } else if (new Set(raw.terms).size !== raw.terms.length) {
      push('wordbank terms must be unique');
    }
  },
  // Two seeded-shuffled lists with write-the-letter blanks (spec §6.2). The
  // PUBLISHED shape is `{key, left, right, itemRef?}`; SOURCE additionally
  // allows `pairs` (the answer key) — gated the same way as cloze/short_answer
  // below. `itemRef` (Task 3) is the inverse gate: publish-only, pointing at
  // the derived-bank `matching` item that now holds what `pairs` used to.
  matching(raw, push, ctx) {
    if (!isShuffleKey(raw.key)) push(keyError('matching key'));
    if (!isNonEmptyStringArray(raw.left)) push('matching left must be a non-empty array of non-empty strings');
    else if (new Set(raw.left).size !== raw.left.length) push('matching left must be unique');
    if (!isNonEmptyStringArray(raw.right)) push('matching right must be a non-empty array of non-empty strings');
    else if (new Set(raw.right).size !== raw.right.length) push('matching right must be unique');
    if (raw.itemRef !== undefined) {
      if (ctx.allowAnswers) push(publishedOnlyError('matching itemRef'));
      else if (!isNonEmptyString(raw.itemRef)) push('matching itemRef must be a non-empty string when present');
    }
    if (raw.pairs === undefined) return;
    if (!ctx.allowAnswers) { push(sourceOnlyError('matching pairs')); return; }
    validateMatchingPairs(raw, push);
  },
  // A passage with fixed-width numbered blanks (spec §6.3). `text`'s `{{n}}`
  // markers are the ONE source of truth for how many blanks exist and their
  // numbering; `blanks[]` only carries per-blank presentation (width,
  // wordbank ref) and, in SOURCE documents, the answer.
  cloze(raw, push, ctx) {
    if (!isNonEmptyString(raw.text)) { push('cloze text must be a non-empty string'); return; }
    if (REQUIRE_MACRO.test(raw.text)) push(requireError('cloze text'));
    const markers = [...raw.text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    if (markers.length === 0) {
      push('cloze text must contain at least one {{n}} blank marker');
    } else {
      const expected = Array.from({ length: markers.length }, (_, i) => i + 1);
      const sorted = [...markers].sort((a, b) => a - b);
      if (sorted.some((n, i) => n !== expected[i])) {
        push(`cloze text blank markers must be {{1}}..{{${markers.length}}}, each exactly once`);
      }
    }
    if (!Array.isArray(raw.blanks) || raw.blanks.length === 0) {
      push('cloze blanks must be a non-empty array');
      return;
    }
    const seenN = new Set();
    raw.blanks.forEach((blank, i) => {
      const at = `cloze blanks[${i}]`;
      if (!blank || typeof blank !== 'object' || Array.isArray(blank)) { push(`${at} must be a mapping`); return; }
      if (!Number.isInteger(blank.n) || !markers.includes(blank.n)) {
        push(`${at}.n must be an integer matching a {{n}} marker in text`);
      } else if (seenN.has(blank.n)) {
        push(`${at}.n duplicates blank {{${blank.n}}}`);
      } else {
        seenN.add(blank.n);
      }
      if (blank.width !== undefined && !['s', 'm', 'l'].includes(blank.width)) {
        push(`${at}.width must be 's', 'm', or 'l'`);
      }
      if (blank.wordbank !== undefined && !isNonEmptyString(blank.wordbank)) {
        push(`${at}.wordbank must be a non-empty string when present`);
      }
      if (blank.answer !== undefined) {
        if (!ctx.allowAnswers) push(sourceOnlyError(`${at}.answer`));
        else if (!isNonEmptyString(blank.answer)) push(`${at}.answer must be a non-empty string when present`);
      }
      // itemRef (Task 3, spec §3): publish-only, per-blank — a cloze block can
      // mint several derived-bank items (one per blank), so unlike
      // matching/short_answer the reference lives on the blank, not the block.
      if (blank.itemRef !== undefined) {
        if (ctx.allowAnswers) push(publishedOnlyError(`${at}.itemRef`));
        else if (!isNonEmptyString(blank.itemRef)) push(`${at}.itemRef must be a non-empty string when present`);
      }
    });
    if (markers.length && seenN.size !== markers.length) {
      push('cloze blanks must include one entry for every {{n}} marker in text');
    }
  },
  // Prompt + ruled lines; sugar over prompt + answer_space at render time
  // (spec §4.2, §6.2) — this validator only checks the authored shape.
  // `itemRef` (Task 3) is the publish-only inverse of `answer`: short_answer
  // has no author-assigned key, so its derived-bank item id is minted from
  // its document path (see documentSource.mjs's keyless-id scheme).
  short_answer(raw, push, ctx) {
    if (!isNonEmptyString(raw.prompt)) push('short_answer prompt must be a non-empty string');
    if (raw.lines !== undefined && (!Number.isInteger(raw.lines) || raw.lines < 1 || raw.lines > 10)) {
      push('short_answer lines must be an integer between 1 and 10');
    }
    if (raw.itemRef !== undefined) {
      if (ctx.allowAnswers) push(publishedOnlyError('short_answer itemRef'));
      else if (!isNonEmptyString(raw.itemRef)) push('short_answer itemRef must be a non-empty string when present');
    }
    if (raw.answer === undefined) return;
    if (!ctx.allowAnswers) { push(sourceOnlyError('short_answer answer')); return; }
    if (!isNonEmptyString(raw.answer)) push('short_answer answer must be a non-empty string when present');
  },
  // Prompt + ruled lines OR an open box; sugar over prompt + answer_space
  // (spec §4.2, §6.2). Essay NEVER carries an answer — unmarked prose has
  // nothing for a bank to hold, source stage or not.
  essay(raw, push) {
    if (!isNonEmptyString(raw.prompt)) push('essay prompt must be a non-empty string');
    if (raw.box !== undefined && raw.box !== true) push('essay box must be true when present');
    if (raw.lines !== undefined && (!Number.isInteger(raw.lines) || raw.lines < 2 || raw.lines > 30)) {
      push('essay lines must be an integer between 2 and 30');
    }
    if (raw.box !== undefined && raw.lines !== undefined) push('essay must not specify both lines and box');
    if (raw.answer !== undefined || raw.answers !== undefined) {
      push('essay must not carry an answer (unmarked prose)');
    }
  },
  // No fields: a divider is a bare rule across the page width.
  divider() {},
  spacer(raw, push) {
    const minOk = isPositiveNumber(raw.minPt);
    const maxOk = isPositiveNumber(raw.maxPt);
    if (!minOk) push('spacer minPt must be a number > 0');
    if (!maxOk) push('spacer maxPt must be a number > 0');
    if (minOk && maxOk && raw.minPt > raw.maxPt) push('spacer minPt must be <= maxPt');
  },
  // No fields: a forced page break between the preceding and following blocks.
  page_break() {},
};

export const BLOCK_TYPES = Object.freeze(Object.keys(VALIDATORS));

function validateInto(raw, at, errors, allowAnswers) {
  const prefix = at ? `${at}: ` : '';
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(`${prefix}block must be a mapping`);
    return;
  }
  // Own-property lookup, not a bracket read: `constructor`/`toString` would
  // otherwise resolve to an Object.prototype function and validate clean.
  if (!Object.prototype.hasOwnProperty.call(VALIDATORS, raw.type)) {
    errors.push(`${prefix}unknown block type: ${raw.type}`);
    return;
  }
  VALIDATORS[raw.type](raw, (message) => errors.push(prefix + message), { at, errors, allowAnswers });
}

/**
 * @param {*} raw - one parsed block
 * @param {{ path?: string, allowAnswers?: boolean }} [opts] - `path` prefixes
 *   reported errors (the caller's position in the document, so nested paths
 *   compose as one dotted trail instead of stacked prefixes). `allowAnswers`
 *   (default false) is the SOURCE-vs-PUBLISHED gate (spec §3): false is the
 *   published posture every existing caller gets unchanged — SOURCE-only
 *   fields (`matching.pairs`, a `cloze` blank's `answer`, `short_answer`'s
 *   `answer`) are rejected. A caller validating the source stage (Task 3)
 *   passes `true` to permit them; it threads recursively into `question` and
 *   `inset` children via `ctx.allowAnswers` so the whole subtree agrees.
 * @returns {{ errors: string[] }} empty errors === valid
 */
export function validateBlock(raw, { path = '', allowAnswers = false } = {}) {
  const errors = [];
  validateInto(raw, path, errors, allowAnswers);
  return { errors };
}
