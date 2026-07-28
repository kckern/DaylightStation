import { describe, it, expect } from 'vitest';
import { BLOCK_TYPES, validateBlock } from '#domains/school/documents/blocks.mjs';

const errs = (raw) => validateBlock(raw).errors;

describe('BLOCK_TYPES', () => {
  it('is the closed spec §3.3 set, in document order', () => {
    expect(BLOCK_TYPES).toEqual([
      'rich_text', 'math', 'plot', 'geometry', 'asset',
      'question', 'answer_space', 'omr_response',
      'media_action', 'scan_action',
    ]);
  });

  it('is frozen — a new block type is a code change, never config', () => {
    expect(Object.isFrozen(BLOCK_TYPES)).toBe(true);
  });

  it('lists exactly the types that have a validator (no declared-but-unhandled type)', () => {
    BLOCK_TYPES.forEach((type) => {
      expect(validateBlock({ type })).not.toEqual({ errors: [`unknown block type: ${type}`] });
    });
  });
});

describe('validateBlock: shape', () => {
  it('rejects unknown block types by name', () => {
    expect(errs({ type: 'html' })).toContain('unknown block type: html');
  });

  it('rejects an absent type without crashing', () => {
    expect(errs({ md: 'hello' })).toContain('unknown block type: undefined');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', []],
    ['a string', 'rich_text'],
  ])('rejects a block that is %s', (_label, raw) => {
    expect(errs(raw)).toEqual(['block must be a mapping']);
  });

  // The type lookup must be an own-property check: a bracket lookup finds
  // Object.prototype members, so `constructor`/`toString` would resolve to a
  // function and "validate" clean, and `__proto__` would resolve to an object
  // and crash.
  it.each(['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf'])(
    'rejects the inherited Object.prototype member %s as a type',
    (type) => {
      expect(errs({ type })).toEqual([`unknown block type: ${type}`]);
    },
  );
});

describe('validateBlock: rich_text', () => {
  it('accepts a non-empty md string', () => {
    expect(errs({ type: 'rich_text', md: 'Solve for $x$.' })).toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['not a string', { fake: 1 }],
    ['missing', undefined],
  ])('rejects md that is %s', (_label, md) => {
    expect(errs({ type: 'rich_text', md })).toContain('rich_text md must be a non-empty string');
  });

  // rich_text carries inline math to the same renderer as a math block, so the
  // browser-only \require macro is reachable through this field too.
  it('rejects \\require in inline math', () => {
    expect(errs({ type: 'rich_text', md: 'Simplify $\\require{enclose} x$' }))
      .toContain('rich_text md must not use \\require{} (server rendering loads all packages)');
  });

  it('rejects \\require written with a space before the brace', () => {
    expect(errs({ type: 'rich_text', md: '$\\require {enclose} x$' }))
      .toContain('rich_text md must not use \\require{} (server rendering loads all packages)');
  });
});

describe('validateBlock: math', () => {
  it('accepts non-empty tex with an optional display flag', () => {
    expect(errs({ type: 'math', tex: '\\frac{1}{2}', display: true })).toEqual([]);
    expect(errs({ type: 'math', tex: 'x^2' })).toEqual([]);
  });

  it('rejects empty tex', () => {
    expect(errs({ type: 'math', tex: '' }).length).toBeGreaterThan(0);
  });

  it('rejects \\require in tex (browser-only macro, spike finding)', () => {
    expect(errs({ type: 'math', tex: '\\require{enclose} x' }))
      .toContain('math tex must not use \\require{} (server rendering loads all packages)');
  });

  it('rejects a non-boolean display', () => {
    expect(errs({ type: 'math', tex: 'x', display: 'yes' })).toContain('math display must be a boolean');
  });

  it('rejects \\require written with a space before the brace', () => {
    expect(errs({ type: 'math', tex: '\\require {enclose} x' }))
      .toContain('math tex must not use \\require{} (server rendering loads all packages)');
  });
});

describe('validateBlock: plot and geometry', () => {
  it.each(['plot', 'geometry'])('%s accepts a spec object with a non-empty kind', (type) => {
    expect(errs({ type, spec: { kind: 'cartesian', fn: 'x^2' } })).toEqual([]);
  });

  it.each(['plot', 'geometry'])('%s rejects a missing spec', (type) => {
    expect(errs({ type })).toContain(`${type} spec must be an object`);
  });

  it.each(['plot', 'geometry'])('%s rejects an array spec', (type) => {
    expect(errs({ type, spec: [] })).toContain(`${type} spec must be an object`);
  });

  it.each(['plot', 'geometry'])('%s rejects a spec without a kind', (type) => {
    expect(errs({ type, spec: { fn: 'x^2' } })).toContain(`${type} spec.kind must be a non-empty string`);
  });
});

describe('validateBlock: asset', () => {
  it('accepts a ref with alt text', () => {
    expect(errs({ type: 'asset', ref: 'maps/rome.svg', alt: 'Map of Rome' })).toEqual([]);
  });

  it('rejects a missing ref', () => {
    expect(errs({ type: 'asset', alt: 'Map of Rome' })).toContain('asset ref must be a non-empty string');
  });

  it('requires alt text (accessibility + print caption)', () => {
    expect(errs({ type: 'asset', ref: 'maps/rome.svg' })).toContain('asset alt must be a non-empty string');
    expect(errs({ type: 'asset', ref: 'maps/rome.svg', alt: '  ' })).toContain('asset alt must be a non-empty string');
  });
});

