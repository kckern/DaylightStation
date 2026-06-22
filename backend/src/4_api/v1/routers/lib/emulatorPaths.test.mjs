// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { safeSegment } from './emulatorPaths.mjs';

describe('safeSegment', () => {
  it('accepts slug', () => expect(safeSegment('user_5')).toBe('user_5'));
  it('accepts rom with dot', () => expect(safeSegment('pokemon-red.gb', { dot: true })).toBe('pokemon-red.gb'));
  it('rejects traversal', () => expect(() => safeSegment('../etc')).toThrow());
  it('rejects traversal even with dot allowed', () => expect(() => safeSegment('..', { dot: true })).toThrow());
  it('rejects slashes', () => expect(() => safeSegment('a/b')).toThrow());
  it('rejects empty', () => expect(() => safeSegment('')).toThrow());
  it('rejects non-string', () => expect(() => safeSegment(null)).toThrow());
});
