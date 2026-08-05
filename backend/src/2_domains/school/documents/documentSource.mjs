/**
 * Source stage + publish transform (spec §3, §4.3). Pure. No I/O.
 *
 * The AI (or human) authors ONE source file — `school.document-source/v1` —
 * where answers are legal. Publishing is a deterministic, pure function that
 * splits it into two artifacts:
 *
 *   source (answers legal)  --publishDocument-->  published document (answer-free)
 *                                             \->  derived question bank (answers)
 *
 * `validateDocumentSource` is `validateDocumentV2` run with
 * `{allowAnswers: true}` — same envelope/block/fit/key rules, just the
 * SOURCE-only per-field answer shapes (matching.pairs, a cloze blank's
 * answer, short_answer's answer, an inline question's answer/answers) are
 * legal instead of banned — with the schema literal swapped on the way out.
 *
 * `publishDocument` never emits a half-valid pair (spec §3's publish
 * postcondition): both the published document (against the STRICT, default
 * `validateDocumentV2`) and the derived bank (against `validateQuestionBank`)
 * are re-validated before anything is returned; a failure either way returns
 * `{errors}` and nothing else.
 */
import { DOCUMENT_V2_SCHEMA, validateDocumentV2 } from './documentV2.mjs';
import { questionPrompts } from './documentValidation.mjs';
import { validateQuestionBank } from '../questionBankValidation.mjs';

export const DOCUMENT_SOURCE_SCHEMA = 'school.document-source/v1';

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * @param {*} raw - one parsed source document
 * @returns {{ errors: string[], document?: object }} same shape/normalisation
 *   as `validateDocumentV2`, with `schema` swapped to the source literal.
 */
export function validateDocumentSource(raw) {
  const result = validateDocumentV2(raw, { allowAnswers: true });
  if (result.errors.length) return { errors: result.errors };
  return { errors: [], document: { ...result.document, schema: DOCUMENT_SOURCE_SCHEMA } };
}

// --- rev: sha256 over sorted-keys JSON of the validated source (spec §3) ---

/**
 * Recursively sort object keys so structurally-equal values digest
 * identically. Mirrors the pattern in
 * `3_applications/school/surfaces/GetSurfaceCertification.mjs` — duplicated
 * locally rather than imported: the domain layer must not import from the
 * application layer.
 */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((sorted, key) => {
      sorted[key] = sortKeys(value[key]);
      return sorted;
    }, {});
  }
  return value;
}

// Pure-JS SHA-256 (FIPS 180-4) — no `node:crypto` import. The School domain's
// own purity gate (`tests/isolated/application/school/schoolcalcArchitecture
// .test.mjs`, "keeps the School domain pure and independent of outer
// layers") rejects ANY import under `2_domains/school` other than `#domains/`
// or a relative path staying inside the domain root — Node builtins
// included. `generatedBanks/distractors.mjs` already establishes the
// precedent of a hand-rolled deterministic hash living directly in this
// domain for exactly this reason (its FNV-1a `hashSeed`); this is the same
// move for a real cryptographic digest, needed here because `rev` is a
// content-addressed identity (spec §4.3: prior revisions are retained
// append-only, so accidental collisions between different sources would
// silently alias two documents' derived banks) — a 32-bit hash's collision
// behavior isn't a safe substitute for that role the way it is for seeding a
// shuffle. Verified byte-for-byte against `node:crypto`'s `sha256` digest
// (empty string, ASCII, unicode, and long inputs) before being wired in here.
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const SHA256_H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

