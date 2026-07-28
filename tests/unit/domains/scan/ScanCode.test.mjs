import { describe, it, expect } from 'vitest';
import { parseScanCode, NAMESPACES, PREFIX_REGISTRY } from '#domains/scan/ScanCode.mjs';

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
    expect(parseScanCode('NUT:dl:4')).toEqual({
      namespace: null, body: 'NUT:dl:4', raw: 'NUT:dl:4', form: 'unknown',
    });
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
  it('passes a bare product barcode through untouched', () => {
    expect(parseScanCode('012000161155')).toEqual({
      namespace: null, body: '012000161155', raw: '012000161155', form: 'unknown',
    });
  });

  it('returns the unknown shape for junk input', () => {
    for (const junk of [null, undefined, 42, {}, [], '', '  ', ':', '::', ':4'])
      expect(parseScanCode(junk)).toMatchObject({ namespace: null, form: 'unknown' });
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

  it('treats an unregistered prefix as unknown, body intact', () => {
    expect(parseScanCode('gone:room:x')).toEqual({
      namespace: null, body: 'gone:room:x', raw: 'gone:room:x', form: 'unknown',
    });
  });
});

describe('parseScanCode — prototype-chain safety', () => {
  const INHERITED = [
    'constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty',
    'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__defineGetter__',
  ];

  it('does not resolve inherited Object.prototype members as namespaces', () => {
    for (const tag of INHERITED) {
      const code = `${tag}:foo`;
      expect(parseScanCode(code)).toEqual({
        namespace: null, body: code, raw: code, form: 'unknown',
      });
    }
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
});
