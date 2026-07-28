import { describe, it, expect } from 'vitest';
import { parseScanCode, NAMESPACES } from '#domains/scan/ScanCode.mjs';

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

  it('is case-sensitive', () => {
    expect(parseScanCode('NUT:dl:4').namespace).not.toBe('nutrition');
  });

  it('exposes the namespace list', () => {
    expect(NAMESPACES).toContain('content');
    expect(NAMESPACES).toContain('school');
  });
});
