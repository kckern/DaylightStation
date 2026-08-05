/**
 * Pure whole-document validation (spec §3.3). No I/O.
 *
 * Beyond per-block structure (blocks.mjs), a document carries rules that only
 * the whole tree can decide: question item refs are unique; an `omr_response`
 * sits inside a question AND names that same question's item; and — by
 * DEFAULT — NO node anywhere carries an answer. Learner copies and answer
 * keys render from the same document data plus the question bank, so a
 * document that could hold an answer is a document that can print one on the
 * learner's sheet. `validateDocument`'s `allowAnswers` option (Phase B, spec
 * §3) is the one escape hatch, for the SOURCE stage only — every existing
 * caller omits it and keeps this invariant absolute.
 */
import { validateBlock } from './blocks.mjs';

// Hierarchical taxonomy ids: 1–4 slash-separated kebab segments, mirroring the
// corpus layout (`<subject>/<course>/<slug>`) and the bank-id convention the
// School content mount already uses. A flat single-segment id stays legal, so
// every pre-existing document keeps validating.
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*){0,3}$/;
const ID_MAX_LENGTH = 100;
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

/**
 * Markdown as a person reads it: one line, no emphasis marks, no heading hashes.
 * A review screen shows this next to what the child wrote, so `**simplest
 * form**` has to arrive as `simplest form`.
 */
function plainText(md) {
  if (typeof md !== 'string') return '';
  return md
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What each question on this sheet ASKS, keyed by itemId.
 *
 * The review queue used to be able to show a parent an itemId and the unit's
 * whole-sheet rubric — the same sentence on every row — so six marked questions
 * were indistinguishable. The printed wording is right here in the blocks.
 *
 * Only the question's own `rich_text` is used: a `math` block is the problem
 * itself and would arrive as raw TeX, and the child is holding the paper. The
 * NUMBER is carried for exactly that reason — it is how a parent finds the
 * question on the sheet in their hand.
 *
 * @param {object} document
 * @returns {Map<string, {number: number|null, prompt: string|null}>}
 */
export function questionPrompts(document) {
  const out = new Map();
  walkBlocks(document?.blocks, (block, _at, question) => {
    if (block.type === 'question' && typeof block.itemId === 'string' && !out.has(block.itemId)) {
      out.set(block.itemId, {
        number: Number.isFinite(block.number) ? block.number : null,
        prompt: null,
      });
    }
    if (block.type !== 'rich_text' || !question || typeof question.itemId !== 'string') return;
    const text = plainText(block.md);
    if (!text) return;
    const entry = out.get(question.itemId);
    if (!entry) return;
    entry.prompt = entry.prompt ? `${entry.prompt} ${text}` : text;
  });
  return out;
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
 * @param {{ allowAnswers?: boolean }} [opts] - `allowAnswers` (default false)
 *   is the SOURCE-vs-PUBLISHED gate (spec §3), mirroring `validateBlock`'s own
 *   option one level down. Every EXISTING caller omits it and keeps today's
 *   behavior byte-for-byte: the v1 (legacy, schema-less) document shape has no
 *   source stage and is ALWAYS validated answer-free. It exists so
 *   `validateDocumentV2` (documentV2.mjs) can thread a caller's allowAnswers
 *   through this shared v1-shaped validation — the source stage (Task 3) is
 *   the first caller expected to pass `true`.
 * @returns {{ errors: string[], document?: object }} normalised document when valid
 */
export function validateDocument(raw, { allowAnswers = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['document must be a mapping'] };
  }
  const errors = [];
  if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id) || raw.id.length > ID_MAX_LENGTH) {
    errors.push('id must be 1-4 kebab-case segments separated by "/" (e.g. arts/pokemon-identification/quiz-1)');
  }
  // Optional, because a receipt has no banner. But when it IS there it is what
  // heads the printed sheet, so it has to survive normalisation — a dropped
  // title prints the document's slug across the top of a child's worksheet.
  const hasTitle = raw.title !== undefined && raw.title !== null;
  if (hasTitle && (typeof raw.title !== 'string' || raw.title.trim().length === 0)) {
    errors.push('title must be a non-empty string when present');
  }
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

  // Answers can hide anywhere in the raw tree (collectAnswerKeys' own doc
  // comment); that is exactly what a SOURCE-stage document is allowed to do,
  // so this whole-tree net is skipped when allowAnswers is true. Per-field
  // SOURCE-only shapes (`matching.pairs`, a `cloze` blank's `answer`, etc.)
  // are still gated individually by validateBlock below via the SAME option —
  // this is one mechanism (an options bag, defaulted false), not two.
  if (!allowAnswers) collectAnswerKeys(raw, '', errors, new WeakSet());

  if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) {
    errors.push('blocks must be a non-empty array');
    return { errors };
  }
  raw.blocks.forEach((block, i) => {
    errors.push(...validateBlock(block, { path: `blocks[${i}]`, allowAnswers }).errors);
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
  const document = {
    id: raw.id,
    seed: raw.seed,
    variant,
    target: raw.target,
    blocks: raw.blocks,
  };
  // Present only when authored: `document.title || document.id` is the header
  // rule, and an empty-string key would defeat it as surely as a missing one.
  if (hasTitle) document.title = raw.title;
  return { errors, document };
}
