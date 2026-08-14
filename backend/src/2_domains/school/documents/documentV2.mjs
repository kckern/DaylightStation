/**
 * Envelope v2 (spec §4). No I/O.
 *
 * v2 introduces versioning to the previously version-less document shape
 * (§4.1) without forking the validator: `validateDocumentV2` builds the
 * v1-shaped subset {id, seed, variant, target, blocks, title} and hands it to
 * the existing `validateDocument` for every check that shape already owns
 * (id/seed/variant/target, the answer-key ban, block structure, itemId
 * uniqueness, omr_response placement) — this file adds only what v1 doesn't
 * know about: archetype presets, header/fit/defaultPoints, and the `source`
 * sugar.
 *
 * `source` desugar and error-path attribution: the envelope's `source` is
 * sugar for a header-corner `scan_action` block the author never wrote as a
 * `blocks[]` entry, so a malformed `source` must not be reported as
 * `blocks[0]: ...` — that path would send an AI repair loop hunting through
 * `blocks` for a line that isn't there. `desugarSource` validates the
 * candidate block itself (via the same `validateBlock` a hand-authored
 * scan_action goes through) at path `'source'` *before* it ever reaches
 * `validateDocument`, and only a block that already passed is prepended. A
 * prepended block is therefore always structurally valid, so `validateDocument`
 * re-checking `blocks[0]` never produces a second, mis-pathed error for it.
 */
import { validateDocument, walkBlocks } from './documentValidation.mjs';
import { validateBlock } from './blocks.mjs';
import { SHUFFLE_KEY_PATTERN } from './shuffle.mjs';
// Task 3 (spec §3): the source stage is a sibling module, imported only for
// `validateAnyDocument`'s dispatch branch. This is a deliberate two-way
// import (documentSource.mjs imports `validateDocumentV2`/`DOCUMENT_V2_SCHEMA`
// back from this file) — safe because every binding crossing the cycle is
// either a hoisted `function` declaration or read only from inside a function
// body (never at module-top-level), so both modules are fully evaluated by
// the time either binding is actually used.
import { DOCUMENT_SOURCE_SCHEMA, validateDocumentSource } from './documentSource.mjs';

export const DOCUMENT_V2_SCHEMA = 'school.document/v2';
export const ARCHETYPES = ['quiz', 'worksheet', 'infopage'];
export const FIT_POLICIES = ['flow', 'one-page', 'fill', 'prefer-one-page'];

/**
 * Which print targets each block type may appear on (spec §7). Seeded from
 * `DocumentEscPosRenderer`'s SUPPORTED set (rich_text, scan_action,
 * media_action — the only three it doesn't throw "no receipt rendering" for):
 * those keep `letter+receipt`. Every other block type currently registered in
 * `blocks.mjs` (math, plot, geometry, asset, question, answer_space,
 * omr_response) has no receipt renderer, so it is `letter`-only here.
 *
 * Exported (and frozen, map + every array) so Task 4's new content blocks
 * register themselves in this same map in the change that adds them, rather
 * than defaulting into receipt support they have no renderer for.
 * // Task 4: register new letter-only block types below this line.
 */
export const BLOCK_TARGET_SUPPORT = Object.freeze({
  rich_text: Object.freeze(['letter', 'receipt']),
  scan_action: Object.freeze(['letter', 'receipt']),
  media_action: Object.freeze(['letter', 'receipt']),
  result_summary: Object.freeze(['receipt']),
  math: Object.freeze(['letter']),
  plot: Object.freeze(['letter']),
  geometry: Object.freeze(['letter']),
  asset: Object.freeze(['letter']),
  question: Object.freeze(['letter']),
  answer_space: Object.freeze(['letter']),
  omr_response: Object.freeze(['letter']),
  // Task 4: registered letter-only — no receipt renderer exists for these yet.
  passage: Object.freeze(['letter']),
  figure: Object.freeze(['letter']),
  inset: Object.freeze(['letter']),
  list: Object.freeze(['letter']),
  divider: Object.freeze(['letter']),
  spacer: Object.freeze(['letter']),
  page_break: Object.freeze(['letter']),
  // Task 2: assessment blocks (spec §6.2) — letter-only, same reason: no
  // receipt renderer exists for any of these.
  wordbank: Object.freeze(['letter']),
  matching: Object.freeze(['letter']),
  cloze: Object.freeze(['letter']),
  short_answer: Object.freeze(['letter']),
  essay: Object.freeze(['letter']),
});

