import { describe, it, expect } from 'vitest';
import {
  parseScanCode, NAMESPACES, PREFIX_REGISTRY, FORMS, LEGACY_NUTRITION_TAGS,
} from '#domains/scan/ScanCode.mjs';

describe('parseScanCode — registered prefixes', () => {
  it('resolves a content code', () => {
    expect(parseScanCode('go:living-room:plex:594036+shuffle')).toEqual({
      namespace: 'content',
      body: 'living-room:plex:594036+shuffle',
      raw: 'go:living-room:plex:594036+shuffle',
      form: 'prefixed',
    });
  });

  it('resolves a command code', () => {
    expect(parseScanCode('cmd:office:volume:30')).toMatchObject({
      namespace: 'command', body: 'office:volume:30', form: 'prefixed',
    });
  });

  it('resolves a nutrition code, leaving the sub-prefix in the body', () => {
    expect(parseScanCode('nut:dl:4')).toMatchObject({
      namespace: 'nutrition', body: 'dl:4', form: 'prefixed',
    });
  });

  it('keeps the raw code for school, which looks tokens up by full string', () => {
    const r = parseScanCode('sch:a7f3k2');
    expect(r.namespace).toBe('school');
    expect(r.raw).toBe('sch:a7f3k2');
  });

  it('trims surrounding whitespace', () => {
    expect(parseScanCode('  nut:dl:4  ').namespace).toBe('nutrition');
  });

  it('returns raw TRIMMED, since scanners append CR/LF', () => {
    expect(parseScanCode('  sch:a7f3k2\r\n').raw).toBe('sch:a7f3k2');
  });

  it('is case-sensitive', () => {
    // `NUT` is not registered, so step 1 does not claim it and the body is
    // never stripped. It lands on the legacy-positional catch-all rather than
    // `unknown`, which is safe: the content parser owns that grammar and
    // refuses what it cannot read. What is guaranteed is narrower than "never
    // reaches the domain it aimed at" — `GO:x:y` does reach content, because
    // the catch-all sends everything there. The guarantee is that a mis-cased
    // tag is never CLAIMED as `prefixed` and its body is never stripped — the
    // failed tag stays in the body, where the receiving parser will trip on it.
    expect(parseScanCode('NUT:dl:4')).toEqual({
      namespace: 'content', body: 'NUT:dl:4', raw: 'NUT:dl:4', form: 'legacy-positional',
    });
    for (const code of ['NUT:dl:4', 'GO:x:y', 'Sch:a7f3k2', 'DL:4'])
      expect(parseScanCode(code).form).not.toBe('prefixed');
    expect(parseScanCode('DL:4').namespace).not.toBe('nutrition');
  });

  it('does not validate bodies — an empty body still resolves to its owner', () => {
    expect(parseScanCode('go:')).toEqual({
      namespace: 'content', body: '', raw: 'go:', form: 'prefixed',
    });
  });

  it('exposes the namespace list', () => {
    expect(NAMESPACES).toContain('content');
    expect(NAMESPACES).toContain('school');
  });
});

describe('parseScanCode — the unknown path', () => {
  it('still has a reachable unknown path, by more than one route', () => {
    // Steps 3 and 4 claim most of the space, so pin down what is left: it must
    // stay explicit rather than become a fall-through nobody can reach. The
    // third route — non-string and blank input — is the `!raw` early return,
    // covered by the two normalisation tests below.
    const noColonNotDigits = ['gibberish', 'pause', 'a7f3k2', '9780306406157x'];
    // Step 3 needs a NON-EMPTY tag, so a leading colon skips it too, and an
    // empty tag can never be digits only — see the leading-colon test below.
    const emptyTag = [':4', ':go:x', ':1:2', '::'];
    for (const code of [...noColonNotDigits, ...emptyTag])
      expect(parseScanCode(code)).toEqual({
        namespace: null, body: code, raw: code, form: 'unknown',
      });
  });

  it('normalises non-string input to empty body and raw', () => {
    for (const junk of [null, undefined, 42, 0, true, false, {}, [], () => {}])
      expect(parseScanCode(junk)).toEqual({
        namespace: null, body: '', raw: '', form: 'unknown',
      });
  });

  it('normalises blank strings to empty body and raw', () => {
    for (const blank of ['', '   ', '\r\n', '\t'])
      expect(parseScanCode(blank)).toEqual({
        namespace: null, body: '', raw: '', form: 'unknown',
      });
  });

  it('does not treat a leading colon as a tag', () => {
    for (const code of [':', '::', ':4', ':go:x'])
      expect(parseScanCode(code)).toEqual({
        namespace: null, body: code, raw: code, form: 'unknown',
      });
  });

  it('never strips an unregistered prefix from the body', () => {
    // `gone` is not `go`. Lookup is exact equality after the split, so a tag
    // that merely starts with a registered one must not lose its first segment.
    expect(parseScanCode('gone:room:x')).toEqual({
      namespace: 'content', body: 'gone:room:x', raw: 'gone:room:x', form: 'legacy-positional',
    });
  });
});