describe('validateBlock: question', () => {
  const question = (over = {}) => ({
    type: 'question',
    itemId: 'q1',
    number: 1,
    blocks: [
      { type: 'rich_text', md: 'What is $x$?' },
      { type: 'answer_space', minPt: 40, maxPt: 120 },
    ],
    ...over,
  });

  it('accepts a bank item ref plus nested blocks', () => {
    expect(errs(question())).toEqual([]);
  });

  it('rejects a missing itemId', () => {
    expect(errs(question({ itemId: undefined }))).toContain('question itemId must be a non-empty string');
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['a numeric string', '1'],
    ['missing', undefined],
  ])('rejects a number that is %s', (_label, number) => {
    expect(errs(question({ number }))).toContain('question number must be an integer >= 1');
  });

  it('rejects an empty or missing blocks array', () => {
    expect(errs(question({ blocks: [] }))).toContain('question blocks must be a non-empty array');
    expect(errs(question({ blocks: undefined }))).toContain('question blocks must be a non-empty array');
  });

  it('validates nested blocks recursively, prefixing the index', () => {
    expect(errs(question({ blocks: [{ type: 'rich_text', md: '' }] })))
      .toContain('blocks[0]: rich_text md must be a non-empty string');
  });

  it('prefixes nested errors at the failing index, not the first', () => {
    expect(errs(question({ blocks: [{ type: 'rich_text', md: 'ok' }, { type: 'math', tex: '' }] })))
      .toContain('blocks[1]: math tex must be a non-empty string');
  });

  it('may not nest another question', () => {
    expect(errs(question({ blocks: [question()] })))
      .toContain('blocks[0]: question may not contain another question');
  });
});

describe('validateBlock: cyclic trees', () => {
  it('reports a self-referencing question instead of overflowing the stack', () => {
    const q = { type: 'question', itemId: 'q1', number: 1, blocks: [] };
    q.blocks.push(q);
    expect(() => validateBlock(q)).not.toThrow();
    expect(errs(q).length).toBeGreaterThan(0);
  });

  it('reports a question reachable from itself through a sibling array', () => {
    const q = { type: 'question', itemId: 'q1', number: 1, blocks: [] };
    q.blocks.push({ type: 'rich_text', md: 'x', extra: q });
    expect(() => validateBlock(q)).not.toThrow();
  });
});

describe('validateBlock: answer_space', () => {
  it('accepts a positive min/max pair', () => {
    expect(errs({ type: 'answer_space', minPt: 40, maxPt: 120 })).toEqual([]);
  });

  it('accepts equal bounds (a fixed-height work area)', () => {
    expect(errs({ type: 'answer_space', minPt: 40, maxPt: 40 })).toEqual([]);
  });

  it('rejects min greater than max', () => {
    expect(errs({ type: 'answer_space', minPt: 40, maxPt: 20 }))
      .toContain('answer_space minPt must be <= maxPt');
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['not a number', '40'],
    ['missing', undefined],
  ])('rejects a minPt that is %s', (_label, minPt) => {
    expect(errs({ type: 'answer_space', minPt, maxPt: 120 })).toContain('answer_space minPt must be a number > 0');
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['not a number', '120'],
    ['missing', undefined],
  ])('rejects a maxPt that is %s', (_label, maxPt) => {
    expect(errs({ type: 'answer_space', minPt: 40, maxPt })).toContain('answer_space maxPt must be a number > 0');
  });
});

describe('validateBlock: omr_response', () => {
  it('accepts an itemId with a choice count in 2..8', () => {
    expect(errs({ type: 'omr_response', itemId: 'q1', choices: 4 })).toEqual([]);
    expect(errs({ type: 'omr_response', itemId: 'q1', choices: 2 })).toEqual([]);
    expect(errs({ type: 'omr_response', itemId: 'q1', choices: 8 })).toEqual([]);
  });

  it('rejects a missing itemId', () => {
    expect(errs({ type: 'omr_response', choices: 4 })).toContain('omr_response itemId must be a non-empty string');
  });

  it.each([
    ['below the floor', 1],
    ['above the ceiling', 9],
    ['fractional', 4.5],
    ['not a number', '4'],
    ['missing', undefined],
  ])('rejects a choices count %s', (_label, choices) => {
    expect(errs({ type: 'omr_response', itemId: 'q1', choices }))
      .toContain('omr_response choices must be an integer between 2 and 8');
  });
});

describe('validateBlock: media_action and scan_action', () => {
  it.each(['media_action', 'scan_action'])('%s accepts an action with a printed label', (type) => {
    expect(errs({ type, action: 'play:plex:619845', label: 'Watch the lesson' })).toEqual([]);
  });

  it.each(['media_action', 'scan_action'])('%s rejects a missing action', (type) => {
    expect(errs({ type, label: 'Watch the lesson' })).toContain(`${type} action must be a non-empty string`);
  });

  it.each(['media_action', 'scan_action'])('%s rejects a missing label (the printed instruction)', (type) => {
    expect(errs({ type, action: 'play:plex:619845' })).toContain(`${type} label must be a non-empty string`);
  });
});