const ALL_SUPPORTED_TARGETS = new Set(Object.values(BLOCK_TARGET_SUPPORT).flat());

const TYPE_SCALES = ['standard', 'young'];

const HEADER_PRESETS = {
  quiz: { name: true, date: true, scoreBox: true },
  worksheet: { name: true, date: true, scoreBox: false },
  infopage: { name: false, date: false, scoreBox: false },
};

/**
 * Per-archetype fit-policy default (household rule, spec §7: "we can only
 * use two pages if we have an exceptionally long number of questions ...
 * within each page there should be right sizing"). This is the seam chosen
 * for "make `prefer-one-page` the default for worksheets": an archetype
 * preset, exactly parallel to `HEADER_PRESETS` above, rather than a change to
 * the FLAT fallback (`fit.policy: 'flow'`) every archetype used to share.
 * That flat fallback stays `'flow'` here (used only when an archetype isn't
 * in this map at all, e.g. an already-rejected unknown archetype) — a global
 * default change would have silently right-sized quizzes, infopages, and
 * receipts too, none of which this task touches or was asked to. A quiz's
 * scored, row-mapped layout in particular has its own pagination
 * expectations (`allocation.mjs` row ranges) that were never part of this
 * request. Only `worksheet` moves; every other archetype keeps requesting
 * `flow` exactly as before, unless a document explicitly opts into something
 * else via `fit.policy` (still honored below — this is a DEFAULT, not a
 * override).
 */
const FIT_POLICY_PRESETS = {
  quiz: 'flow',
  worksheet: 'prefer-one-page',
  infopage: 'flow',
};

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isShuffleKey = (v) => typeof v === 'string' && SHUFFLE_KEY_PATTERN.test(v);

/**
 * Document-wide shuffle-`key` uniqueness (spec §4.3) + cloze→wordbank ref
 * resolution (spec §6.3). Every shuffling block — `wordbank`, `matching`, and
 * a bank-select `question` (`select` present) — derives its shuffle from
 * `(seed, variant, key)` (shuffle.mjs); two blocks sharing a key would
 * shuffle IDENTICALLY, which can only be an authoring accident, so the key
 * has to be unique across the whole tree, not just within its block type.
 * `blocks.mjs` already validates each key's own SHAPE (`SHUFFLE_KEY_PATTERN`);
 * this walk gates registration on that SAME shape check (not a bare
 * non-empty-string check) so a shape-invalid key never enters either map —
 * otherwise a shape-invalid key repeated twice would earn a redundant
 * "duplicate key" error on top of its two shape errors, AND a shape-invalid
 * `wordbank.key` would silently satisfy a `cloze` ref check it has no
 * business satisfying (the document is still rejected either way via the
 * shape error, but for the wrong reason, at the wrong path). A key that
 * already failed its own shape check is reported ONCE, by blocks.mjs, not
 * twice here.
 *
 * A `cloze` blank's `wordbank` field is a same-document reference (spec
 * §6.3 "cloze blanks may reference wordbank entries") — resolved against the
 * `wordbank` keys ACTUALLY declared (and shape-valid) here; a reference to a
 * key that isn't one of them — including a reference to a wordbank whose own
 * key was shape-invalid, so it was never registered — can never resolve at
 * render time, so it fails now instead.
 */
function validateKeysAndWordbankRefs(blocks, errors) {
  const shuffleKeyOwner = new Map(); // key -> first dotted path that declared it
  const wordbankKeys = new Set();

  walkBlocks(blocks, (block) => {
    if (block.type === 'wordbank' && isShuffleKey(block.key)) wordbankKeys.add(block.key);
  });

  walkBlocks(blocks, (block, at) => {
    let key;
    if (block.type === 'wordbank' || block.type === 'matching') key = block.key;
    else if (block.type === 'question' && block.select !== undefined) key = block.key;
    if (!isShuffleKey(key)) return;
    const first = shuffleKeyOwner.get(key);
    if (first !== undefined) errors.push(`${at}: duplicate key "${key}" (already used at ${first})`);
    else shuffleKeyOwner.set(key, at);
  });

  walkBlocks(blocks, (block, at) => {
    if (block.type !== 'cloze' || !Array.isArray(block.blanks)) return;
    block.blanks.forEach((blank, i) => {
      if (!blank || typeof blank !== 'object' || typeof blank.wordbank !== 'string') return;
      if (!wordbankKeys.has(blank.wordbank)) {
        errors.push(`${at}.blanks[${i}]: wordbank "${blank.wordbank}" does not match any wordbank block's key`);
      }
    });
  });
}

