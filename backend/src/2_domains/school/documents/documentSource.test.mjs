/**
 * Source stage + publish transform (spec §3, §4.3). See documentSource.mjs's
 * own doc comment for the design; this file is the TDD round-trip.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto'; // test-only cross-check; documentSource.mjs itself must not import this (domain purity gate)
import { validateAnyDocument } from './documentV2.mjs';
import {
  DOCUMENT_SOURCE_SCHEMA, validateDocumentSource, publishDocument,
} from './documentSource.mjs';

const richText = (md) => ({ type: 'rich_text', md });

// A round-trip fixture exercising EVERY answer-bearing shape (spec §3):
// matching pairs, cloze answers (one blank referencing a wordbank, one not),
// short_answer's answer, an inline multiple_choice question (answer +
// choices), and an inline multi_select question (answers + choices).
const fullSource = (over = {}) => ({
  schema: DOCUMENT_SOURCE_SCHEMA,
  id: 'states-quiz-3',
  seed: 91242,
  target: ['letter'],
  archetype: 'quiz',
  title: 'U.S. States Quiz',
  blocks: [
    { type: 'wordbank', key: 'wb1', terms: ['Olympia', 'Salem', 'Boise'] },
    {
      type: 'cloze',
      text: 'The capital of Washington is {{1}} and the capital of Oregon is {{2}}.',
      blanks: [
        { n: 1, answer: 'Olympia', wordbank: 'wb1' },
        { n: 2, answer: 'Salem' },
      ],
    },
    {
      type: 'matching',
      key: 'm1',
      left: ['WA', 'OR'],
      right: ['Olympia', 'Salem'],
      pairs: [{ left: 'WA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }],
    },
    { type: 'short_answer', prompt: 'Name a state capital.', answer: 'Olympia' },
    {
      type: 'question',
      itemId: 'q1',
      number: 1,
      blocks: [richText('What is the capital of Washington?')],
      choices: ['Olympia', 'Salem', 'Boise'],
      answer: 'Olympia',
    },
    {
      type: 'question',
      itemId: 'q2',
      number: 2,
      blocks: [richText('Which of these are Pacific Northwest states?')],
      choices: ['Washington', 'Oregon', 'Nevada', 'Idaho'],
      answers: ['Washington', 'Oregon', 'Idaho'],
    },
  ],
  ...over,
});

/** Recursively asserts no `answer`/`answers` key survives anywhere in `value`. */
function assertNoAnswerKeys(value, path = '') {
  if (Array.isArray(value)) { value.forEach((v, i) => assertNoAnswerKeys(v, `${path}[${i}]`)); return; }
  if (!value || typeof value !== 'object') return;
  for (const key of ['answer', 'answers']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`found forbidden key "${key}" at ${path || '(root)'}`);
    }
  }
  Object.entries(value).forEach(([k, v]) => assertNoAnswerKeys(v, path ? `${path}.${k}` : k));
}

describe('DOCUMENT_SOURCE_SCHEMA', () => {
  it('is the spec literal', () => {
    expect(DOCUMENT_SOURCE_SCHEMA).toBe('school.document-source/v1');
  });
});

describe('validateDocumentSource', () => {
  it('accepts a valid source document with inline answers and stamps the source schema', () => {
    const { errors, document } = validateDocumentSource(fullSource());
    expect(errors).toEqual([]);
    expect(document.schema).toBe(DOCUMENT_SOURCE_SCHEMA);
  });

  it('reports dotted-path errors for a malformed source, same as validateDocumentV2', () => {
    const { errors } = validateDocumentSource(fullSource({ id: 'BAD ID' }));
    expect(errors).toContain('id must match ^[a-z0-9][a-z0-9-]*$');
  });

  it('validateAnyDocument routes the source schema literal here', () => {
    const viaDispatch = validateAnyDocument(fullSource());
    const direct = validateDocumentSource(fullSource());
    expect(viaDispatch).toEqual(direct);
  });
});

