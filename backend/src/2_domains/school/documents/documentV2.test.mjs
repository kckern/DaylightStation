/**
 * Envelope v2 validation + dispatch (spec §4). See documentV2.mjs for the
 * design notes on the source-desugar error-path approach.
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from './documentValidation.mjs';
import {
  DOCUMENT_V2_SCHEMA, ARCHETYPES, FIT_POLICIES,
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

describe('validateDocumentV2: answers still banned', () => {
  it('rejects a node carrying an answer key, with the existing v1 message', () => {
    const raw = v2doc({ blocks: [question({ answer: 'A' })] });
    const { errors } = validateDocumentV2(raw);
    expect(errors.some((e) => e.includes('must not carry an answer key'))).toBe(true);
  });
});