/** @returns {string} 64-char lowercase hex sha256 digest of `text` (UTF-8). */
function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((bytes.length + 9 + 63) & ~63);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);

  const H = SHA256_H0.slice();
  const w = new Uint32Array(64);
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(chunk + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

/** First 9 hex chars of the sha256 of `value`'s canonical (sorted-key) JSON form. */
function computeRev(value) {
  return sha256Hex(JSON.stringify(sortKeys(value))).slice(0, 9);
}

// --- keyless-item id scheme ---

/**
 * A dotted/bracketed block path (`blocks[2].blocks[1]`) collapsed into a safe
 * bank-item id fragment (`blocks-2-blocks-1`). Used for the two block types
 * that mint a bank item but carry no author-assigned identity of their own:
 *
 * - `short_answer` has no `key` field at all (spec §6.2 defines no shuffle
 *   for it — it doesn't shuffle, so it was never given one).
 * - `cloze` ALSO has no block-level `key` in the actual schema (Task 2's
 *   implementation, verified by reading blocks.mjs directly) — cloze isn't a
 *   shuffling block either (spec §4.3 requires `key` only for `wordbank`,
 *   `matching`, and bank-select `question`), so despite the task brief's
 *   `<key>-b<n>` example, there is no key to use. This function stands in for
 *   that missing key with the block's own document path; each blank then
 *   appends `-b<n>` on top (see `publishCloze`).
 *
 * Being positional, these ids are NOT stable under reordering/insertion the
 * way a keyed block's shuffle is (spec §4.3's stability guarantee is scoped
 * to KEYED blocks only) — an edit that moves a `short_answer`/`cloze` block
 * changes its id, and therefore the source's rev. That is expected, not a
 * bug: it is the same "no key -> no positional independence" tradeoff the
 * spec already draws for shuffles, just extended to identity.
 *
 * `matching` is NOT keyless — it already carries a required, document-unique
 * `key` (enforced by `documentV2.mjs`'s `validateKeysAndWordbankRefs`), so
 * its minted item id is that key directly, not a path.
 */
function pathId(at) {
  return at.replace(/\[(\d+)\]/g, '-$1').replace(/\./g, '-');
}

// --- publish-time block transforms ---

/** A cloze blank's answer masks the passage; the derived bank item's own
 * `prompt` needs exactly one `___` marker (questionBankValidation's cloze
 * shape) at the position of the blank BEING minted, and no others — every
 * other marker in the same passage is neutralised to a non-`___` token so it
 * can never be mistaken for a second blank. */
function clozePromptForBlank(text, targetN) {
  return text.replace(/\{\{(\d+)\}\}/g, (_match, numStr) => (Number(numStr) === targetN ? '___' : '[blank]'));
}

/** Resolves `matching.pairs` (idx-or-string refs into left/right) into the
 * `{left, right}` string-pair shape `questionBankValidation`'s `matching`
 * item type requires. Only ever called on an already-validated block (every
 * ref is guaranteed to resolve — `validateMatchingPairs` in blocks.mjs
 * checked that at source-validation time), so no error path is needed here. */
function resolveMatchingPairs(block) {
  const resolveRef = (ref, arr) => {
    if (Number.isInteger(ref) && ref >= 0 && ref < arr.length) return arr[ref];
    return ref;
  };
  return block.pairs.map((pair) => ({
    left: resolveRef(pair.left, block.left),
    right: resolveRef(pair.right, block.right),
  }));
}

const MATCHING_PROMPT = 'Match each item on the left with its correct pair on the right.';

function mintedQuestionPrompt(itemId, promptsByItemId) {
  const entry = promptsByItemId.get(itemId);
  return (entry && isNonEmptyString(entry.prompt)) ? entry.prompt : itemId;
}

function publishMatching(block, items) {
  const published = { ...block };
  if (block.pairs !== undefined) {
    items.push({
      id: block.key,
      type: 'matching',
      prompt: MATCHING_PROMPT,
      pairs: resolveMatchingPairs(block),
    });
    published.itemRef = block.key;
    delete published.pairs;
  }
  return published;
}

function publishCloze(block, at, items) {
  const published = { ...block };
  published.blanks = block.blanks.map((blank) => {
    const publishedBlank = { ...blank };
    if (blank.answer !== undefined) {
      const id = `${pathId(at)}-b${blank.n}`;
      items.push({
        id,
        type: 'cloze',
        prompt: clozePromptForBlank(block.text, blank.n),
        answer: blank.answer,
      });
      publishedBlank.itemRef = id;
      delete publishedBlank.answer;
    }
    return publishedBlank;
  });
  return published;
}

function publishShortAnswer(block, at, items) {
  const published = { ...block };
  if (block.answer !== undefined) {
    const id = pathId(at);
    items.push({ id, type: 'short_answer', prompt: block.prompt, answer: block.answer });
    published.itemRef = id;
    delete published.answer;
  }
  return published;
}

/**
 * An inline `question` (itemId/number/blocks form — NOT the bank-select
 * `select` sugar) may carry `choices`/`answer`/`answers` directly (spec
 * §6.1's disposition table: "extended with ... the multi_select shape").
 * These aren't block-shape-checked by `blocks.mjs` beyond the generic
 * whole-tree answer-key ban/allow (`collectAnswerKeys` in
 * documentValidation.mjs already gates `answer`/`answers` presence by
 * `allowAnswers`, exactly like every other field this module strips) — this
 * function is where the SHAPE becomes real: it mints a `multi_select`,
 * `multiple_choice`, or `short_answer` bank item depending on which fields
 * are present, and strips only the secret (`answer`/`answers`); `choices`
 * stays on the published question — it is what the printed sheet shows the
 * student, not a secret.
 *
 * `question.itemId` is already required and document-wide unique
 * (documentValidation's itemId check), so it is used AS the minted item's
 * id directly — no synthesized reference field is needed (unlike
 * matching/cloze/short_answer, which have no such pre-existing identity).
 */
function publishQuestion(block, at, items, promptsByItemId, recurse) {
  if (block.select !== undefined) return block; // bank-select sugar already references an existing bank (spec §3): passes through untouched
  const published = { ...block };
  if (Array.isArray(block.blocks)) published.blocks = recurse(block.blocks, `${at}.blocks`);
  if (block.answers !== undefined) {
    items.push({
      id: block.itemId,
      type: 'multi_select',
      prompt: mintedQuestionPrompt(block.itemId, promptsByItemId),
      choices: block.choices,
      answers: block.answers,
    });
    delete published.answers;
  } else if (block.answer !== undefined) {
    const item = Array.isArray(block.choices)
      ? { id: block.itemId, type: 'multiple_choice', prompt: mintedQuestionPrompt(block.itemId, promptsByItemId), choices: block.choices, answer: block.answer }
      : { id: block.itemId, type: 'short_answer', prompt: mintedQuestionPrompt(block.itemId, promptsByItemId), answer: block.answer };
    items.push(item);
    delete published.answer;
  }
  return published;
}

/**
 * Depth-first publish transform over the block tree. Blocks can nest inside
 * `question` and `inset`; every other type either has no answer-bearing
 * field (wordbank terms are presentation, spec §3) or has already been
 * handled by one of the four functions above. `items` is mutated in place
 * (pushed to in document order) rather than merged from return values — the
 * tree shape isn't 1:1 with the item list (cloze mints 0..N items per block).
 */
function publishBlocks(blocks, path, items, promptsByItemId) {
  if (!Array.isArray(blocks)) return blocks;
  const recurse = (childBlocks, childPath) => publishBlocks(childBlocks, childPath, items, promptsByItemId);
  return blocks.map((block, i) => {
    const at = `${path}[${i}]`;
    if (!block || typeof block !== 'object') return block;
    switch (block.type) {
      case 'question': return publishQuestion(block, at, items, promptsByItemId, recurse);
      case 'matching': return publishMatching(block, items);
      case 'cloze': return publishCloze(block, at, items);
      case 'short_answer': return publishShortAnswer(block, at, items);
      case 'inset': return { ...block, blocks: recurse(block.blocks, `${at}.blocks`) };
      default: return block;
    }
  });
}

/**
 * @param {*} rawSource - one parsed `school.document-source/v1` document
 * @returns {{ errors: string[] } | { published: object, bank: object|null, rev: string }}
 *   `bank` is `null` when the source has no answer-bearing content at all
 *   (a purely presentational worksheet is legal and mints nothing).
 */
export function publishDocument(rawSource) {
  const { errors: sourceErrors, document: validatedSource } = validateDocumentSource(rawSource);
  if (sourceErrors.length) return { errors: sourceErrors };

  const rev = computeRev(validatedSource);
  const promptsByItemId = questionPrompts({ blocks: validatedSource.blocks });
  const items = [];
  const publishedBlocks = publishBlocks(validatedSource.blocks, 'blocks', items, promptsByItemId);

  const publishedCandidate = {
    ...validatedSource, schema: DOCUMENT_V2_SCHEMA, rev, blocks: publishedBlocks,
  };

  // Publish postcondition, part 1 (spec §3): the published document must
  // re-validate under the STRICT (answer-free, default allowAnswers: false)
  // gate. Never emit a document that could carry an answer back to a
  // learner's printer.
  const postcheck = validateDocumentV2(publishedCandidate);
  if (postcheck.errors.length) {
    return { errors: postcheck.errors.map((e) => `publish postcondition (published document): ${e}`) };
  }

  if (items.length === 0) {
    return { published: postcheck.document, bank: null, rev };
  }

  const bankId = `derived/${validatedSource.id}@${rev}`;
  const rawBank = { id: bankId, title: validatedSource.title || validatedSource.id, items };

  // Publish postcondition, part 2: the derived bank must be a real,
  // consumable question bank. A minted shape that doesn't fit
  // `validateQuestionBank` (an id collision between two independently-scoped
  // minting schemes, a 1-choice multiple_choice, etc.) fails HERE — never a
  // half-valid pair.
  const bankResult = validateQuestionBank(rawBank);
  if (!bankResult.ok) {
    return { errors: bankResult.errors.map((e) => `publish postcondition (derived bank): ${e}`) };
  }

  return { published: postcheck.document, bank: bankResult.bank, rev };
}
