import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AliasMap } from '../../../../src/2_domains/common/AliasMap.mjs';

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('AliasMap — construction', () => {
  it('null input produces an empty map', () => {
    const m = new AliasMap(null);
    assert.strictEqual(m.size, 0);
    assert.deepStrictEqual(m.entries(), []);
  });

  it('undefined input produces an empty map', () => {
    const m = new AliasMap(undefined);
    assert.strictEqual(m.size, 0);
    assert.deepStrictEqual(m.entries(), []);
  });

  it('empty object produces an empty map', () => {
    const m = new AliasMap({});
    assert.strictEqual(m.size, 0);
    assert.deepStrictEqual(m.entries(), []);
  });

  it('valid plain object produces correct size and entries', () => {
    const m = new AliasMap({ beyonce: 'Beyoncé', 'big room': 'light.living_room_main_lights' });
    assert.strictEqual(m.size, 2);
    const e = m.entries();
    assert.deepStrictEqual(e[0], ['beyonce', 'Beyoncé']);
    assert.deepStrictEqual(e[1], ['big room', 'light.living_room_main_lights']);
  });

  it('throws on string input', () => {
    assert.throws(
      () => new AliasMap('beyonce=Beyoncé'),
      /AliasMap: entries must be a plain object/,
    );
  });

  it('throws on array input', () => {
    assert.throws(
      () => new AliasMap([['beyonce', 'Beyoncé']]),
      /AliasMap: entries must be a plain object/,
    );
  });

  it('throws on number input', () => {
    assert.throws(
      () => new AliasMap(42),
      /AliasMap: entries must be a plain object/,
    );
  });

  it('throws when a value is not a string', () => {
    assert.throws(
      () => new AliasMap({ beyonce: 42 }),
      /AliasMap: entries\.beyonce must map to a string/,
    );
  });

  it('throws when a key is empty after trim', () => {
    assert.throws(
      () => new AliasMap({ '   ': 'something' }),
      /AliasMap: entries cannot have empty keys/,
    );
  });

  it('is frozen — assigning a new property throws in strict mode', () => {
    const m = new AliasMap({});
    assert.throws(() => {
      'use strict';
      m.foo = 1;
    });
  });
});

// ---------------------------------------------------------------------------
// lookup
// ---------------------------------------------------------------------------

describe('AliasMap — lookup', () => {
  const m = new AliasMap({
    beyonce: 'Beyoncé',
    'AC/DC': 'AC/DC',
    '  padded key  ': 'PaddedValue',
    'big room': 'light.living_room_main_lights',
  });

  it('exact-case match returns value', () => {
    assert.strictEqual(m.lookup('beyonce'), 'Beyoncé');
  });

  it('differently-cased query returns value (case-insensitive)', () => {
    assert.strictEqual(m.lookup('BEYONCE'), 'Beyoncé');
    assert.strictEqual(m.lookup('Beyonce'), 'Beyoncé');
  });

  it('leading/trailing whitespace on query is trimmed before match', () => {
    assert.strictEqual(m.lookup('  beyonce  '), 'Beyoncé');
  });

  it('key stored with surrounding whitespace still matches trimmed query', () => {
    // 'padded key' was stored as '  padded key  ' — normalized at construction
    assert.strictEqual(m.lookup('padded key'), 'PaddedValue');
  });

  it('miss returns null', () => {
    assert.strictEqual(m.lookup('unknown-artist'), null);
  });

  it('empty string query returns null', () => {
    assert.strictEqual(m.lookup(''), null);
  });

  it('whitespace-only query returns null', () => {
    assert.strictEqual(m.lookup('   '), null);
  });

  it('non-string query returns null', () => {
    assert.strictEqual(m.lookup(null), null);
    assert.strictEqual(m.lookup(undefined), null);
    assert.strictEqual(m.lookup(42), null);
  });

  it('value preserves original casing and special chars', () => {
    // Stored key is 'AC/DC', value is 'AC/DC'
    assert.strictEqual(m.lookup('ac/dc'), 'AC/DC');
    assert.strictEqual(m.lookup('Big Room'), 'light.living_room_main_lights');
  });
});

// ---------------------------------------------------------------------------
// entries
// ---------------------------------------------------------------------------

describe('AliasMap — entries', () => {
  it('returns original-cased keys, not normalized keys', () => {
    const m = new AliasMap({ Beyonce: 'Beyoncé' });
    const [[key]] = m.entries();
    assert.strictEqual(key, 'Beyonce');
  });

  it('preserves insertion order', () => {
    const m = new AliasMap({ a: '1', b: '2', c: '3' });
    const keys = m.entries().map(([k]) => k);
    assert.deepStrictEqual(keys, ['a', 'b', 'c']);
  });

  it('returns a fresh array each call — mutating result does not affect next call', () => {
    const m = new AliasMap({ a: '1' });
    const first = m.entries();
    first.push(['x', 'y']);
    const second = m.entries();
    assert.strictEqual(second.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Iteration
// ---------------------------------------------------------------------------

describe('AliasMap — iteration', () => {
  it('spread yields [key, value] tuples in insertion order', () => {
    const m = new AliasMap({ a: '1', b: '2' });
    const tuples = [...m];
    assert.deepStrictEqual(tuples, [['a', '1'], ['b', '2']]);
  });

  it('for-of works correctly', () => {
    const m = new AliasMap({ x: 'X', y: 'Y' });
    const out = [];
    for (const pair of m) out.push(pair);
    assert.deepStrictEqual(out, [['x', 'X'], ['y', 'Y']]);
  });
});
