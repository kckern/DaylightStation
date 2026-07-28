import { describe, it, expect } from 'vitest';
import { validateDocument } from '#domains/school/documents/documentValidation.mjs';

const question = (over = {}) => ({
  type: 'question',
  itemId: 'q1',
  number: 1,
  blocks: [{ type: 'rich_text', md: 'What is $x$?' }, { type: 'answer_space', minPt: 40, maxPt: 120 }],
  ...over,
});

const doc = (over = {}) => ({
  id: 'algebra-1-set-a',
  seed: 12345,
  target: ['letter'],
  blocks: [question()],
  ...over,
});

const errs = (raw) => validateDocument(raw).errors;

describe('validateDocument: shape', () => {
  it('accepts a minimal valid document', () => {
    expect(errs(doc())).toEqual([]);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'doc'],
  ])('rejects a document that is %s', (_label, raw) => {
    expect(errs(raw)).toContain('document must be a mapping');
  });
});

describe('validateDocument: id', () => {
  it.each(['a', 'algebra-1', 'unit3-set-a', '2026-review'])('accepts the slug %s', (id) => {
    expect(errs(doc({ id }))).toEqual([]);
  });

  it.each([
    ['uppercase', 'Algebra-1'],
    ['leading hyphen', '-algebra'],
    ['underscore', 'algebra_1'],
    ['a space', 'algebra 1'],
    ['empty', ''],
    ['missing', undefined],
    ['not a string', 42],
  ])('rejects an id that is %s', (_label, id) => {
    expect(errs(doc({ id }))).toContain('id must match ^[a-z0-9][a-z0-9-]*$');
  });
});

describe('validateDocument: seed and variant', () => {
  it('accepts a zero seed', () => {
    expect(errs(doc({ seed: 0 }))).toEqual([]);
  });

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['a numeric string', '12345'],
    ['missing', undefined],
  ])('rejects a seed that is %s', (_label, seed) => {
    expect(errs(doc({ seed }))).toContain('seed must be an integer >= 0');
  });

  it('accepts an omitted variant (defaults to 0)', () => {
    expect(errs(doc())).toEqual([]);
    expect(validateDocument(doc()).document.variant).toBe(0);
  });

  it('treats a null variant (YAML `variant:` with no value) the same as absent', () => {
    const r = validateDocument(doc({ variant: null }));
    expect(r.errors).toEqual([]);
    expect(r.document.variant).toBe(0);
  });

  it('keeps an explicit variant', () => {
    expect(validateDocument(doc({ variant: 2 })).document.variant).toBe(2);
  });

  it.each([
    ['negative', -1],
    ['fractional', 0.5],
    ['a numeric string', '1'],
  ])('rejects a variant that is %s', (_label, variant) => {
    expect(errs(doc({ variant }))).toContain('variant must be an integer >= 0');
  });
});

describe('validateDocument: target', () => {
  it.each([
    [['letter']],
    [['receipt']],
    [['letter', 'receipt']],
  ])('accepts target %s', (target) => {
    expect(errs(doc({ target }))).toEqual([]);
  });

  it('rejects an empty target list', () => {
    expect(errs(doc({ target: [] }))).toContain('target must be a non-empty array');
  });

  it('rejects a missing or non-array target', () => {
    expect(errs(doc({ target: undefined }))).toContain('target must be a non-empty array');
    expect(errs(doc({ target: 'letter' }))).toContain('target must be a non-empty array');
  });

  it('rejects an unknown target, naming it', () => {
    expect(errs(doc({ target: ['letter', 'fax'] }))).toContain('unknown target: fax');
  });
});

describe('validateDocument: blocks', () => {
  it('rejects an empty or missing blocks array', () => {
    expect(errs(doc({ blocks: [] }))).toContain('blocks must be a non-empty array');
    expect(errs(doc({ blocks: undefined }))).toContain('blocks must be a non-empty array');
  });

  it('delegates per-block validation, prefixing the index', () => {
    expect(errs(doc({ blocks: [{ type: 'math', tex: '' }] })))
      .toContain('blocks[0]: math tex must be a non-empty string');
  });

  it('prefixes at the failing index, not the first', () => {
    expect(errs(doc({ blocks: [{ type: 'rich_text', md: 'ok' }, { type: 'html' }] })))
      .toContain('blocks[1]: unknown block type: html');
  });
});

describe('validateDocument: question itemId uniqueness', () => {
  it('accepts distinct itemIds', () => {
    expect(errs(doc({ blocks: [question(), question({ itemId: 'q2', number: 2 })] }))).toEqual([]);
  });

  it('rejects a duplicate itemId at the top level', () => {
    expect(errs(doc({ blocks: [question(), question({ number: 2 })] })))
      .toContain('duplicate question itemId: q1');
  });
});

describe('validateDocument: omr_response placement', () => {
  it('accepts an omr_response inside a question', () => {
    const withOmr = question({ blocks: [
      { type: 'rich_text', md: 'Pick one.' },
      { type: 'omr_response', itemId: 'q1', choices: 4 },
    ] });
    expect(errs(doc({ blocks: [withOmr] }))).toEqual([]);
  });

  it('rejects a top-level omr_response (it grades nothing on its own)', () => {
    expect(errs(doc({ blocks: [{ type: 'omr_response', itemId: 'q1', choices: 4 }] })))
      .toContain('blocks[0]: omr_response must be inside a question block');
  });
});

describe('validateDocument: answer keys are structurally impossible', () => {
  it('rejects an answer key on the document itself', () => {
    expect(errs(doc({ answer: 'Olympia' })))
      .toContain('document must not carry an answer key (answer keys render from the question bank)');
  });

  it('rejects an answers key on a block', () => {
    expect(errs(doc({ blocks: [{ type: 'rich_text', md: 'x', answers: ['a'] }] })).length).toBeGreaterThan(0);
    expect(errs(doc({ blocks: [{ type: 'rich_text', md: 'x', answers: ['a'] }] }))[0])
      .toMatch(/answer key/);
  });

  it('rejects an answer key nested deep inside a question block', () => {
    const sneaky = question({ blocks: [{ type: 'omr_response', itemId: 'q1', choices: 4, answer: 'B' }] });
    expect(errs(doc({ blocks: [sneaky] })).some((e) => /answer key/.test(e))).toBe(true);
  });

  it('rejects an answer key hidden in a nested spec object', () => {
    const block = { type: 'plot', spec: { kind: 'cartesian', hint: { answer: 42 } } };
    expect(errs(doc({ blocks: [block] })).some((e) => /answer key/.test(e))).toBe(true);
  });

  it('does not confuse a legitimate answer_space block for an answer key', () => {
    expect(errs(doc({ blocks: [{ type: 'answer_space', minPt: 40, maxPt: 120 }] }))).toEqual([]);
  });
});

describe('validateDocument: return value', () => {
  it('returns no document when invalid', () => {
    expect(validateDocument(doc({ seed: -1 })).document).toBeUndefined();
  });

  it('accumulates every failure rather than stopping at the first', () => {
    const r = validateDocument({ id: 'BAD', seed: -1, target: ['fax'], blocks: [{ type: 'html' }] });
    expect(r.errors.length).toBeGreaterThanOrEqual(4);
  });
});
