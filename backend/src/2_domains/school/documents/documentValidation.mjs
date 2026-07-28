/**
 * Pure whole-document validation (spec §3.3). No I/O.
 *
 * Beyond per-block structure (blocks.mjs), a document carries rules that only
 * the whole tree can decide: question item refs are unique; an `omr_response`
 * sits inside a question AND names that same question's item; and NO node
 * anywhere carries an answer. Learner copies and answer keys render from the
 * same document data plus the question bank — a document that could hold an
 * answer is a document that can print one on the learner's sheet.
 */
import { validateBlock } from './blocks.mjs';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const TARGETS = new Set(['letter', 'receipt']);
const ANSWER_KEYS = ['answer', 'answers'];

// Safe integers only: past MAX_SAFE_INTEGER distinct values collide onto the
// same float, so "same seed, byte-identical output" would stop holding.
const isCountable = (v) => Number.isSafeInteger(v) && v >= 0;
const countableError = (field) => `${field} must be an integer between 0 and ${Number.MAX_SAFE_INTEGER}`;

/**
 * Depth-first walk of the block tree, visiting every block with its dotted path
 * and the enclosing `question` block (null at the top level). Shared by the
 * itemId uniqueness and omr_response rules, and by the layout engine, which
 * needs the same question grouping to keep atomics together.
 *
 * `open` tracks the current path, not every block seen: a YAML anchor may reuse
 * one block object in two places legitimately, but a block reachable from
 * itself would recurse forever.
 *
 * Because that guard is path-scoped, an anchor-built DAG is re-walked once per
 * path into it, which is exponential in nesting depth — ~20 levels of aliased
 * questions is 3M visits from 67 lines of YAML. `budget` caps total visits and
 * `MAX_DEPTH` caps nesting so a pathological document fails validation instead
 * of hanging the process or exhausting memory. Both ceilings sit far above any
 * hand-authored worksheet.
 *
 * @param {*} blocks - the document's (or a question's) blocks array
 * @param {(block: object, at: string, question: object|null) => void} visit
 * @param {{ path?: string, question?: object|null, open?: WeakSet, depth?: number, budget?: {left: number} }} [ctx]
 * @returns {{ exhausted: boolean }} true when a ceiling stopped the walk early
 */
export const MAX_DEPTH = 64;
export const MAX_VISITS = 50000;

export function walkBlocks(blocks, visit, ctx = {}) {
  const {
    path = 'blocks', question = null, open = new WeakSet(),
    depth = 0, budget = { left: MAX_VISITS },
  } = ctx;
  if (!Array.isArray(blocks) || depth > MAX_DEPTH) {
    return { exhausted: depth > MAX_DEPTH };
  }
  let exhausted = false;
  blocks.forEach((block, i) => {
    if (budget.left <= 0) { exhausted = true; return; }
    if (!block || typeof block !== 'object' || Array.isArray(block)) return;
    if (open.has(block)) return;
    budget.left -= 1;
    const at = `${path}[${i}]`;
    visit(block, at, question);
    if (block.type === 'question') {
      open.add(block);
      const inner = walkBlocks(block.blocks, visit, {
        path: `${at}.blocks`, question: block, open, depth: depth + 1, budget,
      });
      open.delete(block);
      if (inner.exhausted) exhausted = true;
    }
  });
  return { exhausted };
}

/**
 * The bank items this document actually poses, in printed order.
 *
 * This is the DENOMINATOR of a paper score: a sheet with six questions is out of
 * six whether or not six answers came back, so an unanswered question has to
 * count as unresolved rather than quietly shrink the total. Derived from the
 * document (what was printed) and never from the submission (what came back).
 *
 * @param {object} document
 * @returns {string[]} unique itemIds
 */
export function questionItemIds(document) {
  const ids = [];
  walkBlocks(document?.blocks, (block) => {
    if (block.type === 'question' && typeof block.itemId === 'string' && !ids.includes(block.itemId)) {
      ids.push(block.itemId);
    }
  });
  return ids;
}

// Answers can hide anywhere, including inside a renderer-owned plot/geometry
// spec, so this walk is over arbitrary values rather than the block tree. Paths
// are reported in the same dotted notation as block errors ('' is the document
// root, so a top-level `blocks` child reads `blocks[0]`, not `document.blocks[0]`).
function collectAnswerKeys(node, at, errors, seen) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectAnswerKeys(v, `${at}[${i}]`, errors, seen));
    return;
  }
  for (const key of ANSWER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(node, key)) {
      errors.push(`${at || 'document'}: must not carry an answer key (answer keys render from the question bank)`);
      break;
    }
  }
  Object.entries(node).forEach(([k, v]) => collectAnswerKeys(v, at ? `${at}.${k}` : k, errors, seen));
}

/**
 * @param {*} raw - one parsed document
 * @returns {{ errors: string[], document?: object }} normalised document when valid
 */
export function validateDocument(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['document must be a mapping'] };
  }
  const errors = [];
  if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) errors.push('id must match ^[a-z0-9][a-z0-9-]*$');
  // Regeneration is byte-identical from the seed, so a missing seed is not a
  // defaultable omission — a random fill-in would make the document
  // irreproducible after the fact.
  if (!isCountable(raw.seed)) errors.push(countableError('seed'));
  const variant = raw.variant === undefined || raw.variant === null ? 0 : raw.variant;
  if (!isCountable(variant)) errors.push(countableError('variant'));
  if (!Array.isArray(raw.target) || raw.target.length === 0) {
    errors.push('target must be a non-empty array');
  } else {
    raw.target.forEach((t) => { if (!TARGETS.has(t)) errors.push(`unknown target: ${t}`); });
  }

  collectAnswerKeys(raw, '', errors, new WeakSet());

  if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) {
    errors.push('blocks must be a non-empty array');
    return { errors };
  }
  raw.blocks.forEach((block, i) => {
    errors.push(...validateBlock(block, { path: `blocks[${i}]` }).errors);
  });

  const seenItemIds = new Map();
  const walk = walkBlocks(raw.blocks, (block, at, question) => {
    if (block.type === 'question' && typeof block.itemId === 'string') {
      // Name both positions: knowing only the colliding id leaves an author
      // hunting through a long document for which of the two to renumber.
      const first = seenItemIds.get(block.itemId);
      if (first !== undefined) errors.push(`${at}: duplicate question itemId "${block.itemId}" (already used at ${first})`);
      else seenItemIds.set(block.itemId, at);
    }
    if (block.type === 'omr_response') {
      if (!question) errors.push(`${at}: omr_response must be inside a question block`);
      // The bubble row and its question must grade the same bank item, or the
      // sheet marks up one item and the grader scores another. A multi-part
      // question is modelled as separate question blocks, so equality is the
      // whole rule.
      else if (typeof block.itemId === 'string' && typeof question.itemId === 'string' && block.itemId !== question.itemId) {
        errors.push(`${at}: omr_response itemId "${block.itemId}" must match its question itemId "${question.itemId}"`);
      }
    }
  });
  if (walk.exhausted) {
    errors.push(`blocks: structure too large or too deeply nested to validate (limits: depth ${MAX_DEPTH}, ${MAX_VISITS} blocks)`);
  }

  if (errors.length) return { errors };
  return {
    errors,
    document: {
      id: raw.id,
      seed: raw.seed,
      variant,
      target: raw.target,
      blocks: raw.blocks,
    },
  };
}
