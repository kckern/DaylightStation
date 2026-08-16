/**
 * One waitKey, one meaning — Task 4.3.
 *
 * The 2026-08-16 sweep found the same field name shipping in two incompatible
 * encodings, and an absence label that merged three different absences into one
 * apparent identity. These tests pin both halves of the fix.
 */
import { describe, it, expect } from 'vitest';
import {
  getLogWaitKey,
  getRawWaitKey,
  describeWaitKey,
  WAIT_KEY_ABSENT,
  WAIT_KEY_EMPTY
} from './waitKeyLabel.js';

describe('waitKeyLabel — absence is named, not merged', () => {
  it('tells "no key supplied" apart from "key supplied blank"', () => {
    expect(WAIT_KEY_ABSENT).not.toBe(WAIT_KEY_EMPTY);
    expect(getRawWaitKey(null)).toBe(WAIT_KEY_ABSENT);
    expect(getRawWaitKey(undefined)).toBe(WAIT_KEY_ABSENT);
    expect(getRawWaitKey('')).toBe(WAIT_KEY_EMPTY);
    // The hashed half must make the same distinction, or a hashed line still
    // collapses every keyless player onto one identity.
    expect(getLogWaitKey(null)).toBe(WAIT_KEY_ABSENT);
    expect(getLogWaitKey('')).toBe(WAIT_KEY_EMPTY);
  });

  it('never emits the run of zeros that used to stand for all three', () => {
    expect(getLogWaitKey(null)).not.toBe('0000000000');
    expect(getLogWaitKey('')).not.toBe('0000000000');
  });

  it('cannot confuse an absence sentinel with a real key or a hash', () => {
    // Real keys are `<identity>:<nonce>`; hashes are bare hex. Neither shape
    // can collide with a parenthesised sentinel.
    expect(getRawWaitKey('IIni70e01E:0')).toBe('IIni70e01E:0');
    expect(getLogWaitKey('IIni70e01E:0')).toMatch(/^[0-9a-f]{10}$/);
    expect(getLogWaitKey('IIni70e01E:0')).not.toBe(WAIT_KEY_ABSENT);
  });
});

describe('waitKeyLabel — both encodings, distinct fields', () => {
  it('returns the raw key AND its hash under two different names', () => {
    const fields = describeWaitKey('IIni70e01E:0');
    expect(fields).toEqual({
      waitKey: 'IIni70e01E:0',
      waitKeyHash: getLogWaitKey('IIni70e01E:0')
    });
    // The raw half must keep the `:N` nonce ordinal — the field a hash destroys,
    // and the one that would have made the 2026-08-16 nonce climb self-evident.
    expect(fields.waitKey.endsWith(':0')).toBe(true);
    expect(fields.waitKeyHash).not.toBe(fields.waitKey);
  });

  it('keeps the hash stable so new lines still join to pre-2026-08-16 ones', () => {
    // Pinned literal: this is the value the old getLogWaitKey produced for this
    // input, and every hashed line already on disk carries it.
    // (Verified against the pre-change implementation, not copied from this one.)
    expect(getLogWaitKey('IIni70e01E:0')).toBe('006914b2cc');
    expect(getLogWaitKey('IIni70e01E:1')).not.toBe(getLogWaitKey('IIni70e01E:0'));
  });

  it('serialises a non-string key rather than stringifying it as [object Object]', () => {
    const fields = describeWaitKey({ a: 1 });
    expect(fields.waitKey).toBe('{"a":1}');
    expect(fields.waitKeyHash).toMatch(/^[0-9a-f]{10}$/);
  });
});
