import { describe, it, expect } from 'vitest';
import { BLOCK_TYPES, validateBlock } from '#domains/school/documents/blocks.mjs';

const errs = (raw, opts) => validateBlock(raw, opts).errors;
// SOURCE-stage validation (spec §3): allowAnswers: true permits the
// SOURCE-only fields (matching.pairs, a cloze blank's answer, short_answer's
// answer) that PUBLISHED validation (the `errs` default above) must reject.
const srcErrs = (raw) => validateBlock(raw, { allowAnswers: true }).errors;

describe('BLOCK_TYPES', () => {
  it('is the closed spec §3.3 set, in document order', () => {
    expect(BLOCK_TYPES).toEqual([
      'rich_text', 'math', 'plot', 'geometry', 'asset',
      'question', 'answer_space', 'omr_response',
      'media_action', 'scan_action', 'result_summary',
      'passage', 'figure', 'inset', 'list',
      'wordbank', 'matching', 'cloze', 'short_answer', 'essay',
      'divider', 'spacer', 'page_break',
    ]);
  });

  it('is frozen — a new block type is a code change, never config', () => {
    expect(Object.isFrozen(BLOCK_TYPES)).toBe(true);
  });

  // Tautological since BLOCK_TYPES is derived from the validator map — kept as
  // executable documentation of the invariant, not as a regression guard. It
  // would only regain teeth if the list were ever hand-maintained again.
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

  // Documentation, not a regression guard: validateBlock never traverses
  // arbitrary properties, so a cycle hidden in one is unreachable by
  // construction and no implementation change could make this throw. The real
  // guard against that shape is the deep answer-key walk in documentValidation.
  it('ignores a cycle hidden in a non-block property', () => {
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

describe('validateBlock: passage', () => {
  it('accepts bare text with no source', () => {
    expect(errs({ type: 'passage', text: 'It was the best of times.' })).toEqual([]);
  });

  it('accepts text with a full source and explicit mode/lineNumbers', () => {
    expect(errs({
      type: 'passage',
      text: 'It was the best of times.',
      source: { title: 'A Tale of Two Cities', author: 'Dickens', locator: 'ch. 1' },
      mode: 'cite',
      lineNumbers: true,
    })).toEqual([]);
  });

  it('defaults mode to reprint (does not require it)', () => {
    expect(errs({ type: 'passage', text: 'Text.' })).toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['not a string', { fake: 1 }],
    ['missing', undefined],
  ])('rejects text that is %s', (_label, text) => {
    expect(errs({ type: 'passage', text })).toContain('passage text must be a non-empty string');
  });

  it('rejects \\require in text (reaches the math-capable rich-text path)', () => {
    expect(errs({ type: 'passage', text: 'Simplify $\\require{enclose} x$' }))
      .toContain('passage text must not use \\require{} (server rendering loads all packages)');
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'A Tale of Two Cities'],
  ])('rejects a source that is %s', (_label, source) => {
    expect(errs({ type: 'passage', text: 'x', source })).toContain('passage source must be an object');
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['not a string', { fake: 1 }],
    ['missing', undefined],
  ])('rejects a source.title that is %s', (_label, title) => {
    expect(errs({ type: 'passage', text: 'x', source: { title } }))
      .toContain('passage source.title must be a non-empty string');
  });

  it('rejects a non-empty-string source.author when present', () => {
    expect(errs({ type: 'passage', text: 'x', source: { title: 'T', author: '  ' } }))
      .toContain('passage source.author must be a non-empty string when present');
  });

  it('rejects a non-empty-string source.locator when present', () => {
    expect(errs({ type: 'passage', text: 'x', source: { title: 'T', locator: '' } }))
      .toContain('passage source.locator must be a non-empty string when present');
  });

  it("rejects a mode outside 'reprint'|'cite'", () => {
    expect(errs({ type: 'passage', text: 'x', mode: 'quote' }))
      .toContain("passage mode must be 'reprint' or 'cite'");
  });

  it('rejects a non-boolean lineNumbers', () => {
    expect(errs({ type: 'passage', text: 'x', lineNumbers: 'yes' }))
      .toContain('passage lineNumbers must be a boolean');
  });
});

describe('validateBlock: figure', () => {
  it('accepts an asset id with a caption', () => {
    expect(errs({ type: 'figure', asset: 'maps/rome.svg', caption: 'Map of Rome' })).toEqual([]);
  });

  it('accepts an optional non-empty credit', () => {
    expect(errs({ type: 'figure', asset: 'maps/rome.svg', caption: 'Map of Rome', credit: 'NPS' })).toEqual([]);
  });

  it('rejects a missing asset', () => {
    expect(errs({ type: 'figure', caption: 'Map of Rome' })).toContain('figure asset must be a non-empty string');
  });

  it('rejects a missing caption', () => {
    expect(errs({ type: 'figure', asset: 'maps/rome.svg' })).toContain('figure caption must be a non-empty string');
  });

  it('rejects a blank credit when present', () => {
    expect(errs({ type: 'figure', asset: 'maps/rome.svg', caption: 'Map of Rome', credit: '  ' }))
      .toContain('figure credit must be a non-empty string when present');
  });
});

describe('validateBlock: inset', () => {
  const inset = (over = {}) => ({
    type: 'inset',
    title: 'Did You Know?',
    blocks: [{ type: 'rich_text', md: 'Extra context.' }],
    ...over,
  });

  it('accepts a titled inset with nested blocks', () => {
    expect(errs(inset())).toEqual([]);
  });

  it('accepts an inset with no title', () => {
    expect(errs(inset({ title: undefined }))).toEqual([]);
  });

  it('rejects a blank title when present', () => {
    expect(errs(inset({ title: '   ' }))).toContain('inset title must be a non-empty string when present');
  });

  it('rejects an empty or missing blocks array', () => {
    expect(errs(inset({ blocks: [] }))).toContain('inset blocks must be a non-empty array');
    expect(errs(inset({ blocks: undefined }))).toContain('inset blocks must be a non-empty array');
  });

  it('validates nested blocks recursively, prefixing the index', () => {
    expect(errs(inset({ blocks: [{ type: 'rich_text', md: '' }] })))
      .toContain('blocks[0]: rich_text md must be a non-empty string');
  });

  it('rejects a nested inset with the exact ban message', () => {
    expect(errs(inset({ blocks: [inset()] })))
      .toContain('blocks[0]: inset blocks must not nest insets');
  });

  // F5: inset children the box measure/draw path cannot actually handle
  // must fail at VALIDATE time, not crash measure ('question') or draw
  // ('page_break') — see INSET_UNSUPPORTED_CHILD_TYPES in blocks.mjs.
  describe('rejects child types the box path cannot render (F5)', () => {
    it('question — validated clean before, then threw UnsupportedBlockError at measure time', () => {
      const errors = errs(inset({
        blocks: [{
          type: 'question', itemId: 'q1', number: 1, blocks: [{ type: 'rich_text', md: 'Stem.' }],
        }],
      }));
      expect(errors).toContain('blocks[0]: inset blocks must not contain a question (a question is the exam atomic unit; insets are asides one level deep)');
    });

    it('page_break — validated clean before, then crashed the renderer\'s "Unreachable" draw branch', () => {
      const errors = errs(inset({ blocks: [{ type: 'page_break' }] }));
      expect(errors).toContain('blocks[0]: inset blocks must not contain a page_break (a box never spans a page boundary on its own)');
    });

    it('plot — no Letter renderer exists yet, inset or not', () => {
      const errors = errs(inset({ blocks: [{ type: 'plot', spec: { kind: 'line' } }] }));
      expect(errors).toContain('blocks[0]: inset blocks must not contain a plot (no Letter renderer exists for plot yet)');
    });

    it('geometry — no Letter renderer exists yet, inset or not', () => {
      const errors = errs(inset({ blocks: [{ type: 'geometry', spec: { kind: 'triangle' } }] }));
      expect(errors).toContain('blocks[0]: inset blocks must not contain a geometry (no Letter renderer exists for geometry yet)');
    });

    // Task 2: keyed/shuffled exam furniture is deferred out of insets (v1) —
    // see the audit note above INSET_UNSUPPORTED_CHILD_TYPES in blocks.mjs.
    it('wordbank — keyed exam furniture, deferred to a v2 of the box path', () => {
      const errors = errs(inset({ blocks: [{ type: 'wordbank', key: 'wb1', terms: ['a', 'b'] }] }));
      expect(errors).toContain('blocks[0]: inset blocks must not contain a wordbank (a seeded-shuffle boxed term set is keyed exam furniture; nesting a box inside a box is deferred to a v2 of the box path)');
    });

    it('matching — same v1 disposition as wordbank', () => {
      const errors = errs(inset({
        blocks: [{
          type: 'matching', key: 'm1', left: ['A'], right: ['1'],
        }],
      }));
      expect(errors).toContain('blocks[0]: inset blocks must not contain a matching (a seeded-shuffle write-the-letter grid is keyed exam furniture — same v1 disposition as wordbank)');
    });

    it('cloze — same v1 disposition as wordbank/matching', () => {
      const errors = errs(inset({
        blocks: [{
          type: 'cloze', text: 'The {{1}} is red.', blanks: [{ n: 1 }],
        }],
      }));
      expect(errors).toContain('blocks[0]: inset blocks must not contain a cloze (fixed-width numbered blanks are keyed exam furniture — same v1 disposition as wordbank/matching)');
    });

    // short_answer/essay ARE allowed nested (unlike wordbank/matching/cloze
    // above): both desugar to prompt + answer_space, and BOTH of those
    // primitives are already legal inside a box today.
    it('short_answer and essay nest cleanly (desugar to already-supported prompt + answer_space)', () => {
      const allowed = inset({
        blocks: [
          { type: 'short_answer', prompt: 'Name a state.' },
          { type: 'essay', prompt: 'Describe the state.' },
        ],
      });
      expect(errs(allowed)).toEqual([]);
    });

    it('reports the rejection at the nested child\'s own dotted path, not the inset\'s', () => {
      const errors = errs(inset({
        blocks: [{ type: 'rich_text', md: 'Before.' }, { type: 'page_break' }],
      }));
      expect(errors).toContain('blocks[1]: inset blocks must not contain a page_break (a box never spans a page boundary on its own)');
    });

    it('every other registered block type is still nestable', () => {
      const allowed = inset({
        blocks: [
          { type: 'rich_text', md: 'Body.' },
          { type: 'math', tex: 'x^2' },
          { type: 'asset', ref: 'a', alt: 'Alt text' },
          { type: 'answer_space', minPt: 10, maxPt: 20 },
          { type: 'omr_response', itemId: 'q1', choices: 4 },
          { type: 'media_action', action: 'a', label: 'L' },
          { type: 'scan_action', action: 'a', label: 'L' },
          { type: 'passage', text: 'A passage.' },
          { type: 'figure', asset: 'a', caption: 'C' },
          { type: 'list', style: 'bullet', items: ['One'] },
          { type: 'short_answer', prompt: 'Name a state.' },
          { type: 'essay', prompt: 'Describe the state.' },
          { type: 'divider' },
          { type: 'spacer', minPt: 10, maxPt: 20 },
        ],
      });
      expect(errs(allowed)).toEqual([]);
    });
  });
});

describe('validateBlock: list', () => {
  it.each(['bullet', 'numbered', 'checklist'])('accepts style %s with non-empty items', (style) => {
    expect(errs({ type: 'list', style, items: ['One', 'Two'] })).toEqual([]);
  });

  it('rejects an unknown style', () => {
    expect(errs({ type: 'list', style: 'roman', items: ['One'] }))
      .toContain("list style must be one of 'bullet', 'numbered', 'checklist'");
  });

  it('rejects a missing style', () => {
    expect(errs({ type: 'list', items: ['One'] }))
      .toContain("list style must be one of 'bullet', 'numbered', 'checklist'");
  });

  it('rejects an empty or missing items array', () => {
    expect(errs({ type: 'list', style: 'bullet', items: [] })).toContain('list items must be a non-empty array');
    expect(errs({ type: 'list', style: 'bullet', items: undefined })).toContain('list items must be a non-empty array');
  });

  it('rejects items containing a non-empty-string entry', () => {
    expect(errs({ type: 'list', style: 'bullet', items: ['One', '  '] }))
      .toContain('list items must be non-empty strings');
    expect(errs({ type: 'list', style: 'bullet', items: ['One', 2] }))
      .toContain('list items must be non-empty strings');
  });
});

describe('validateBlock: divider', () => {
  it('accepts an empty block', () => {
    expect(errs({ type: 'divider' })).toEqual([]);
  });

  it('ignores unknown fields, matching the house convention', () => {
    expect(errs({ type: 'divider', style: 'dashed' })).toEqual([]);
  });
});

describe('validateBlock: spacer', () => {
  it('accepts a positive min/max pair', () => {
    expect(errs({ type: 'spacer', minPt: 12, maxPt: 24 })).toEqual([]);
  });

  it('accepts equal bounds (a fixed-height gap)', () => {
    expect(errs({ type: 'spacer', minPt: 12, maxPt: 12 })).toEqual([]);
  });

  it('rejects min greater than max', () => {
    expect(errs({ type: 'spacer', minPt: 24, maxPt: 12 })).toContain('spacer minPt must be <= maxPt');
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['not a number', '12'],
    ['missing', undefined],
  ])('rejects a minPt that is %s', (_label, minPt) => {
    expect(errs({ type: 'spacer', minPt, maxPt: 24 })).toContain('spacer minPt must be a number > 0');
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['not a number', '24'],
    ['missing', undefined],
  ])('rejects a maxPt that is %s', (_label, maxPt) => {
    expect(errs({ type: 'spacer', minPt: 12, maxPt })).toContain('spacer maxPt must be a number > 0');
  });
});

describe('validateBlock: page_break', () => {
  it('accepts an empty block', () => {
    expect(errs({ type: 'page_break' })).toEqual([]);
  });

  it('ignores unknown fields, matching the house convention', () => {
    expect(errs({ type: 'page_break', force: true })).toEqual([]);
  });
});

describe('validateBlock: question extensions (Task 2 — points, bank-select sugar)', () => {
  const question = (over = {}) => ({
    type: 'question',
    itemId: 'q1',
    number: 1,
    blocks: [{ type: 'rich_text', md: 'What is $x$?' }],
    ...over,
  });

  it('accepts an optional points >= 0 on the itemId/number/blocks shape', () => {
    expect(errs(question({ points: 2 }))).toEqual([]);
    expect(errs(question({ points: 0 }))).toEqual([]);
  });

  it.each([-1, '2', NaN, Infinity])('rejects an invalid points value %s', (points) => {
    expect(errs(question({ points }))).toContain('question points must be a number >= 0');
  });

  it('accepts a minimal bank-select sugar shape', () => {
    expect(errs({
      type: 'question', bankId: 'states-bank', select: 5, key: 'sel1',
    })).toEqual([]);
  });

  it('accepts bank-select sugar with points and filter', () => {
    expect(errs({
      type: 'question',
      bankId: 'states-bank',
      select: 5,
      key: 'sel1',
      points: 3,
      filter: { topics: ['geography'], difficulty: 'easy' },
    })).toEqual([]);
  });

  it('rejects bank-select sugar missing bankId', () => {
    expect(errs({ type: 'question', select: 5, key: 'sel1' }))
      .toContain('question bankId must be a non-empty string');
  });

  it.each([0, -1, 1.5, '5'])('rejects a select value that is %s', (select) => {
    expect(errs({ type: 'question', bankId: 'b', select, key: 'sel1' }))
      .toContain('question select must be an integer >= 1');
  });

  it('key is required when select is present', () => {
    const errors = errs({ type: 'question', bankId: 'b', select: 5 });
    expect(errors.some((e) => e.includes('question key (required when select is present)'))).toBe(true);
  });

  it('rejects a key that does not match the shuffle key pattern', () => {
    const errors = errs({
      type: 'question', bankId: 'b', select: 5, key: 'Not Valid!',
    });
    expect(errors.some((e) => e.includes('question key (required when select is present)'))).toBe(true);
  });

  it('rejects a non-mapping filter', () => {
    expect(errs({
      type: 'question', bankId: 'b', select: 5, key: 'sel1', filter: 'geography',
    })).toContain('question filter must be a mapping when present');
  });

  it('rejects filter.topics that is not an array of non-empty strings', () => {
    expect(errs({
      type: 'question', bankId: 'b', select: 5, key: 'sel1', filter: { topics: 'geography' },
    })).toContain('question filter.topics must be an array of non-empty strings when present');
  });

  it('rejects a non-string filter.difficulty', () => {
    expect(errs({
      type: 'question', bankId: 'b', select: 5, key: 'sel1', filter: { difficulty: 3 },
    })).toContain('question filter.difficulty must be a non-empty string when present');
  });

  it('bank-select sugar does not require itemId/number/blocks', () => {
    expect(errs({
      type: 'question', bankId: 'b', select: 5, key: 'sel1',
    })).toEqual([]);
  });
});

describe('validateBlock: question extensions (Task 2 — omr flag, trueFalse marker)', () => {
  const question = (over = {}) => ({
    type: 'question',
    itemId: 'q1',
    number: 1,
    blocks: [{ type: 'rich_text', md: 'What is $x$?' }],
    ...over,
  });

  it('accepts an optional omr: true|false on the itemId/number/blocks shape', () => {
    expect(errs(question({ omr: true }))).toEqual([]);
    expect(errs(question({ omr: false }))).toEqual([]);
  });

  it.each(['true', 1, 0, null])('rejects a non-boolean omr value %s', (omr) => {
    expect(errs(question({ omr }))).toContain('question omr must be a boolean');
  });

  it('accepts omr on bank-select sugar too (spec §6.1: legal on either question shape)', () => {
    expect(errs({
      type: 'question', bankId: 'b', select: 5, key: 'sel1', omr: true,
    })).toEqual([]);
  });

  it('accepts trueFalse: true on the itemId/number/blocks shape', () => {
    expect(errs(question({ trueFalse: true }))).toEqual([]);
  });

  it.each([false, 'true', 1])('rejects a trueFalse value that is not literally true: %s', (trueFalse) => {
    expect(errs(question({ trueFalse }))).toContain('question trueFalse must be true when present');
  });
});

describe('validateBlock: wordbank', () => {
  it('accepts a key with unique non-empty terms', () => {
    expect(errs({ type: 'wordbank', key: 'wb1', terms: ['mitosis', 'meiosis'] })).toEqual([]);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['pattern-violating (uppercase)', 'Wb1'],
    ['pattern-violating (starts with hyphen)', '-wb1'],
    ['too long', 'a'.repeat(33)],
  ])('rejects a key that is %s', (_label, key) => {
    const errors = errs({ type: 'wordbank', key, terms: ['a', 'b'] });
    expect(errors.some((e) => e.startsWith('wordbank key must be a non-empty string matching'))).toBe(true);
  });

  it('rejects a missing or empty terms array', () => {
    expect(errs({ type: 'wordbank', key: 'wb1', terms: [] })).toContain('wordbank terms must be a non-empty array');
    expect(errs({ type: 'wordbank', key: 'wb1', terms: undefined })).toContain('wordbank terms must be a non-empty array');
  });

  it('rejects a non-empty-string term', () => {
    expect(errs({ type: 'wordbank', key: 'wb1', terms: ['a', '  '] })).toContain('wordbank terms must be non-empty strings');
    expect(errs({ type: 'wordbank', key: 'wb1', terms: ['a', 2] })).toContain('wordbank terms must be non-empty strings');
  });

  it('rejects duplicate terms', () => {
    expect(errs({ type: 'wordbank', key: 'wb1', terms: ['a', 'a'] })).toContain('wordbank terms must be unique');
  });

  it('terms are presentation, not answers — legal in a published document', () => {
    expect(errs({ type: 'wordbank', key: 'wb1', terms: ['a', 'b'] }, { allowAnswers: false })).toEqual([]);
  });
});

describe('validateBlock: matching', () => {
  const matching = (over = {}) => ({
    type: 'matching', key: 'm1', left: ['WA', 'OR'], right: ['Olympia', 'Salem'], ...over,
  });

  it('accepts the published shape (key, left, right, no pairs)', () => {
    expect(errs(matching())).toEqual([]);
  });

  it('rejects a missing/invalid key', () => {
    const errors = errs(matching({ key: undefined }));
    expect(errors.some((e) => e.startsWith('matching key must be a non-empty string matching'))).toBe(true);
  });

  it('rejects a missing/empty left or right', () => {
    expect(errs(matching({ left: [] }))).toContain('matching left must be a non-empty array of non-empty strings');
    expect(errs(matching({ right: undefined }))).toContain('matching right must be a non-empty array of non-empty strings');
  });

  it('rejects a non-empty-string entry in left/right', () => {
    expect(errs(matching({ left: ['WA', '  '] }))).toContain('matching left must be a non-empty array of non-empty strings');
    expect(errs(matching({ right: ['Olympia', 2] }))).toContain('matching right must be a non-empty array of non-empty strings');
  });

  it('rejects duplicate entries in left/right', () => {
    expect(errs(matching({ left: ['WA', 'WA'] }))).toContain('matching left must be unique');
    expect(errs(matching({ right: ['Olympia', 'Olympia'] }))).toContain('matching right must be unique');
  });

  describe('pairs (SOURCE-only answer field)', () => {
    const pairs = [{ left: 'WA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }];

    it('rejects pairs in a PUBLISHED document (default allowAnswers: false)', () => {
      expect(errs(matching({ pairs }))).toContain('matching pairs is a source-only field and must not appear in a published document');
    });

    it('accepts pairs in a SOURCE document (allowAnswers: true)', () => {
      expect(srcErrs(matching({ pairs }))).toEqual([]);
    });

    it('accepts pairs referencing left/right by index', () => {
      expect(srcErrs(matching({ pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }] }))).toEqual([]);
    });

    it('rejects a malformed pair entry', () => {
      const errors = srcErrs(matching({ pairs: [{ left: 'WA' }, { left: 'OR', right: 'Salem' }] }));
      expect(errors).toContain('matching pairs[0] must be a mapping of {left: idx|string, right: idx|string}');
    });

    it('rejects an empty pairs array', () => {
      expect(srcErrs(matching({ pairs: [] }))).toContain('matching pairs must be a non-empty array when present');
    });

    it('rejects a pair referencing a left/right value that does not exist', () => {
      const errors = srcErrs(matching({ pairs: [{ left: 'CA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }] }));
      expect(errors).toContain('matching pairs must reference entries present in left/right');
    });

    it('rejects a pairs set that repeats one left entry (not a complete, unique cover)', () => {
      const errors = srcErrs(matching({ pairs: [{ left: 'WA', right: 'Olympia' }, { left: 'WA', right: 'Salem' }] }));
      expect(errors).toContain('matching pairs must reference each left entry at most once');
      expect(errors).toContain('matching pairs must cover every left entry');
    });

    it('rejects an incomplete cover of left', () => {
      const errors = srcErrs(matching({ pairs: [{ left: 'WA', right: 'Olympia' }] }));
      expect(errors).toContain('matching pairs must cover every left entry');
    });
  });

  // Task 3 (spec §3): the inverse of `pairs` — stamped by publish, never
  // authored.
  describe('itemRef (PUBLISHED-only field)', () => {
    it('accepts itemRef in a PUBLISHED document (default allowAnswers: false)', () => {
      expect(errs(matching({ itemRef: 'm1' }))).toEqual([]);
    });

    it('rejects itemRef in a SOURCE document (allowAnswers: true)', () => {
      expect(srcErrs(matching({ itemRef: 'm1' })))
        .toContain('matching itemRef must not appear in a source document (it is stamped by publish, once a derived bank exists)');
    });

    it('rejects a non-non-empty-string itemRef', () => {
      expect(errs(matching({ itemRef: '' }))).toContain('matching itemRef must be a non-empty string when present');
    });
  });
});

describe('validateBlock: cloze', () => {
  const cloze = (over = {}) => ({
    type: 'cloze',
    text: 'The mitochondria is the {{1}} of the cell.',
    blanks: [{ n: 1 }],
    ...over,
  });

  it('accepts a single blank matching its marker', () => {
    expect(errs(cloze())).toEqual([]);
  });

  it('accepts multiple blanks numbered 1..count, each exactly once', () => {
    expect(errs({
      type: 'cloze',
      text: 'The {{1}} is red, the {{2}} is blue.',
      blanks: [{ n: 1 }, { n: 2 }],
    })).toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['not a string', { fake: 1 }],
    ['missing', undefined],
  ])('rejects text that is %s', (_label, text) => {
    expect(errs(cloze({ text }))).toContain('cloze text must be a non-empty string');
  });

  it('rejects \\require in text (reaches the math-capable path)', () => {
    expect(errs(cloze({ text: 'Simplify $\\require{enclose} x$ {{1}}.' })))
      .toContain('cloze text must not use \\require{} (server rendering loads all packages)');
  });

  it('rejects text with no {{n}} marker at all', () => {
    expect(errs(cloze({ text: 'No blanks here.' }))).toContain('cloze text must contain at least one {{n}} blank marker');
  });

  it('rejects markers that skip a number (not 1..count)', () => {
    const errors = errs({
      type: 'cloze', text: 'The {{1}} and the {{3}}.', blanks: [{ n: 1 }, { n: 3 }],
    });
    expect(errors.some((e) => e.startsWith('cloze text blank markers must be'))).toBe(true);
  });

  it('rejects a repeated marker number', () => {
    const errors = errs({
      type: 'cloze', text: 'The {{1}} and the {{1}} again.', blanks: [{ n: 1 }],
    });
    expect(errors.some((e) => e.startsWith('cloze text blank markers must be'))).toBe(true);
  });

  it('rejects a missing or empty blanks array', () => {
    expect(errs(cloze({ blanks: [] }))).toContain('cloze blanks must be a non-empty array');
    expect(errs(cloze({ blanks: undefined }))).toContain('cloze blanks must be a non-empty array');
  });

  it('rejects a blank whose n does not match any marker', () => {
    expect(errs(cloze({ blanks: [{ n: 2 }] }))).toContain('cloze blanks[0].n must be an integer matching a {{n}} marker in text');
  });

  it('rejects a blank missing entirely for a marker in text', () => {
    const errors = errs({
      type: 'cloze', text: 'The {{1}} and the {{2}}.', blanks: [{ n: 1 }],
    });
    expect(errors).toContain('cloze blanks must include one entry for every {{n}} marker in text');
  });

  it('rejects duplicate blank n values', () => {
    const errors = errs({
      type: 'cloze', text: 'The {{1}} thing.', blanks: [{ n: 1 }, { n: 1 }],
    });
    expect(errors.some((e) => e.includes('duplicates blank {{1}}'))).toBe(true);
  });

  it.each(['s', 'm', 'l'])('accepts width %s', (width) => {
    expect(errs(cloze({ blanks: [{ n: 1, width }] }))).toEqual([]);
  });

  it('rejects an unrecognised width', () => {
    expect(errs(cloze({ blanks: [{ n: 1, width: 'xl' }] }))).toContain("cloze blanks[0].width must be 's', 'm', or 'l'");
  });

  it('defaults width when absent (no error)', () => {
    expect(errs(cloze({ blanks: [{ n: 1 }] }))).toEqual([]);
  });

  it('accepts an optional wordbank reference (shape only — resolution is document-level)', () => {
    expect(errs(cloze({ blanks: [{ n: 1, wordbank: 'wb1' }] }))).toEqual([]);
  });

  it('rejects a non-empty-string wordbank reference', () => {
    expect(errs(cloze({ blanks: [{ n: 1, wordbank: '' }] }))).toContain('cloze blanks[0].wordbank must be a non-empty string when present');
  });

  describe('answer (SOURCE-only per-blank field)', () => {
    it('rejects an answer in a PUBLISHED document (default allowAnswers: false)', () => {
      expect(errs(cloze({ blanks: [{ n: 1, answer: 'mitochondria' }] })))
        .toContain('cloze blanks[0].answer is a source-only field and must not appear in a published document');
    });

    it('accepts an answer in a SOURCE document (allowAnswers: true)', () => {
      expect(srcErrs(cloze({ blanks: [{ n: 1, answer: 'mitochondria' }] }))).toEqual([]);
    });

    it('rejects a non-empty-string answer even in source mode', () => {
      expect(srcErrs(cloze({ blanks: [{ n: 1, answer: '  ' }] })))
        .toContain('cloze blanks[0].answer must be a non-empty string when present');
    });
  });

  // Task 3 (spec §3): the inverse of `answer` — stamped by publish, never
  // authored. Per-blank (not per-block), unlike matching/short_answer's
  // single itemRef: a cloze block can mint several derived-bank items.
  describe('itemRef (PUBLISHED-only per-blank field)', () => {
    it('accepts itemRef in a PUBLISHED document (default allowAnswers: false)', () => {
      expect(errs(cloze({ blanks: [{ n: 1, itemRef: 'blocks-1-b1' }] }))).toEqual([]);
    });

    it('rejects itemRef in a SOURCE document (allowAnswers: true)', () => {
      expect(srcErrs(cloze({ blanks: [{ n: 1, itemRef: 'blocks-1-b1' }] })))
        .toContain('cloze blanks[0].itemRef must not appear in a source document (it is stamped by publish, once a derived bank exists)');
    });

    it('rejects a non-non-empty-string itemRef', () => {
      expect(errs(cloze({ blanks: [{ n: 1, itemRef: '' }] })))
        .toContain('cloze blanks[0].itemRef must be a non-empty string when present');
    });
  });
});

describe('validateBlock: short_answer', () => {
  it('accepts a prompt with the default 2 lines', () => {
    expect(errs({ type: 'short_answer', prompt: 'Name the capital of Washington.' })).toEqual([]);
  });

  it('accepts an explicit lines count in 1..10', () => {
    expect(errs({ type: 'short_answer', prompt: 'P?', lines: 1 })).toEqual([]);
    expect(errs({ type: 'short_answer', prompt: 'P?', lines: 10 })).toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['not a string', { fake: 1 }],
    ['missing', undefined],
  ])('rejects a prompt that is %s', (_label, prompt) => {
    expect(errs({ type: 'short_answer', prompt })).toContain('short_answer prompt must be a non-empty string');
  });

  it.each([0, 11, 1.5, '2'])('rejects a lines value of %s', (lines) => {
    expect(errs({ type: 'short_answer', prompt: 'P?', lines }))
      .toContain('short_answer lines must be an integer between 1 and 10');
  });

  describe('answer (SOURCE-only field)', () => {
    it('rejects an answer in a PUBLISHED document (default allowAnswers: false)', () => {
      expect(errs({ type: 'short_answer', prompt: 'P?', answer: 'Olympia' }))
        .toContain('short_answer answer is a source-only field and must not appear in a published document');
    });

    it('accepts an answer in a SOURCE document (allowAnswers: true)', () => {
      expect(srcErrs({ type: 'short_answer', prompt: 'P?', answer: 'Olympia' })).toEqual([]);
    });

    it('rejects a non-empty-string answer even in source mode', () => {
      expect(srcErrs({ type: 'short_answer', prompt: 'P?', answer: '  ' }))
        .toContain('short_answer answer must be a non-empty string when present');
    });

    it('short_answer without an answer is fine in either mode (ungraded prompt is legal)', () => {
      expect(errs({ type: 'short_answer', prompt: 'P?' })).toEqual([]);
      expect(srcErrs({ type: 'short_answer', prompt: 'P?' })).toEqual([]);
    });
  });

  // Task 3 (spec §3): the inverse of `answer` — stamped by publish, never
  // authored.
  describe('itemRef (PUBLISHED-only field)', () => {
    it('accepts itemRef in a PUBLISHED document (default allowAnswers: false)', () => {
      expect(errs({ type: 'short_answer', prompt: 'P?', itemRef: 'blocks-3' })).toEqual([]);
    });

    it('rejects itemRef in a SOURCE document (allowAnswers: true)', () => {
      expect(srcErrs({ type: 'short_answer', prompt: 'P?', itemRef: 'blocks-3' }))
        .toContain('short_answer itemRef must not appear in a source document (it is stamped by publish, once a derived bank exists)');
    });

    it('rejects a non-non-empty-string itemRef', () => {
      expect(errs({ type: 'short_answer', prompt: 'P?', itemRef: '' }))
        .toContain('short_answer itemRef must be a non-empty string when present');
    });
  });
});

describe('validateBlock: essay', () => {
  it('accepts a bare prompt (default lines applied downstream)', () => {
    expect(errs({ type: 'essay', prompt: 'Describe the water cycle.' })).toEqual([]);
  });

  it('accepts an explicit lines count in 2..30', () => {
    expect(errs({ type: 'essay', prompt: 'P?', lines: 2 })).toEqual([]);
    expect(errs({ type: 'essay', prompt: 'P?', lines: 30 })).toEqual([]);
  });

  it('accepts box: true instead of lines', () => {
    expect(errs({ type: 'essay', prompt: 'P?', box: true })).toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['not a string', { fake: 1 }],
    ['missing', undefined],
  ])('rejects a prompt that is %s', (_label, prompt) => {
    expect(errs({ type: 'essay', prompt })).toContain('essay prompt must be a non-empty string');
  });

  it.each([1, 31, 2.5, '8'])('rejects a lines value of %s', (lines) => {
    expect(errs({ type: 'essay', prompt: 'P?', lines }))
      .toContain('essay lines must be an integer between 2 and 30');
  });

  it('rejects box: false (only true is meaningful)', () => {
    expect(errs({ type: 'essay', prompt: 'P?', box: false })).toContain('essay box must be true when present');
  });

  it('rejects specifying both lines and box', () => {
    expect(errs({
      type: 'essay', prompt: 'P?', lines: 8, box: true,
    })).toContain('essay must not specify both lines and box');
  });

  it('NEVER carries an answer, even in source mode', () => {
    expect(errs({ type: 'essay', prompt: 'P?', answer: 'x' })).toContain('essay must not carry an answer (unmarked prose)');
    expect(srcErrs({ type: 'essay', prompt: 'P?', answer: 'x' })).toContain('essay must not carry an answer (unmarked prose)');
    expect(srcErrs({ type: 'essay', prompt: 'P?', answers: ['x'] })).toContain('essay must not carry an answer (unmarked prose)');
  });
});