describe('parseScanCode — prototype-chain safety', () => {
  const INHERITED = [
    'constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty',
    'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__defineGetter__',
  ];

  it('does not resolve inherited Object.prototype members as namespaces', () => {
    // The catch-all in step 3 gives these a namespace now, so the guarantee is
    // stated where it actually bites: the namespace is a real registered string
    // (never a Function off the prototype chain), the tag was never treated as
    // a claim, and the body was never stripped.
    for (const tag of INHERITED) {
      const code = `${tag}:foo`;
      expect(parseScanCode(code)).toEqual({
        namespace: 'content', body: code, raw: code, form: 'legacy-positional',
      });
      expect(NAMESPACES).toContain(parseScanCode(code).namespace);
    }
  });

  it('does not let a prototype member masquerade as a legacy nutrition tag', () => {
    // `includes` compares values, so no prototype member can match — a `Set`
    // would be equally safe here. The test exists because step 2 added a SECOND
    // lookup on the same untrusted input: switch it to an object map and the
    // registry's hazard reappears in a place nothing else is watching.
    for (const tag of INHERITED)
      expect(parseScanCode(`${tag}:foo`).namespace).not.toBe('nutrition');
  });

  it('keeps the registry free of a prototype', () => {
    expect(Object.getPrototypeOf(PREFIX_REGISTRY)).toBe(null);
    for (const tag of INHERITED) expect(PREFIX_REGISTRY[tag]).toBeUndefined();
  });
});

describe('PREFIX_REGISTRY — invariants', () => {
  const tags = Object.keys(PREFIX_REGISTRY);

  it('has no empty tag and no tag containing a colon', () => {
    for (const tag of tags) {
      expect(tag.length).toBeGreaterThan(0);
      expect(tag).not.toContain(':');
    }
  });

  it('maps every tag to a non-empty string namespace', () => {
    for (const tag of tags) expect(typeof PREFIX_REGISTRY[tag]).toBe('string');
    expect(NAMESPACES.every((n) => typeof n === 'string' && n.length > 0)).toBe(true);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(PREFIX_REGISTRY)).toBe(true);
    expect(Object.isFrozen(NAMESPACES)).toBe(true);
  });

  it('does not let any domain claim a nutrition sub-prefix', () => {
    // `dl:` density, `ct:` container and `rs:` reset are the fridge-sheet
    // grammar (ScanVocabularyService). They are ALSO accepted bare as the legacy
    // form, so a top-level tag colliding with one would capture every fridge
    // scan in the house and hand it to the wrong domain.
    for (const tag of tags) expect([...LEGACY_NUTRITION_TAGS]).not.toContain(tag);
  });
});

