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
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isPositiveNumber = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

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
    if (!isNonEmptyString(raw.itemId)) push('question itemId must be a non-empty string');
    if (!Number.isInteger(raw.number) || raw.number < 1) push('question number must be an integer >= 1');
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
      validateInto(child, at, ctx.errors);
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
      validateInto(child, at, ctx.errors);
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

function validateInto(raw, at, errors) {
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
  VALIDATORS[raw.type](raw, (message) => errors.push(prefix + message), { at, errors });
}

/**
 * @param {*} raw - one parsed block
 * @param {{ path?: string }} [opts] - path prefix for reported errors; the
 *   caller's position in the document, so nested paths compose as one dotted
 *   trail instead of stacked prefixes
 * @returns {{ errors: string[] }} empty errors === valid
 */
export function validateBlock(raw, { path = '' } = {}) {
  const errors = [];
  validateInto(raw, path, errors);
  return { errors };
}