/**
 * Validates and expands the envelope's optional `source: {action, label}`
 * sugar into a `scan_action` block. Returns `undefined` (pushing errors
 * under the `source` path) when absent or invalid, so the caller never
 * prepends a block that would just duplicate-fail inside `validateDocument`.
 */
function desugarSource(raw, errors, allowAnswers) {
  if (raw.source === undefined || raw.source === null) return undefined;
  if (!isPlainObject(raw.source)) {
    errors.push('source must be a mapping');
    return undefined;
  }
  const block = { type: 'scan_action', action: raw.source.action, label: raw.source.label };
  const { errors: blockErrors } = validateBlock(block, { path: 'source', allowAnswers });
  if (blockErrors.length) {
    errors.push(...blockErrors);
    return undefined;
  }
  return block;
}

/**
 * @param {*} raw - one parsed v2 document
 * @param {{ allowAnswers?: boolean }} [opts] - threaded straight through to
 *   `validateDocument`/`validateBlock` (spec §3's source-vs-published gate).
 *   Default false — every EXISTING caller of this function keeps validating
 *   the PUBLISHED posture unchanged. The source stage (`school.document-source
 *   /v1`, Task 3) is the first caller expected to pass `true`.
 * @returns {{ errors: string[], document?: object }}
 */
export function validateDocumentV2(raw, { allowAnswers = false } = {}) {
  if (!isPlainObject(raw)) return { errors: ['document must be a mapping'] };
  const errors = [];

  if (!ARCHETYPES.includes(raw.archetype)) errors.push(`unknown archetype: ${raw.archetype}`);
  const preset = HEADER_PRESETS[raw.archetype] || { name: false, date: false, scoreBox: false };

  const rawHeaderValid = raw.header === undefined || isPlainObject(raw.header);
  if (!rawHeaderValid) errors.push('header must be a mapping');
  const rawHeader = rawHeaderValid && raw.header ? raw.header : {};
  const header = { ...preset };
  for (const field of ['name', 'date', 'scoreBox', 'metaFirst', 'rule']) {
    if (rawHeader[field] === undefined) continue;
    if (typeof rawHeader[field] !== 'boolean') errors.push(`header.${field} must be a boolean`);
    else header[field] = rawHeader[field];
  }
  if (rawHeader.instructions !== undefined) {
    if (typeof rawHeader.instructions !== 'string') errors.push('header.instructions must be a string');
    else header.instructions = rawHeader.instructions;
  }
  for (const field of ['subtitle', 'reading']) {
    if (rawHeader[field] !== undefined) {
      if (typeof rawHeader[field] !== 'string') errors.push(`header.${field} must be a string`);
      else header[field] = rawHeader[field];
    }
  }
  if (rawHeader.frame !== undefined) {
    if (!['none', 'double'].includes(rawHeader.frame)) errors.push('header.frame must be none|double when present');
    else header.frame = rawHeader.frame;
  }

  const rawFitValid = raw.fit === undefined || isPlainObject(raw.fit);
  if (!rawFitValid) errors.push('fit must be a mapping');
  const rawFit = rawFitValid && raw.fit ? raw.fit : {};
  const fit = { policy: FIT_POLICY_PRESETS[raw.archetype] ?? 'flow', typeScale: 'standard' };
  if (rawFit.policy !== undefined) {
    if (!FIT_POLICIES.includes(rawFit.policy)) errors.push(`unknown fit.policy: ${rawFit.policy}`);
    else fit.policy = rawFit.policy;
  }
  if (rawFit.typeScale !== undefined) {
    if (!TYPE_SCALES.includes(rawFit.typeScale)) errors.push(`unknown fit.typeScale: ${rawFit.typeScale}`);
    else fit.typeScale = rawFit.typeScale;
  }

  // Letter-only fit policies (spec §7): a continuous receipt roll has no page
  // to overset-check or bottom out. `prefer-one-page` deliberately does NOT
  // join `one-page`/`fill` here, even though its decision is also framed in
  // terms of page count: unlike those two, it can never hard-fail or demand
  // page-boundary knowledge to grow into (its worst case degrades to plain
  // `flow`-shaped behavior — take whatever the normal-density measurement
  // produced), so there is no failure mode here for this check to prevent.
  // Concretely, this is also the policy `worksheet`'s ARCHETYPE DEFAULT now
  // resolves to (see `FIT_POLICY_PRESETS` above) — banning it here would
  // reject every existing worksheet+receipt document that never asked for
  // any particular fit policy, breaking a previously-working combination
  // for a document type this task was never asked to touch.
  if (['one-page', 'fill'].includes(fit.policy)
    && Array.isArray(raw.target) && raw.target.includes('receipt')) {
    errors.push(`fit policy '${fit.policy}' requires letter target`);
  }

  let defaultPoints = 1;
  if (raw.defaultPoints !== undefined) {
    const ok = typeof raw.defaultPoints === 'number' && Number.isFinite(raw.defaultPoints) && raw.defaultPoints >= 0;
    if (!ok) errors.push('defaultPoints must be a number >= 0');
    else defaultPoints = raw.defaultPoints;
  }

  // Taxonomy metadata (optional): `subject` is one kebab segment, `topics`
  // a unique list of them — the same vocabulary question banks already carry.
  // Publish stamps both onto the derived bank so selections stay classifiable.
  const SEGMENT = /^[a-z0-9][a-z0-9-]*$/;
  if (raw.subject !== undefined
      && (typeof raw.subject !== 'string' || !SEGMENT.test(raw.subject))) {
    errors.push('subject must be a kebab-case segment');
  } else if (typeof raw.subject === 'string' && typeof raw.id === 'string' && raw.id.includes('/')
      && raw.id.split('/')[0] !== raw.subject) {
    // A hierarchical id's first segment IS the subject — two fields naming
    // different subjects for one document is a contradiction, not metadata.
    errors.push(`subject must match the id's first segment ('${raw.id.split('/')[0]}')`);
  }
  if (raw.topics !== undefined) {
    const ok = Array.isArray(raw.topics) && raw.topics.length > 0 && raw.topics.length <= 12
      && raw.topics.every((topic) => typeof topic === 'string' && SEGMENT.test(topic))
      && new Set(raw.topics).size === raw.topics.length;
    if (!ok) errors.push('topics must be 1-12 unique kebab-case segments');
  }

  // `rev` (Task 3, spec §3/§4.2): optional here — a hand-authored v2 document
  // has none; `publishDocument` (documentSource.mjs) stamps one. Accepting it
  // as a plain hex string (not re-deriving/checking the hash here) keeps this
  // validator agnostic to *how* a rev was computed — that's publish's job.
  let rev;
  if (raw.rev !== undefined) {
    if (typeof raw.rev !== 'string' || !/^[0-9a-f]+$/i.test(raw.rev)) errors.push('rev must be a hex string when present');
    else rev = raw.rev;
  }

  const scanActionBlock = desugarSource(raw, errors, allowAnswers);
  const blocks = scanActionBlock
    ? (Array.isArray(raw.blocks) ? [scanActionBlock, ...raw.blocks] : raw.blocks)
    : raw.blocks;

  const v1Subset = {
    id: raw.id, seed: raw.seed, variant: raw.variant, target: raw.target, blocks,
  };
  if (raw.title !== undefined) v1Subset.title = raw.title;

  const v1Result = validateDocument(v1Subset, { allowAnswers });
  errors.push(...v1Result.errors);

  // Block x target matrix (spec §7): a target already known to be bogus (e.g.
  // 'poster') was already reported by validateDocument above as 'unknown
  // target' — re-flagging every block against it here would just be noise on
  // top of that error, so only recognised targets are checked.
  if (Array.isArray(raw.target)) {
    for (const target of raw.target) {
      if (!ALL_SUPPORTED_TARGETS.has(target)) continue;
      walkBlocks(blocks, (block, at) => {
        const supported = BLOCK_TARGET_SUPPORT[block?.type];
        if (supported && !supported.includes(target)) {
          errors.push(`${at}: block type '${block.type}' does not support target '${target}'`);
        }
      });
    }
  }

  // `page_break` forces a page boundary unconditionally (layout.mjs's
  // `placeFragments`), independent of whether the content actually overflows
  // a page — so a document that fits comfortably in half a page each still
  // measures pageCount > 1 with fit.policy 'one-page', and `resolveFitPlan`
  // reports FIT_OVERSET with oversetPt: 0 (nothing is actually oversized;
  // the break itself is what fails the policy). That is a confusing render
  // failure for what is really an authoring-time contradiction, so it is
  // rejected here instead, at a dotted path, before any measurement runs.
  if (fit.policy === 'one-page' && Array.isArray(blocks)) {
    walkBlocks(blocks, (block, at) => {
      if (block?.type === 'page_break') {
        errors.push(`${at}: page_break is incompatible with fit.policy 'one-page'`);
      }
    });
  }

  // Document-wide key uniqueness + cloze->wordbank ref resolution (spec
  // §4.3, §6.3) — see validateKeysAndWordbankRefs' own doc comment.
  if (Array.isArray(blocks)) validateKeysAndWordbankRefs(blocks, errors);

  // Quiz-archetype STRUCTURAL row-mapping check (Task 2, spec §5.3) — the
  // half of allocation.mjs's row-mappability rule that IS decidable from the
  // document alone, without a resolved bank: a SCORED quiz question whose own
  // nested content wraps a cloze/matching/short_answer block can never
  // resolve to a row-mappable bank item (`ROW_MAPPABLE_TYPES` in
  // allocation.mjs is multiple_choice/true_false/multi_select only — those
  // three block types mint items of exactly the types this list excludes).
  // Catching it here gives a dotted-path authoring error immediately, rather
  // than a confusing "itemId not found in bank" / "not row-mappable" surfacing
  // later from `planRows`, only once a bank happens to exist.
  //
  // Deliberately NOT checked here (stays at render-time planning, in
  // `allocation.mjs`'s `planRows`, which alone has the resolved bank item):
  // choice COUNT (>5 choices) and the row-mappable TYPE check for a question
  // whose `itemId` legitimately resolves via `choices`/`answer`/`answers` or
  // bank-select sugar — neither is decidable from the document alone. This
  // check only catches the one class of mistake that is: a question that
  // wraps non-row-mappable CONTENT as if that content were what gets scored,
  // when row-mapping actually resolves the question's own itemId.
  const NON_ROW_MAPPABLE_NESTED_TYPES = new Set(['cloze', 'matching', 'short_answer']);
  if (raw.archetype === 'quiz' && Array.isArray(blocks)) {
    walkBlocks(blocks, (block, at) => {
      if (block.type !== 'question' || block.select !== undefined) return;
      const points = typeof block.points === 'number' ? block.points : defaultPoints;
      if (!(points > 0) || !Array.isArray(block.blocks)) return;
      let offender = null;
      walkBlocks(block.blocks, (child) => {
        if (!offender && NON_ROW_MAPPABLE_NESTED_TYPES.has(child.type)) offender = child.type;
      }, { path: `${at}.blocks` });
      if (offender) {
        errors.push(`${at}: scored quiz question wraps a non-row-mappable '${offender}' block as its content (row-mapping resolves the question's own itemId, not nested content)`);
      }
    });
  }

  if (errors.length) return { errors };

  const document = {
    ...v1Result.document,
    schema: DOCUMENT_V2_SCHEMA,
    archetype: raw.archetype,
    header,
    fit,
    defaultPoints,
  };
  if (rev !== undefined) document.rev = rev;
  if (raw.subject !== undefined) document.subject = raw.subject;
  if (raw.topics !== undefined) document.topics = [...raw.topics];
  return { errors: [], document };
}

/**
 * Dispatches on `raw.schema`: v2 literal -> `validateDocumentV2`; the SOURCE
 * literal (Task 3, spec §3) -> `validateDocumentSource` (v2 rules with
 * answers permitted); absent -> the existing v1 `validateDocument`,
 * untouched; anything else -> a single 'unknown document schema' error. One
 * entry point for all three envelope generations (spec §4.1's "no migration
 * required" posture) — note a SOURCE document validating successfully here
 * does NOT make it renderable: only `publishDocument` (documentSource.mjs)
 * produces something a renderer may consume (spec §3's in-memory-publish
 * rule; Task 5 wires that into the render path).
 *
 * @param {*} raw
 * @returns {{ errors: string[], document?: object }}
 */
export function validateAnyDocument(raw) {
  if (!isPlainObject(raw)) return validateDocument(raw);
  if (raw.schema === DOCUMENT_V2_SCHEMA) return validateDocumentV2(raw);
  if (raw.schema === DOCUMENT_SOURCE_SCHEMA) return validateDocumentSource(raw);
  if (raw.schema === undefined) return validateDocument(raw);
  return { errors: ['unknown document schema'] };
}
