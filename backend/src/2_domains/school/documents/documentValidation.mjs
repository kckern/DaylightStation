/**
 * Pure whole-document validation (spec §3.3). No I/O.
 *
 * Beyond per-block structure (blocks.mjs), a document carries three rules that
 * only the whole tree can decide: question item refs are unique, an
 * `omr_response` sits inside the question it grades, and NO node anywhere
 * carries an answer. Learner copies and answer keys render from the same
 * document data plus the question bank — a document that could hold an answer
 * is a document that can print one on the learner's sheet.
 */
import { validateBlock } from './blocks.mjs';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const TARGETS = new Set(['letter', 'receipt']);
const ANSWER_KEYS = ['answer', 'answers'];

const isInteger = (v, min) => Number.isInteger(v) && v >= min;

/**
 * Depth-first walk of the block tree, visiting every block with its `blocks[i]`
 * path and whether an enclosing `question` contains it. Shared by the itemId
 * uniqueness and omr_response placement rules.
 *
 * @param {*} blocks - the document's (or a question's) blocks array
 * @param {(block: object, at: string, inQuestion: boolean) => void} visit
 * @param {{ path?: string, inQuestion?: boolean }} [ctx]
 */
export function walkBlocks(blocks, visit, { path = 'blocks', inQuestion = false } = {}) {
  if (!Array.isArray(blocks)) return;
  blocks.forEach((block, i) => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return;
    const at = `${path}[${i}]`;
    visit(block, at, inQuestion);
    if (block.type === 'question') {
      walkBlocks(block.blocks, visit, { path: `${at}.blocks`, inQuestion: true });
    }
  });
}

// Answers can hide anywhere, including inside a renderer-owned plot/geometry
// spec, so this walk is over arbitrary values rather than the block tree.
function collectAnswerKeys(node, at, errors, seen) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectAnswerKeys(v, `${at}[${i}]`, errors, seen));
    return;
  }
  for (const key of ANSWER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(node, key)) {
      errors.push(`${at} must not carry an answer key (answer keys render from the question bank)`);
      break;
    }
  }
  Object.entries(node).forEach(([k, v]) => collectAnswerKeys(v, `${at}.${k}`, errors, seen));
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
  if (!isInteger(raw.seed, 0)) errors.push('seed must be an integer >= 0');
  const variant = raw.variant === undefined || raw.variant === null ? 0 : raw.variant;
  if (!isInteger(variant, 0)) errors.push('variant must be an integer >= 0');
  if (!Array.isArray(raw.target) || raw.target.length === 0) {
    errors.push('target must be a non-empty array');
  } else {
    raw.target.forEach((t) => { if (!TARGETS.has(t)) errors.push(`unknown target: ${t}`); });
  }

  collectAnswerKeys(raw, 'document', errors, new WeakSet());

  if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) {
    errors.push('blocks must be a non-empty array');
    return { errors };
  }
  raw.blocks.forEach((block, i) => {
    validateBlock(block).errors.forEach((e) => errors.push(`blocks[${i}]: ${e}`));
  });

  const seenItemIds = new Set();
  walkBlocks(raw.blocks, (block, at, inQuestion) => {
    if (block.type === 'question' && typeof block.itemId === 'string') {
      if (seenItemIds.has(block.itemId)) errors.push(`duplicate question itemId: ${block.itemId}`);
      else seenItemIds.add(block.itemId);
    }
    if (block.type === 'omr_response' && !inQuestion) {
      errors.push(`${at}: omr_response must be inside a question block`);
    }
  });

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
