import { describe, it, expect } from 'vitest';
import { findJsonBlocks } from './jsonBlocks.mjs';

describe('findJsonBlocks', () => {
  it('finds a multi-line object after prose and reports exact offsets', () => {
    const text = 'Respond in JSON format:\n{\n  "items": [{"a": 1}]\n}\nThanks';
    const [block] = findJsonBlocks(text);
    expect(block.value).toEqual({ items: [{ a: 1 }] });
    expect(text.slice(block.start, block.end)).toBe('{\n  "items": [{"a": 1}]\n}');
  });

  it('finds several blocks, including a top-level array, in order', () => {
    const text = 'Current: [{"a":1},{"a":2}]\nThen {"b":"x"}';
    expect(findJsonBlocks(text).map(b => b.value)).toEqual([[{ a: 1 }, { a: 2 }], { b: 'x' }]);
  });

  it("ignores a lone brace in prose such as Begin response with '{' character", () => {
    expect(findJsonBlocks("Begin response with '{' character - output only valid JSON")).toEqual([]);
  });

  it('respects braces inside JSON strings', () => {
    const [block] = findJsonBlocks('x {"s":"a}b{c","n":[1,2]} y');
    expect(block.value).toEqual({ s: 'a}b{c', n: [1, 2] });
  });

  it('skips a balanced span that is not JSON and keeps scanning inside it', () => {
    expect(findJsonBlocks('{not json {"ok":true}}').map(b => b.value)).toEqual([{ ok: true }]);
  });
});