describe('legacy and shape resolution', () => {
  it('routes a bare nutrition code to nutrition', () => {
    expect(parseScanCode('dl:4')).toMatchObject({
      namespace: 'nutrition', body: 'dl:4', form: 'legacy-prefixed',
    });
    expect(parseScanCode('ct:mug').namespace).toBe('nutrition');
    expect(parseScanCode('rs:clear').namespace).toBe('nutrition');
  });

  it('routes an un-prefixed positional content code to content', () => {
    expect(parseScanCode('living-room:plex:594036')).toMatchObject({
      namespace: 'content', form: 'legacy-positional',
    });
  });

  it('detects ISBN-13 by its Bookland prefix', () => {
    expect(parseScanCode('9780306406157')).toMatchObject({ namespace: 'book', form: 'shape' });
    expect(parseScanCode('9791234567896').namespace).toBe('book');
  });

  it('leaves other digit-only codes UNCLAIMED, for the reader route to resolve', () => {
    // A UPC does not say what it is for: the same tin means "log this food" at
    // the fridge and nothing at all on a content reader. Claiming it as
    // `product` here would make a grocery barcode log food on a content-routed
    // reader, where today it reaches `BarcodePayload.parse`, fails, and does
    // nothing — the behaviour change Phase 1 forbids. So it falls to step 5.
    expect(parseScanCode('041260010682')).toEqual({
      namespace: null, body: '041260010682', raw: '041260010682', form: 'unknown',
    });
  });

  it('never resolves `product` from a parse at all', () => {
    // `product` is a route-fallback target, not a shape. Nothing this module
    // sees can justify it, so nothing here may return it — that is what keeps
    // the reader in charge of what a bare barcode means.
    const digits = [
      '041260010682', '012000161155', '0', '00', '9', '1234567890128',
      '9770306406157', '978030640615', '97803064061570', '978', '979',
      '1234978123456', '9991234979123', '0000000000000', '9'.repeat(10000),
    ];
    for (const code of digits) expect(parseScanCode(code).namespace).not.toBe('product');
  });

  it('needs an exact legacy tag, not one that merely starts with it', () => {
    // The step 1 equivalent of this is `never strips an unregistered prefix
    // from the body` (`gone` is not `go`). `ctrl:` is a plausible legacy
    // command prefix, and ScanVocabularyService picked `rs` over `ctl`/`rst`
    // precisely so no prefix would be a near-twin of another — so a near-twin
    // reaching step 2 must fall through, not be captured by nutrition.
    for (const code of ['ctrl:reboot', 'dlx:4', 'rsync:go'])
      expect(parseScanCode(code)).toMatchObject({
        namespace: 'content', form: 'legacy-positional',
      });
  });

  it('keeps a legacy code whole — there is no prefix to strip', () => {
    for (const code of ['dl:4', 'living-room:plex:594036'])
      expect(parseScanCode(code)).toMatchObject({ body: code, raw: code });
  });

  it('hands the same body to a domain whether or not the code is prefixed', () => {
    // This is the whole point of the legacy body convention: a handler reads
    // `body` and never learns which form its code arrived in.
    expect(parseScanCode('nut:dl:4').body).toBe(parseScanCode('dl:4').body);
    expect(parseScanCode('go:living-room:plex:1').body)
      .toBe(parseScanCode('living-room:plex:1').body);
  });

  it('lets a registered prefix win over both legacy forms', () => {
    expect(parseScanCode('nut:dl:4').form).toBe('prefixed');
    expect(parseScanCode('go:living-room:plex:1').form).toBe('prefixed');
  });

  it('needs a colon for a legacy nutrition tag to count', () => {
    for (const bare of ['dl', 'ct', 'rs'])
      expect(parseScanCode(bare)).toEqual({
        namespace: null, body: bare, raw: bare, form: 'unknown',
      });
  });

  it('does not validate legacy bodies either', () => {
    expect(parseScanCode('dl:')).toMatchObject({
      namespace: 'nutrition', body: 'dl:', form: 'legacy-prefixed',
    });
  });
});

