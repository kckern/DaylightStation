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
 */
export const BLOCK_TYPES = Object.freeze([
  'rich_text', 'math', 'plot', 'geometry', 'asset',
  'question', 'answer_space', 'omr_response',
  'media_action', 'scan_action',
]);

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isPositiveNumber = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

// \require is MathJax's browser-only lazy package loader. Server-side every
// package is preloaded, and the macro renders as literal red error text on the
// printed page (found in the math rendering spike). It is banned in every field
// that reaches the math renderer — rich_text carries inline math to the same
// place as a math block. TeX tolerates space before the argument brace.
const REQUIRE_MACRO = /\\require\s*\{/;
const requireError = (field) => `${field} must not use \\require{} (server rendering loads all packages)`;

const specValidator = (type) => (raw, errors) => {
  if (!raw.spec || typeof raw.spec !== 'object' || Array.isArray(raw.spec)) {
    errors.push(`${type} spec must be an object`);
    return;
  }
  if (!isNonEmptyString(raw.spec.kind)) errors.push(`${type} spec.kind must be a non-empty string`);
};

const actionValidator = (type) => (raw, errors) => {
  if (!isNonEmptyString(raw.action)) errors.push(`${type} action must be a non-empty string`);
  if (!isNonEmptyString(raw.label)) errors.push(`${type} label must be a non-empty string`);
};

const VALIDATORS = {
  rich_text(raw, errors) {
    if (!isNonEmptyString(raw.md)) errors.push('rich_text md must be a non-empty string');
    else if (REQUIRE_MACRO.test(raw.md)) errors.push(requireError('rich_text md'));
  },
  math(raw, errors) {
    if (!isNonEmptyString(raw.tex)) errors.push('math tex must be a non-empty string');
    else if (REQUIRE_MACRO.test(raw.tex)) errors.push(requireError('math tex'));
    if (raw.display !== undefined && typeof raw.display !== 'boolean') {
      errors.push('math display must be a boolean');
    }
  },
  plot: specValidator('plot'),
  geometry: specValidator('geometry'),
  asset(raw, errors) {
    if (!isNonEmptyString(raw.ref)) errors.push('asset ref must be a non-empty string');
    // Alt doubles as the print caption, so it is required even though nothing
    // on paper reads it aloud.
    if (!isNonEmptyString(raw.alt)) errors.push('asset alt must be a non-empty string');
  },
  question(raw, errors) {
    if (!isNonEmptyString(raw.itemId)) errors.push('question itemId must be a non-empty string');
    if (!Number.isInteger(raw.number) || raw.number < 1) errors.push('question number must be an integer >= 1');
    if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) {
      errors.push('question blocks must be a non-empty array');
      return;
    }
    raw.blocks.forEach((child, i) => {
      // A question is the keep-together atomic (spec §4); nesting one inside
      // another has no page-break semantics, so it is rejected outright.
      if (child && typeof child === 'object' && child.type === 'question') {
        errors.push(`blocks[${i}]: question may not contain another question`);
        return;
      }
      validateBlock(child).errors.forEach((e) => errors.push(`blocks[${i}]: ${e}`));
    });
  },
  answer_space(raw, errors) {
    const minOk = isPositiveNumber(raw.minPt);
    const maxOk = isPositiveNumber(raw.maxPt);
    if (!minOk) errors.push('answer_space minPt must be a number > 0');
    if (!maxOk) errors.push('answer_space maxPt must be a number > 0');
    if (minOk && maxOk && raw.minPt > raw.maxPt) errors.push('answer_space minPt must be <= maxPt');
  },
  omr_response(raw, errors) {
    if (!isNonEmptyString(raw.itemId)) errors.push('omr_response itemId must be a non-empty string');
    // 2..8 is what a printed mark row can carry legibly at receipt width.
    if (!Number.isInteger(raw.choices) || raw.choices < 2 || raw.choices > 8) {
      errors.push('omr_response choices must be an integer between 2 and 8');
    }
  },
  media_action: actionValidator('media_action'),
  scan_action: actionValidator('scan_action'),
};

/**
 * @param {*} raw - one parsed block
 * @returns {{ errors: string[] }} empty errors === valid
 */
export function validateBlock(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['block must be a mapping'] };
  }
  const validate = Object.prototype.hasOwnProperty.call(VALIDATORS, raw.type) ? VALIDATORS[raw.type] : null;
  if (!validate) return { errors: [`unknown block type: ${raw.type}`] };
  const errors = [];
  validate(raw, errors);
  return { errors };
}