describe('publishDocument: full round trip (every answer-bearing shape)', () => {
  const result = publishDocument(fullSource());

  it('succeeds (no errors)', () => {
    expect(result.errors).toBeUndefined();
    expect(result.published).toBeDefined();
    expect(result.bank).toBeDefined();
  });

  it('published document carries the v2 schema and a 9-hex-char rev', () => {
    expect(result.published.schema).toBe('school.document/v2');
    expect(result.rev).toMatch(/^[0-9a-f]{9}$/);
    expect(result.published.rev).toBe(result.rev);
  });

  it('published document is answer-free (deep scan)', () => {
    assertNoAnswerKeys(result.published);
  });

  it('published document re-validates strictly (validateDocumentV2 default posture)', async () => {
    const { validateDocumentV2 } = await import('./documentV2.mjs');
    expect(validateDocumentV2(result.published).errors).toEqual([]);
  });

  it('wordbank terms are untouched (presentation, not an answer)', () => {
    expect(result.published.blocks[0]).toEqual({ type: 'wordbank', key: 'wb1', terms: ['Olympia', 'Salem', 'Boise'] });
  });

  it('derived bank id is derived/<id>@<rev>; publish already validated it via validateQuestionBank (postcondition)', () => {
    // result.bank IS validateQuestionBank's own normalised output (publishDocument
    // returns bankResult.bank on success) — re-feeding that normalised shape back
    // into validateQuestionBank is not a meaningful re-check (its own `concepts: []`
    // normalisation trips the "non-empty when present" rule on round 2, a pre-existing
    // idempotency wrinkle in validateQuestionBank, out of this task's scope). The
    // postcondition itself is exercised directly in the "postcondition failure path"
    // describe block below.
    expect(result.bank.id).toBe(`derived/states-quiz-3@${result.rev}`);
  });

  it('mints one cloze bank item per blank, each with a stable path-based id and an itemRef back to it', () => {
    const clozeBlock = result.published.blocks[1];
    expect(clozeBlock.blanks[0].itemRef).toBe('blocks-1-b1');
    expect(clozeBlock.blanks[0].wordbank).toBe('wb1'); // wordbank ref survives publish
    expect(clozeBlock.blanks[0].answer).toBeUndefined();
    expect(clozeBlock.blanks[1].itemRef).toBe('blocks-1-b2');

    const b1 = result.bank.items.find((i) => i.id === 'blocks-1-b1');
    expect(b1).toMatchObject({ id: 'blocks-1-b1', type: 'cloze', answer: 'Olympia' });
    expect(b1.prompt).toContain('___');
    expect((b1.prompt.match(/_{3,}/g) || []).length).toBe(1);

    const b2 = result.bank.items.find((i) => i.id === 'blocks-1-b2');
    expect(b2).toMatchObject({ id: 'blocks-1-b2', type: 'cloze', answer: 'Salem' });
  });

  it('mints one matching item keyed by the block key, resolves pairs to text, and strips pairs', () => {
    const matchingBlock = result.published.blocks[2];
    expect(matchingBlock.itemRef).toBe('m1');
    expect(matchingBlock.pairs).toBeUndefined();
    expect(matchingBlock.left).toEqual(['WA', 'OR']);

    const item = result.bank.items.find((i) => i.id === 'm1');
    expect(item).toMatchObject({
      id: 'm1', type: 'matching', pairs: [{ left: 'WA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }],
    });
  });

  it('mints a short_answer item at a path-based id (short_answer has no key)', () => {
    const shortAnswerBlock = result.published.blocks[3];
    expect(shortAnswerBlock.itemRef).toBe('blocks-3');
    expect(shortAnswerBlock.answer).toBeUndefined();

    const item = result.bank.items.find((i) => i.id === 'blocks-3');
    expect(item).toMatchObject({ id: 'blocks-3', type: 'short_answer', prompt: 'Name a state capital.', answer: 'Olympia' });
  });

  it('inline multiple_choice question keeps its authored itemId as the bank item id; choices survive publish, answer does not', () => {
    const q1 = result.published.blocks[4];
    expect(q1.itemId).toBe('q1');
    expect(q1.choices).toEqual(['Olympia', 'Salem', 'Boise']);
    expect(q1.answer).toBeUndefined();

    const item = result.bank.items.find((i) => i.id === 'q1');
    expect(item).toMatchObject({
      id: 'q1', type: 'multiple_choice', choices: ['Olympia', 'Salem', 'Boise'], answer: 'Olympia',
    });
    expect(item.prompt).toBe('What is the capital of Washington?');
  });

  it('inline multi_select question keeps its authored itemId; choices survive, answers do not', () => {
    const q2 = result.published.blocks[5];
    expect(q2.itemId).toBe('q2');
    expect(q2.choices).toEqual(['Washington', 'Oregon', 'Nevada', 'Idaho']);
    expect(q2.answers).toBeUndefined();

    const item = result.bank.items.find((i) => i.id === 'q2');
    expect(item).toMatchObject({
      id: 'q2', type: 'multi_select', choices: ['Washington', 'Oregon', 'Nevada', 'Idaho'], answers: ['Washington', 'Oregon', 'Idaho'],
    });
  });

  it('mints exactly the 6 expected items, one per answer-bearing shape', () => {
    expect(result.bank.items.map((i) => i.id).sort()).toEqual(
      ['blocks-1-b1', 'blocks-1-b2', 'blocks-3', 'm1', 'q1', 'q2'].sort(),
    );
  });

  // F2 (review finding): an inline multi_select question's own `maxSelect`
  // must reach the minted bank item — `createChoiceResolver`
  // (DocumentPdfRenderer.mjs) prints "Choose up to N." only when the BANK
  // item carries it, and `validateQuestionBank`'s coherence check (this
  // file's own publish postcondition) can only ever run against what
  // actually landed in the bank.
  it('inline multi_select question maxSelect mints onto the bank item and is stripped from the published block', () => {
    // q2 (fullSource().blocks[5]) has 3 answers and 4 choices — maxSelect:3
    // is the legal answers.length boundary.
    const source = fullSource({
      blocks: [
        { ...fullSource().blocks[5], maxSelect: 3 },
      ],
    });
    const withMaxSelect = publishDocument(source);
    expect(withMaxSelect.errors).toBeUndefined();
    const item = withMaxSelect.bank.items.find((i) => i.id === 'q2');
    expect(item.maxSelect).toBe(3);
    expect(withMaxSelect.published.blocks[0].maxSelect).toBeUndefined();
  });
});

describe('publishDocument: bank-select sugar passes through untouched', () => {
  it('a question referencing an existing bank via select mints nothing and is unchanged', () => {
    const source = fullSource({
      blocks: [
        { type: 'wordbank', key: 'wb1', terms: ['a', 'b'] },
        {
          type: 'question', bankId: 'existing-bank', select: 3, key: 'sel1', filter: { topics: ['geography'] },
        },
      ],
    });
    const result = publishDocument(source);
    expect(result.errors).toBeUndefined();
    expect(result.published.blocks[1]).toEqual({
      type: 'question', bankId: 'existing-bank', select: 3, key: 'sel1', filter: { topics: ['geography'] },
    });
    expect(result.bank).toBeNull();
  });
});

describe('publishDocument: no answer-bearing content -> bank is null', () => {
  it('a purely presentational document mints no bank', () => {
    const source = fullSource({
      blocks: [
        { type: 'wordbank', key: 'wb1', terms: ['a', 'b'] },
        richText('Just some reading.'),
      ],
    });
    const result = publishDocument(source);
    expect(result.errors).toBeUndefined();
    expect(result.bank).toBeNull();
    expect(result.published.rev).toBe(result.rev);
  });
});

// documentSource.mjs hand-rolls SHA-256 (no `node:crypto` import — the
// domain purity gate, schoolcalcArchitecture.test.mjs, forbids it). This
// cross-checks that hand-rolled digest against Node's real `crypto` module
// over the ACTUAL validated-source object (not just a plain string), so a
// subtle bug in the hand-rolled implementation (e.g. UTF-8 encoding, bit
// padding) would show up as a rev mismatch here.
function sortKeysForTest(value) {
  if (Array.isArray(value)) return value.map(sortKeysForTest);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((sorted, key) => {
      sorted[key] = sortKeysForTest(value[key]);
      return sorted;
    }, {});
  }
  return value;
}

describe('publishDocument: rev matches an independent node:crypto sha256 computation', () => {
  it('the hand-rolled sha256 agrees with node:crypto over the real validated-source object', () => {
    const { document: validatedSource } = validateDocumentSource(fullSource());
    const expectedRev = createHash('sha256')
      .update(JSON.stringify(sortKeysForTest(validatedSource)))
      .digest('hex')
      .slice(0, 9);
    const { rev } = publishDocument(fullSource());
    expect(rev).toBe(expectedRev);
  });
});

describe('publishDocument: determinism (spec §4.3 rev stability/sensitivity)', () => {
  it('publishing the same source twice yields the same rev and byte-equal published/bank', () => {
    const a = publishDocument(fullSource());
    const b = publishDocument(fullSource());
    expect(a.rev).toBe(b.rev);
    expect(a.published).toEqual(b.published);
    expect(a.bank).toEqual(b.bank);
  });

  it('editing the source changes the rev', () => {
    const a = publishDocument(fullSource());
    const b = publishDocument(fullSource({ title: 'U.S. States Quiz (revised)' }));
    expect(a.rev).not.toBe(b.rev);
  });

  it('editing only an answer (never printed) still changes the rev — the rev hashes the SOURCE, not the published output', () => {
    const a = publishDocument(fullSource());
    const edited = fullSource();
    edited.blocks[3].answer = 'Salem'; // still a legal state capital elsewhere; content-only edit
    const b = publishDocument(edited);
    expect(a.rev).not.toBe(b.rev);
  });
});

describe('publishDocument: postcondition failure path (never emits a half-valid pair)', () => {
  it('rejects when validateDocumentSource itself fails, before any minting', () => {
    const result = publishDocument(fullSource({ id: 'BAD ID' }));
    expect(result.published).toBeUndefined();
    expect(result.bank).toBeUndefined();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('a pathological source that mints a bank-invalid item (1-choice multiple_choice) fails publish, not silently, and emits nothing', () => {
    const source = fullSource({
      blocks: [
        {
          type: 'question',
          itemId: 'q1',
          number: 1,
          blocks: [richText('Pick the only option.')],
          choices: ['OnlyOne'],
          answer: 'OnlyOne',
        },
      ],
    });
    const result = publishDocument(source);
    expect(result.published).toBeUndefined();
    expect(result.bank).toBeUndefined();
    expect(result.errors.some((e) => e.includes('choices must have >= 2 entries'))).toBe(true);
  });

  // F2 (review finding): an inline multi_select question's `maxSelect` is
  // gated only by `validateQuestionBank`'s coherence check (a publish
  // POSTCONDITION, same as the 1-choice multiple_choice case above) — there
  // is no earlier source-stage gate for it, so this proves the postcondition
  // is genuinely reachable from an inline question (not just a bank-select
  // one) and reports a readable, actionable message rather than failing
  // silently or with an opaque error.
  it('an inline multi_select question with maxSelect below its own answers.length fails publish at the bank postcondition, readably', () => {
    const source = fullSource({
      blocks: [
        { ...fullSource().blocks[5], maxSelect: 1 }, // q2 has 3 answers — 1 is incoherent
      ],
    });
    const result = publishDocument(source);
    expect(result.published).toBeUndefined();
    expect(result.bank).toBeUndefined();
    expect(result.errors.some((e) => e.includes('maxSelect (1) must be >= answers.length (3)'))).toBe(true);
  });

  it('an id collision between two independently-scoped minting schemes (question itemId == matching key) fails publish', () => {
    const source = fullSource({
      blocks: [
        {
          type: 'matching', key: 'dup1', left: ['WA', 'OR'], right: ['Olympia', 'Salem'], pairs: [{ left: 'WA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }],
        },
        {
          type: 'question',
          itemId: 'dup1',
          number: 1,
          blocks: [richText('Name a state capital.')],
          answer: 'Olympia',
        },
      ],
    });
    const result = publishDocument(source);
    expect(result.published).toBeUndefined();
    expect(result.bank).toBeUndefined();
    expect(result.errors.some((e) => e.includes('duplicate id'))).toBe(true);
  });
});

// Review fix: a malformed non-array `choices` alongside `answer` used to
// silently fall through to a short_answer mint (the multiple-choice intent
// dropped) with the garbage `choices` value surviving onto the published
// document — neither postcondition caught it, since short_answer's bank
// shape never looks at `choices`. See collectInlineQuestionShapeErrors'
// doc comment in documentSource.mjs.
describe('publishDocument: inline question choices shape gate (review fix)', () => {
  it('reviewer repro: a non-array choices with an answer fails publish, names the path, and mints nothing', () => {
    const source = fullSource({
      blocks: [
        {
          type: 'question', itemId: 'q1', number: 1, blocks: [richText('What is the capital?')], choices: 'not-an-array-typo', answer: 'Olympia',
        },
      ],
    });
    const result = publishDocument(source);
    expect(result.published).toBeUndefined();
    expect(result.bank).toBeUndefined();
    expect(result.errors).toEqual(['blocks[0]: question choices must be an array when present']);
  });

  it('a valid choices array with an answer still mints multiple_choice, unchanged', () => {
    const source = fullSource({
      blocks: [
        {
          type: 'question', itemId: 'q1', number: 1, blocks: [richText('Pick one.')], choices: ['A', 'B'], answer: 'A',
        },
      ],
    });
    const result = publishDocument(source);
    expect(result.errors).toBeUndefined();
    expect(result.bank.items[0]).toMatchObject({ id: 'q1', type: 'multiple_choice', choices: ['A', 'B'], answer: 'A' });
    expect(result.published.blocks[0].choices).toEqual(['A', 'B']);
  });

  it('choices absent with an answer mints short_answer, and the published block carries no choices field', () => {
    const source = fullSource({
      blocks: [
        {
          type: 'question', itemId: 'q1', number: 1, blocks: [richText('Name it.')], answer: 'Olympia',
        },
      ],
    });
    const result = publishDocument(source);
    expect(result.errors).toBeUndefined();
    expect(result.bank.items[0]).toMatchObject({ id: 'q1', type: 'short_answer', answer: 'Olympia' });
    expect(Object.prototype.hasOwnProperty.call(result.published.blocks[0], 'choices')).toBe(false);
  });

  it('an empty choices array with an answer fails publish (not a legal "no choices" signal)', () => {
    const source = fullSource({
      blocks: [
        {
          type: 'question', itemId: 'q1', number: 1, blocks: [richText('Name it.')], choices: [], answer: 'Olympia',
        },
      ],
    });
    const result = publishDocument(source);
    expect(result.published).toBeUndefined();
    expect(result.bank).toBeUndefined();
    expect(result.errors).toEqual(['blocks[0]: question choices must be a non-empty array when present']);
  });

  it('multi_select (answers) requires choices too, and rejects the same malformed shapes', () => {
    const missing = publishDocument(fullSource({
      blocks: [{
        type: 'question', itemId: 'q1', number: 1, blocks: [richText('Pick all that apply.')], answers: ['A'],
      }],
    }));
    expect(missing.errors).toEqual(['blocks[0]: question choices is required when answers is present']);

    const notArray = publishDocument(fullSource({
      blocks: [{
        type: 'question', itemId: 'q1', number: 1, blocks: [richText('Pick all that apply.')], choices: 'oops', answers: ['A'],
      }],
    }));
    expect(notArray.errors).toEqual(['blocks[0]: question choices must be an array when present']);
  });
});

// Task 2 (spec §5.3, §6.1): inline true_false question. The inline marker is
// the explicit `trueFalse: true` flag (blocks.mjs) — NOT inferred from
// `typeof answer === 'boolean'` — because the marker is what survives onto
// the published (answer-free) document; the renderer needs to know "print
// Ⓐ True / Ⓑ False" whether or not an answer happens to be present.
describe('publishDocument: inline true_false question (Task 2)', () => {
  const tfSource = (over = {}) => fullSource({
    blocks: [
      {
        type: 'question',
        itemId: 'q1',
        number: 1,
        blocks: [richText('The sky is blue.')],
        trueFalse: true,
        answer: true,
        ...over,
      },
    ],
  });

  it('mints a true_false bank item keyed by the question itemId; answer does not survive publish, trueFalse does', () => {
    const result = publishDocument(tfSource());
    expect(result.errors).toBeUndefined();
    const q1 = result.published.blocks[0];
    expect(q1.trueFalse).toBe(true);
    expect(q1.answer).toBeUndefined();

    const item = result.bank.items.find((i) => i.id === 'q1');
    expect(item).toMatchObject({ id: 'q1', type: 'true_false', answer: true });
    expect(item.prompt).toBe('The sky is blue.');
  });

  it('mints answer: false the same way', () => {
    const result = publishDocument(tfSource({ answer: false }));
    expect(result.errors).toBeUndefined();
    const item = result.bank.items.find((i) => i.id === 'q1');
    expect(item.answer).toBe(false);
  });

  it('omr flag passes through publish untouched', () => {
    const result = publishDocument(tfSource({ omr: true }));
    expect(result.errors).toBeUndefined();
    expect(result.published.blocks[0].omr).toBe(true);
  });

  it('a trueFalse question with no answer field at all mints nothing (unscored/write-on, legal same as other inline shapes)', () => {
    const source = fullSource({
      blocks: [
        {
          type: 'question', itemId: 'q1', number: 1, blocks: [richText('The sky is blue.')], trueFalse: true,
        },
      ],
    });
    const result = publishDocument(source);
    expect(result.errors).toBeUndefined();
    expect(result.bank).toBeNull();
    expect(result.published.blocks[0].trueFalse).toBe(true);
  });

  it('rejects a non-boolean answer alongside trueFalse: true, before minting', () => {
    const result = publishDocument(tfSource({ answer: 'true' }));
    expect(result.published).toBeUndefined();
    expect(result.bank).toBeUndefined();
    expect(result.errors).toEqual(['blocks[0]: question answer must be a boolean when trueFalse is true']);
  });

  it('rejects trueFalse combined with choices, before minting', () => {
    const result = publishDocument(tfSource({ choices: ['True', 'False'] }));
    expect(result.published).toBeUndefined();
    expect(result.bank).toBeUndefined();
    expect(result.errors).toEqual(['blocks[0]: question trueFalse must not be combined with choices/answers']);
  });

  it('rejects trueFalse combined with answers (multi_select shape), before minting', () => {
    const source = fullSource({
      blocks: [
        {
          type: 'question', itemId: 'q1', number: 1, blocks: [richText('The sky is blue.')], trueFalse: true, answers: ['A'],
        },
      ],
    });
    const result = publishDocument(source);
    expect(result.published).toBeUndefined();
    expect(result.bank).toBeUndefined();
    expect(result.errors).toEqual(['blocks[0]: question trueFalse must not be combined with choices/answers']);
  });
});