describe('shape detection — adversarial', () => {
  it('leaves a bare product barcode on the unknown path, for its reader to claim', () => {
    // A UPC carries no statement of purpose, so the code alone cannot resolve
    // it and the body stays whole for whoever does.
    expect(parseScanCode('012000161155')).toEqual({
      namespace: null, body: '012000161155', raw: '012000161155', form: 'unknown',
    });
  });

  it('requires exactly 13 digits for a Bookland prefix to mean book', () => {
    for (const code of ['978030640615', '97803064061570', '978']) {
      expect(parseScanCode(code).namespace).not.toBe('book');
      expect(parseScanCode(code).form).not.toBe('shape');
    }
  });

  it('does not read a 13-digit non-Bookland code as a book', () => {
    // The prefix must be at the FRONT, not merely present: an ordinary grocery
    // EAN-13 that happens to contain 978/979 mid-string is not a book. This is
    // the `startsWith`-not-`includes` guarantee, and it matters MORE now than it
    // did: shape outranks the reader's route, so a tin mis-claimed as a book
    // here would go to the book log on every reader in the house, with no
    // per-reader escape.
    const notBooks = [
      '1234567890128',
      '9770306406157', // 977 = ISSN
      '1234978123456', // contains 978, does not start with it
      '9991234979123', // contains 979, does not start with it
    ];
    for (const code of notBooks) {
      expect(parseScanCode(code).namespace).not.toBe('book');
      expect(parseScanCode(code).form).not.toBe('shape');
    }
  });

  it('is shape-only — it does not verify the ISBN check digit', () => {
    // Validation belongs to the book handler, exactly as bodies are not
    // validated for prefixed codes. Shape names the owner and stops there.
    expect(parseScanCode('9780306406150').namespace).toBe('book');
  });

  it('preserves leading zeros — a barcode is a string, never a number', () => {
    // Unclaimed codes still carry their body through verbatim, which is what
    // makes step 5 able to finish the job: the reader's handler gets the exact
    // digits that were scanned, leading zeros and all.
    expect(parseScanCode('0000000000000').body).toBe('0000000000000');
    expect(parseScanCode('00')).toMatchObject({ body: '00', namespace: null });
  });

  it('rejects anything that is not purely ASCII digits', () => {
    const notDigits = [
      '9780306406157x', '+1234', '-1234', '1.5', '12 34', '1_2', '١٢٣٤٥',
      '١٢٣٤٥٦٧٨٩٠١٢٣', '１２３４', '12\n34', '0x1f', '1e5',
    ];
    for (const code of notDigits)
      expect(parseScanCode(code)).toEqual({
        namespace: null, body: code, raw: code, form: 'unknown',
      });
  });

  it('handles a pathologically long digit string without blowing up', () => {
    const long = '9'.repeat(10000);
    expect(parseScanCode(long)).toMatchObject({ namespace: null, form: 'unknown' });
    // And one that DOES hit the Bookland branch, so the length guard is
    // exercised on both sides rather than short-circuiting on the prefix.
    expect(parseScanCode(`978${'0'.repeat(10000)}`).namespace).not.toBe('book');
  });
});

describe('FORMS — invariants', () => {
  it('is frozen and lists every form the parser can return', () => {
    expect(Object.isFrozen(FORMS)).toBe(true);
    expect([...FORMS].sort()).toEqual(
      ['legacy-positional', 'legacy-prefixed', 'prefixed', 'shape', 'unknown'],
    );
  });

  it('never returns a form outside the list', () => {
    const codes = [
      'go:x', 'nut:dl:4', 'dl:4', 'ct:mug', 'rs:clear', 'living-room:plex:1',
      '9780306406157', '041260010682', 'gibberish', ':', '', null, 42, {},
      'constructor:foo', '__proto__:x',
    ];
    for (const code of codes) expect(FORMS).toContain(parseScanCode(code).form);
  });

  it('always returns a string namespace or null, and a string body and raw', () => {
    const codes = [
      'go:x', 'dl:4', 'living-room:plex:1', '9780306406157', '041260010682',
      'gibberish', ':', 'constructor:foo', '__proto__:x', 'toString:x', '', null, 42,
    ];
    for (const code of codes) {
      const r = parseScanCode(code);
      if (r.namespace !== null) expect(NAMESPACES).toContain(r.namespace);
      expect(typeof r.body).toBe('string');
      expect(typeof r.raw).toBe('string');
    }
  });
});

describe('LEGACY_NUTRITION_TAGS — invariants', () => {
  it('is frozen, non-empty, and colon-free', () => {
    expect(Object.isFrozen(LEGACY_NUTRITION_TAGS)).toBe(true);
    expect(() => { LEGACY_NUTRITION_TAGS.push('zz'); }).toThrow();
    for (const tag of LEGACY_NUTRITION_TAGS) {
      expect(tag.length).toBeGreaterThan(0);
      expect(tag).not.toContain(':');
    }
  });

  it('is disjoint from the prefix registry', () => {
    for (const tag of LEGACY_NUTRITION_TAGS) expect(PREFIX_REGISTRY[tag]).toBeUndefined();
  });
});
