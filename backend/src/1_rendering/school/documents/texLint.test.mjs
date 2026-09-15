import { describe, it, expect } from 'vitest';
import { collectInlineTex, lintTex } from './texLint.mjs';
import { parseRichText } from './measure.mjs';

describe('collectInlineTex', () => {
  it('finds every $…$ span in nested documents with a path back to the string', () => {
    const doc = {
      title: 'Plain',
      blocks: [
        { type: 'rich_text', md: 'What is $3 + 4$ and $5 \\times 6$?' },
        { type: 'question', choices: ['$600 + 8$', 'seven'] },
      ],
    };
    expect(collectInlineTex(doc)).toEqual([
      { path: 'blocks[0].md', tex: '3 + 4' },
      { path: 'blocks[0].md', tex: '5 \\times 6' },
      { path: 'blocks[1].choices[0]', tex: '600 + 8' },
    ]);
  });

  it('recognises exactly the spans the renderer treats as math (drift guard)', () => {
    const samples = [
      'costs $5 and $6 each',
      'no math here',
      'edge $a$ and **bold $x$** and `code $y$`',
      'unterminated $x',
      'two lines $a\nb$ joined',
      'blank line $a\n\nb$ ends it',
    ];
    for (const sample of samples) {
      const rendererMath = parseRichText(sample)
        .filter((segment) => segment.kind === 'math')
        .map((segment) => segment.tex);
      expect(collectInlineTex(sample).map((entry) => entry.tex), sample).toEqual(rendererMath);
    }
  });
});

describe('lintTex', () => {
  it('reports the bare-underscore blank that broke the 2026-09-15 mastery print', () => {
    const errors = lintTex({ md: 'What comes next? $230, 240, 250, ___$' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^md: Missing open brace for subscript/);
  });

  it('accepts the escaped form of the same blank', () => {
    expect(lintTex({ md: 'What comes next? $230, 240, 250, \\_\\_\\_$' })).toEqual([]);
  });

  it('renders each distinct segment once and reports every carrier', () => {
    let calls = 0;
    const texToSvg = (tex) => { calls += 1; if (tex.includes('_')) throw new Error('bad'); };
    const errors = lintTex({ a: '$x_$', b: '$x_$', c: '$ok$' }, { texToSvg });
    expect(calls).toBe(2);
    expect(errors).toEqual(['a: bad', 'b: bad']);
  });

  it('leaves cloze passages alone — the renderer keeps their math literal', () => {
    expect(lintTex({ blocks: [{ type: 'cloze', passage: 'fill $a_$ in {{1}}' }] })).toEqual([]);
  });

  it('is silent on documents with no inline math', () => {
    expect(lintTex({ md: 'plain prose, $5 alone' })).toEqual([]);
  });
});
