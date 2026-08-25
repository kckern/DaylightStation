import { describe, it, expect } from 'vitest';
import { validateDocument, walkBlocks } from '#domains/school/documents/documentValidation.mjs';

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
    expect(errs(doc({ id }))).toContain('id must be 1-4 kebab-case segments separated by "/" (e.g. arts/creature-identification/quiz-1)');
  });
});

describe('validateDocument: seed and variant', () => {
  it('accepts a zero seed', () => {
    expect(errs(doc({ seed: 0 }))).toEqual([]);
  });

  it('accepts the largest exactly-representable seed', () => {
    expect(errs(doc({ seed: Number.MAX_SAFE_INTEGER }))).toEqual([]);
  });

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['a numeric string', '12345'],
    ['missing', undefined],
    // Beyond MAX_SAFE_INTEGER, distinct seeds collide onto the same float, so
    // "same seed, byte-identical output" stops being a property the seed has.
    ['past the safe-integer ceiling', Number.MAX_SAFE_INTEGER + 2],
    ['enormous', 1e300],
    ['Infinity', Infinity],
    ['NaN', NaN],
  ])('rejects a seed that is %s', (_label, seed) => {
    expect(errs(doc({ seed }))).toContain(`seed must be an integer between 0 and ${Number.MAX_SAFE_INTEGER}`);
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
    ['past the safe-integer ceiling', Number.MAX_SAFE_INTEGER + 2],
  ])('rejects a variant that is %s', (_label, variant) => {
    expect(errs(doc({ variant }))).toContain(`variant must be an integer between 0 and ${Number.MAX_SAFE_INTEGER}`);
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

  // One notation for every error in the list: a dotted path, one colon.
  it('joins nested block paths with dots rather than repeating the prefix', () => {
    const q = question({ blocks: [{ type: 'rich_text', md: 'ok' }, { type: 'math', tex: '' }] });
    expect(errs(doc({ blocks: [q] })))
      .toContain('blocks[0].blocks[1]: math tex must be a non-empty string');
  });

  it('uses the same dotted notation for structural and tree-walk rules', () => {
    const q = question({ blocks: [{ type: 'question', itemId: 'q2', number: 2, blocks: [{ type: 'rich_text', md: 'x' }] }] });
    expect(errs(doc({ blocks: [q] })))
      .toContain('blocks[0].blocks[0]: question may not contain another question');
  });
});

describe('validateDocument: question itemId uniqueness', () => {
  it('accepts distinct itemIds', () => {
    expect(errs(doc({ blocks: [question(), question({ itemId: 'q2', number: 2 })] }))).toEqual([]);
  });

  it('rejects a duplicate itemId at the top level, naming both positions', () => {
    expect(errs(doc({ blocks: [question(), question({ number: 2 })] })))
      .toContain('blocks[1]: duplicate question itemId "q1" (already used at blocks[0])');
  });
});

