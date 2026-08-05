/**
 * Envelope v2 validation + dispatch (spec §4). See documentV2.mjs for the
 * design notes on the source-desugar error-path approach.
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from './documentValidation.mjs';
import {
  DOCUMENT_V2_SCHEMA, ARCHETYPES, FIT_POLICIES, BLOCK_TARGET_SUPPORT,
  validateDocumentV2, validateAnyDocument,
} from './documentV2.mjs';

const question = (over = {}) => ({
  type: 'question',
  itemId: 'q1',
  number: 1,
  blocks: [{ type: 'rich_text', md: 'What is $x$?' }, { type: 'answer_space', minPt: 40, maxPt: 120 }],
  ...over,
});

const v2doc = (over = {}) => ({
  schema: DOCUMENT_V2_SCHEMA,
  id: 'states-quiz-3',
  seed: 91242,
  target: ['letter'],
  archetype: 'quiz',
  blocks: [question()],
  ...over,
});

describe('module constants', () => {
  it('exports the schema literal and closed archetype/fit-policy sets', () => {
    expect(DOCUMENT_V2_SCHEMA).toBe('school.document/v2');
    expect(ARCHETYPES).toEqual(['quiz', 'worksheet', 'infopage']);
    expect(FIT_POLICIES).toEqual(['flow', 'one-page', 'fill']);
  });
});

describe('validateDocumentV2: minimal valid quiz', () => {
  it('applies every default and normalises field-by-field', () => {
    const { errors, document } = validateDocumentV2(v2doc());
    expect(errors).toEqual([]);
    expect(document.schema).toBe(DOCUMENT_V2_SCHEMA);
    expect(document.id).toBe('states-quiz-3');
    expect(document.seed).toBe(91242);
    expect(document.variant).toBe(0);
    expect(document.target).toEqual(['letter']);
    expect(document.archetype).toBe('quiz');
    expect(document.header).toEqual({ name: true, date: true, scoreBox: true });
    expect(document.fit).toEqual({ policy: 'flow', typeScale: 'standard' });
    expect(document.defaultPoints).toBe(1);
    expect(document.blocks).toHaveLength(1);
    expect(document.blocks[0].type).toBe('question');
  });
});

describe('validateAnyDocument: v1 passthrough', () => {
  it('dispatches a schema-less document to the existing v1 validator, unchanged', () => {
    const raw = {
      id: 'algebra-1-set-a',
      seed: 12345,
      target: ['letter'],
      blocks: [question()],
    };
    expect(validateAnyDocument(raw)).toEqual(validateDocument(raw));
  });
});

describe('validateAnyDocument: unknown schema', () => {
  it('rejects a schema value that is neither v2 nor absent', () => {
    const { errors } = validateAnyDocument({ ...v2doc(), schema: 'school.document/v99' });
    expect(errors).toContain('unknown document schema');
  });
});

describe('validateAnyDocument: v2 dispatch', () => {
  it('routes schema === v2 to validateDocumentV2', () => {
    expect(validateAnyDocument(v2doc())).toEqual(validateDocumentV2(v2doc()));
  });
});

describe('validateDocumentV2: archetype presets', () => {
  it.each([
    ['quiz', { name: true, date: true, scoreBox: true }],
    ['worksheet', { name: true, date: true, scoreBox: false }],
    ['infopage', { name: false, date: false, scoreBox: false }],
  ])('applies the %s header preset', (archetype, expected) => {
    const { errors, document } = validateDocumentV2(v2doc({ archetype }));
    expect(errors).toEqual([]);
    expect(document.header).toEqual(expected);
  });

  it('lets explicit header fields override the archetype preset', () => {
    const { errors, document } = validateDocumentV2(
      v2doc({ archetype: 'worksheet', header: { scoreBox: true, instructions: 'Show your work.' } }),
    );
    expect(errors).toEqual([]);
    expect(document.header).toEqual({
      name: true, date: true, scoreBox: true, instructions: 'Show your work.',
    });
  });
});

describe('validateDocumentV2: source desugar', () => {
  it('prepends a scan_action block and drops the envelope source field', () => {
    const raw = v2doc({ source: { action: 'launch-states-video', label: 'Watch the review video' } });
    const { errors, document } = validateDocumentV2(raw);
    expect(errors).toEqual([]);
    expect(document.source).toBeUndefined();
    expect(document.blocks[0]).toEqual({
      type: 'scan_action', action: 'launch-states-video', label: 'Watch the review video',
    });
    expect(document.blocks[1].type).toBe('question');
  });

  it('reports a malformed source under the source path, not blocks[0]', () => {
    const raw = v2doc({ source: { action: '', label: 'Watch the review video' } });
    const { errors } = validateDocumentV2(raw);
    expect(errors.some((e) => e.startsWith('source'))).toBe(true);
    expect(errors.some((e) => e.startsWith('blocks[0]'))).toBe(false);
  });
});

describe('validateDocumentV2: rejections', () => {
  it('rejects an unknown archetype', () => {
    const { errors } = validateDocumentV2(v2doc({ archetype: 'lecture' }));
    expect(errors.some((e) => e.includes('archetype'))).toBe(true);
  });

  it('rejects an unknown fit.policy', () => {
    const { errors } = validateDocumentV2(v2doc({ fit: { policy: 'shrinkwrap' } }));
    expect(errors.some((e) => e.includes('fit.policy'))).toBe(true);
  });

  it('rejects an unknown fit.typeScale', () => {
    const { errors } = validateDocumentV2(v2doc({ fit: { typeScale: 'giant' } }));
    expect(errors.some((e) => e.includes('fit.typeScale'))).toBe(true);
  });

  it.each(['name', 'date', 'scoreBox'])('rejects a non-boolean header.%s', (field) => {
    const { errors } = validateDocumentV2(v2doc({ header: { [field]: 'yes' } }));
    expect(errors.some((e) => e.includes(`header.${field}`))).toBe(true);
  });

  it('rejects a non-string header.instructions', () => {
    const { errors } = validateDocumentV2(v2doc({ header: { instructions: 42 } }));
    expect(errors.some((e) => e.includes('header.instructions'))).toBe(true);
  });

  it.each([-1, '1', NaN, Infinity])('rejects a defaultPoints of %s', (defaultPoints) => {
    const { errors } = validateDocumentV2(v2doc({ defaultPoints }));
    expect(errors.some((e) => e.includes('defaultPoints'))).toBe(true);
  });

  it('accepts a zero defaultPoints', () => {
    const { errors, document } = validateDocumentV2(v2doc({ defaultPoints: 0 }));
    expect(errors).toEqual([]);
    expect(document.defaultPoints).toBe(0);
  });

  it.each(['one-page', 'fill'])("rejects fit.policy '%s' combined with a receipt target", (policy) => {
    const { errors } = validateDocumentV2(v2doc({ fit: { policy }, target: ['receipt'] }));
    expect(errors).toContain(`fit policy '${policy}' requires letter target`);
  });

  it("allows fit.policy 'one-page' with a letter target", () => {
    const { errors } = validateDocumentV2(v2doc({ fit: { policy: 'one-page' }, target: ['letter'] }));
    expect(errors).toEqual([]);
  });
});

describe('validateDocumentV2: page_break incompatible with fit.policy one-page (F4)', () => {
  it('rejects a top-level page_break with a dotted path and a clear message', () => {
    const raw = v2doc({
      fit: { policy: 'one-page' },
      blocks: [question(), { type: 'page_break' }, question({ itemId: 'q2', number: 2 })],
    });
    const { errors } = validateDocumentV2(raw);
    expect(errors).toContain("blocks[1]: page_break is incompatible with fit.policy 'one-page'");
  });

  it('rejects a page_break nested inside a question', () => {
    const raw = v2doc({
      fit: { policy: 'one-page' },
      blocks: [question({ blocks: [{ type: 'rich_text', md: 'Stem.' }, { type: 'page_break' }] })],
    });
    const { errors } = validateDocumentV2(raw);
    expect(errors).toContain("blocks[0].blocks[1]: page_break is incompatible with fit.policy 'one-page'");
  });

  it('page_break is fine under fit.policy flow (the default) and fill', () => {
    for (const policy of ['flow', 'fill']) {
      const raw = v2doc({ fit: { policy }, blocks: [question(), { type: 'page_break' }, question({ itemId: 'q2', number: 2 })] });
      const { errors } = validateDocumentV2(raw);
      expect(errors, `policy ${policy}`).toEqual([]);
    }
  });

  it('a page_break-free one-page document is unaffected', () => {
    const raw = v2doc({ fit: { policy: 'one-page' }, blocks: [question()] });
    const { errors } = validateDocumentV2(raw);
    expect(errors).toEqual([]);
  });
});

describe('BLOCK_TARGET_SUPPORT matrix', () => {
  it('marks every receipt-rendered block type letter+receipt, and every other registered block type letter-only', () => {
    expect(Object.isFrozen(BLOCK_TARGET_SUPPORT)).toBe(true);
    for (const t of ['rich_text', 'scan_action', 'media_action']) {
      expect(BLOCK_TARGET_SUPPORT[t]).toEqual(['letter', 'receipt']);
      expect(Object.isFrozen(BLOCK_TARGET_SUPPORT[t])).toBe(true);
    }
    for (const t of [
      'math', 'plot', 'geometry', 'asset', 'question', 'answer_space', 'omr_response',
      'passage', 'figure', 'inset', 'list', 'divider', 'spacer', 'page_break',
      'wordbank', 'matching', 'cloze', 'short_answer', 'essay',
    ]) {
      expect(BLOCK_TARGET_SUPPORT[t]).toEqual(['letter']);
      expect(Object.isFrozen(BLOCK_TARGET_SUPPORT[t])).toBe(true);
    }
  });
});

describe('validateDocumentV2: block x target compatibility', () => {
  it('rejects a letter-only block when target includes receipt, naming the block path and the missed target', () => {
    const raw = v2doc({
      target: ['letter', 'receipt'], archetype: 'infopage', blocks: [{ type: 'math', tex: 'x=1' }],
    });
    const { errors } = validateDocumentV2(raw);
    expect(errors).toContain("blocks[0]: block type 'math' does not support target 'receipt'");
  });

  it('accepts the same letter-only block on a letter-only document', () => {
    const raw = v2doc({
      target: ['letter'], archetype: 'infopage', blocks: [{ type: 'math', tex: 'x=1' }],
    });
    const { errors } = validateDocumentV2(raw);
    expect(errors).toEqual([]);
  });

  it('accepts a receipt-supported block type on both targets', () => {
    const raw = v2doc({
      target: ['letter', 'receipt'], archetype: 'infopage', blocks: [{ type: 'rich_text', md: 'hi' }],
    });
    const { errors } = validateDocumentV2(raw);
    expect(errors).toEqual([]);
  });

  it('walks nested blocks inside a question container, catching both the container and the child', () => {
    const raw = v2doc({
      target: ['letter', 'receipt'],
      blocks: [question({
        blocks: [{ type: 'rich_text', md: 'What is $x$?' }, { type: 'math', tex: 'x=1' }],
      })],
    });
    const { errors } = validateDocumentV2(raw);
    expect(errors).toContain("blocks[0]: block type 'question' does not support target 'receipt'");
    expect(errors).toContain("blocks[0].blocks[1]: block type 'math' does not support target 'receipt'");
  });
});

describe('validateDocumentV2: answers still banned', () => {
  it('rejects a node carrying an answer key, with the existing v1 message', () => {
    const raw = v2doc({ blocks: [question({ answer: 'A' })] });
    const { errors } = validateDocumentV2(raw);
    expect(errors.some((e) => e.includes('must not carry an answer key'))).toBe(true);
  });
});

const wordbank = (over = {}) => ({ type: 'wordbank', key: 'wb1', terms: ['a', 'b'], ...over });
const matchingBlock = (over = {}) => ({
  type: 'matching', key: 'm1', left: ['WA', 'OR'], right: ['Olympia', 'Salem'], ...over,
});
const clozeBlock = (over = {}) => ({
  type: 'cloze', text: 'The {{1}} is red.', blanks: [{ n: 1 }], ...over,
});

describe('validateDocumentV2: document-wide key uniqueness (Task 2, spec §4.3)', () => {
  it('accepts distinct keys across wordbank/matching/bank-select question', () => {
    const raw = v2doc({
      blocks: [
        wordbank({ key: 'wb1' }),
        matchingBlock({ key: 'm1' }),
        { type: 'question', bankId: 'b', select: 3, key: 'sel1' },
      ],
    });
    const { errors } = validateDocumentV2(raw);
    expect(errors).toEqual([]);
  });

  it('rejects two wordbank blocks sharing a key', () => {
    const raw = v2doc({ blocks: [wordbank({ key: 'wb1' }), wordbank({ key: 'wb1', terms: ['c', 'd'] })] });
    const { errors } = validateDocumentV2(raw);
    expect(errors.some((e) => e.includes('duplicate key "wb1"'))).toBe(true);
  });

  it('rejects a wordbank and a matching block sharing a key (cross-type collision)', () => {
    const raw = v2doc({ blocks: [wordbank({ key: 'shared' }), matchingBlock({ key: 'shared' })] });
    const { errors } = validateDocumentV2(raw);
    expect(errors.some((e) => e.includes('duplicate key "shared"'))).toBe(true);
  });

  it('rejects a matching block and a bank-select question sharing a key', () => {
    const raw = v2doc({
      blocks: [matchingBlock({ key: 'shared' }), { type: 'question', bankId: 'b', select: 3, key: 'shared' }],
    });
    const { errors } = validateDocumentV2(raw);
    expect(errors.some((e) => e.includes('duplicate key "shared"'))).toBe(true);
  });

  it('names both positions in the duplicate-key error', () => {
    const raw = v2doc({ blocks: [wordbank({ key: 'wb1' }), wordbank({ key: 'wb1', terms: ['c', 'd'] })] });
    const { errors } = validateDocumentV2(raw);
    const msg = errors.find((e) => e.includes('duplicate key "wb1"'));
    expect(msg).toBe('blocks[1]: duplicate key "wb1" (already used at blocks[0])');
  });

  it('does not double-report a key that already failed its own shape check (blocks.mjs)', () => {
    const raw = v2doc({ blocks: [wordbank({ key: '' }), wordbank({ key: '', terms: ['c', 'd'] })] });
    const { errors } = validateDocumentV2(raw);
    expect(errors.some((e) => e.includes('duplicate key'))).toBe(false);
  });
});

describe('validateDocumentV2: cloze -> wordbank ref resolution (Task 2, spec §6.3)', () => {
  it('accepts a cloze blank referencing an existing wordbank key', () => {
    const raw = v2doc({ blocks: [wordbank({ key: 'wb1' }), clozeBlock({ blanks: [{ n: 1, wordbank: 'wb1' }] })] });
    const { errors } = validateDocumentV2(raw);
    expect(errors).toEqual([]);
  });

  it('rejects a cloze blank referencing a wordbank key that does not exist (dangling ref)', () => {
    const raw = v2doc({ blocks: [clozeBlock({ blanks: [{ n: 1, wordbank: 'missing' }] })] });
    const { errors } = validateDocumentV2(raw);
    expect(errors).toContain('blocks[0].blanks[0]: wordbank "missing" does not match any wordbank block\'s key');
  });
});

describe('validateDocumentV2: allowAnswers threading (Task 2 infrastructure — Task 3 is the first real caller)', () => {
  it('defaults to allowAnswers: false — SOURCE-only fields are rejected exactly as before this option existed', () => {
    const raw = v2doc({
      blocks: [matchingBlock({ pairs: [{ left: 'WA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }] })],
    });
    const { errors } = validateDocumentV2(raw);
    expect(errors.some((e) => e.includes('matching pairs is a source-only field'))).toBe(true);
  });

  it('allowAnswers: true permits matching pairs, a cloze blank answer, and short_answer answer together', () => {
    const raw = v2doc({
      blocks: [
        matchingBlock({ pairs: [{ left: 'WA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }] }),
        clozeBlock({ blanks: [{ n: 1, answer: 'mitochondria' }] }),
        { type: 'short_answer', prompt: 'Capital of WA?', answer: 'Olympia' },
      ],
    });
    const { errors } = validateDocumentV2(raw, { allowAnswers: true });
    expect(errors).toEqual([]);
  });

  it('a source document still enforces every other v1/v2 rule (id/seed/target/etc.)', () => {
    const raw = v2doc({ id: undefined, blocks: [clozeBlock({ blanks: [{ n: 1, answer: 'x' }] })] });
    const { errors } = validateDocumentV2(raw, { allowAnswers: true });
    expect(errors.some((e) => e.includes('id must match'))).toBe(true);
  });
});

describe('validateDocumentV2: answer-ban interplay when allowAnswers is false (default)', () => {
  it('a cloze blank answer is caught by BOTH mechanisms — the block validator\'s source-only gate AND the generic collectAnswerKeys walk (defense in depth for a literal "answer" key)', () => {
    const raw = v2doc({ blocks: [clozeBlock({ blanks: [{ n: 1, answer: 'mitochondria' }] })] });
    const { errors } = validateDocumentV2(raw);
    expect(errors).toContain('blocks[0]: cloze blanks[0].answer is a source-only field and must not appear in a published document');
    expect(errors.some((e) => e.includes('must not carry an answer key'))).toBe(true);
  });

  it('matching pairs (not a literal "answer"/"answers" key) is caught ONLY by the block validator, not the generic answer-key walk', () => {
    const raw = v2doc({
      blocks: [matchingBlock({ pairs: [{ left: 'WA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }] })],
    });
    const { errors } = validateDocumentV2(raw);
    expect(errors.some((e) => e.includes('source-only field'))).toBe(true);
    expect(errors.some((e) => e.includes('must not carry an answer key'))).toBe(false);
  });
});