describe('validateDocument: structural ceilings', () => {
  // The cycle guard is path-scoped so legitimate anchor reuse still validates,
  // which leaves an aliased DAG re-walked once per path into it. These ceilings
  // are what stop a few dozen lines of YAML from becoming millions of visits.
  it('accepts a document at a depth real worksheets reach', () => {
    let inner = { type: 'question', itemId: 'leaf', number: 1, blocks: [{ type: 'rich_text', md: 'x' }] };
    for (let i = 0; i < 5; i++) {
      inner = { type: 'question', itemId: `q${i}`, number: i + 1, blocks: [inner] };
    }
    // Nested questions are themselves rejected, but the walk must complete
    // rather than bail on a ceiling.
    expect(errs(doc({ blocks: [inner] })))
      .not.toContain('blocks: structure too large or too deeply nested to validate (limits: depth 64, 50000 blocks)');
  });

  it('reports a ceiling instead of hanging on an alias-built structure', () => {
    // Each level holds the previous one twice: 2^n paths from n levels of YAML.
    let node = { type: 'question', itemId: 'leaf', number: 1, blocks: [{ type: 'rich_text', md: 'x' }] };
    for (let i = 0; i < 30; i++) {
      node = { type: 'question', itemId: `q${i}`, number: 1, blocks: [node, node] };
    }
    const start = Date.now();
    const errors = errs(doc({ blocks: [node] }));
    expect(Date.now() - start).toBeLessThan(2000);
    expect(errors).toContain('blocks: structure too large or too deeply nested to validate (limits: depth 64, 50000 blocks)');
  });

  it('reports a ceiling on excessive nesting depth', () => {
    let node = { type: 'rich_text', md: 'x' };
    for (let i = 0; i < 70; i++) {
      node = { type: 'question', itemId: `q${i}`, number: 1, blocks: [node] };
    }
    expect(errs(doc({ blocks: [node] })))
      .toContain('blocks: structure too large or too deeply nested to validate (limits: depth 64, 50000 blocks)');
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

  // The bubble row and the question must grade the same bank item; a mismatched
  // pair marks up one item's sheet and scores another's. Multi-part questions
  // are modelled as separate question blocks, so equality is the whole rule.
  it('rejects an omr_response whose itemId differs from its question, naming both', () => {
    const mismatched = question({ blocks: [
      { type: 'rich_text', md: 'Pick one.' },
      { type: 'omr_response', itemId: 'TOTALLY-OTHER', choices: 4 },
    ] });
    expect(errs(doc({ blocks: [mismatched] })))
      .toContain('blocks[0].blocks[1]: omr_response itemId "TOTALLY-OTHER" must match its question itemId "q1"');
  });
});

describe('validateDocument: answer keys are structurally impossible', () => {
  const noKey = 'must not carry an answer key (answer keys render from the question bank)';

  it('rejects an answer key on the document itself', () => {
    expect(errs(doc({ answer: 'Olympia' }))).toContain(`document: ${noKey}`);
  });

  it('rejects an answers key on a block', () => {
    expect(errs(doc({ blocks: [{ type: 'rich_text', md: 'x', answers: ['a'] }] })))
      .toEqual([`blocks[0]: ${noKey}`]);
  });

  it('rejects an answer key nested deep inside a question block', () => {
    const sneaky = question({ blocks: [{ type: 'omr_response', itemId: 'q1', choices: 4, answer: 'B' }] });
    expect(errs(doc({ blocks: [sneaky] }))).toEqual([`blocks[0].blocks[0]: ${noKey}`]);
  });

  it('rejects an answer key hidden in a nested spec object', () => {
    const block = { type: 'plot', spec: { kind: 'cartesian', hint: { answer: 42 } } };
    expect(errs(doc({ blocks: [block] }))).toEqual([`blocks[0].spec.hint: ${noKey}`]);
  });

  it('does not confuse a legitimate answer_space block for an answer key', () => {
    expect(errs(doc({ blocks: [{ type: 'answer_space', minPt: 40, maxPt: 120 }] }))).toEqual([]);
  });
});

describe('validateDocument: cyclic trees', () => {
  it('reports a self-referencing question instead of overflowing the stack', () => {
    const q = question();
    q.blocks.push(q);
    expect(() => validateDocument(doc({ blocks: [q] }))).not.toThrow();
    expect(errs(doc({ blocks: [q] })).length).toBeGreaterThan(0);
  });

  it('reports a two-question cycle instead of overflowing the stack', () => {
    const a = question({ itemId: 'a' });
    const b = question({ itemId: 'b', number: 2 });
    a.blocks.push(b);
    b.blocks.push(a);
    expect(() => validateDocument(doc({ blocks: [a] }))).not.toThrow();
  });
});

describe('walkBlocks', () => {
  it('visits every block with its dotted path and enclosing question', () => {
    const inner = { type: 'omr_response', itemId: 'q1', choices: 4 };
    const q = question({ blocks: [inner] });
    const seen = [];
    walkBlocks([q], (block, at, enclosing) => seen.push([block.type, at, enclosing?.itemId ?? null]));
    expect(seen).toEqual([
      ['question', 'blocks[0]', null],
      ['omr_response', 'blocks[0].blocks[0]', 'q1'],
    ]);
  });

  it('passes the enclosing question object itself, not a flag', () => {
    const q = question({ blocks: [{ type: 'rich_text', md: 'x' }] });
    const enclosing = [];
    walkBlocks([q], (_block, _at, encl) => enclosing.push(encl));
    expect(enclosing[1]).toBe(q);
  });

  it('skips non-object entries rather than crashing', () => {
    const seen = [];
    expect(() => walkBlocks([null, 'nope', { type: 'rich_text', md: 'x' }], (b) => seen.push(b.type))).not.toThrow();
    expect(seen).toEqual(['rich_text']);
  });

  it('ignores a non-array blocks value', () => {
    const seen = [];
    walkBlocks(undefined, (b) => seen.push(b));
    expect(seen).toEqual([]);
  });

  it('terminates on a cyclic tree', () => {
    const q = question();
    q.blocks.push(q);
    expect(() => walkBlocks([q], () => {})).not.toThrow();
  });
});

describe('validateDocument: return value', () => {
  it('returns no document when invalid', () => {
    expect(validateDocument(doc({ seed: -1 })).document).toBeUndefined();
  });

  // The header of every printed sheet is `document.title || document.id`. A
  // normalisation that drops the title heads a child's worksheet with a slug.
  it('carries the title through to the normalised document', () => {
    const r = validateDocument(doc({ title: 'Adding and Subtracting Unlike Denominators' }));
    expect(r.errors).toEqual([]);
    expect(r.document.title).toBe('Adding and Subtracting Unlike Denominators');
  });

  it('omits title entirely when the source has none, rather than inventing one', () => {
    const r = validateDocument(doc());
    expect(Object.prototype.hasOwnProperty.call(r.document, 'title')).toBe(false);
  });

  it('rejects a title that is not a non-empty string', () => {
    expect(errs(doc({ title: 42 }))).toContain('title must be a non-empty string when present');
    expect(errs(doc({ title: '   ' }))).toContain('title must be a non-empty string when present');
  });

  it('accumulates every failure rather than stopping at the first', () => {
    const r = validateDocument({ id: 'BAD', seed: -1, target: ['fax'], blocks: [{ type: 'html' }] });
    expect(r.errors).toEqual([
      'id must be 1-4 kebab-case segments separated by "/" (e.g. arts/creature-identification/quiz-1)',
      `seed must be an integer between 0 and ${Number.MAX_SAFE_INTEGER}`,
      'unknown target: fax',
      'blocks[0]: unknown block type: html',
    ]);
  });
});
