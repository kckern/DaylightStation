import { describe, it, expect } from 'vitest';
import {
  parseScan,
  encodeDensity,
  encodeContainer,
  RESET_CODE,
} from '#domains/nutrition';

describe('parseScan', () => {
  describe('density codes', () => {
    it('parses a density level', () => {
      expect(parseScan('dl:4')).toEqual({ kind: 'density', level: 4 });
    });

    it('parses every level in the 1-9 range', () => {
      for (let level = 1; level <= 9; level += 1) {
        expect(parseScan(`dl:${level}`)).toEqual({ kind: 'density', level });
      }
    });

    it('rejects levels outside 1-9', () => {
      expect(parseScan('dl:0')).toBeNull();
      expect(parseScan('dl:10')).toBeNull();
      expect(parseScan('dl:x')).toBeNull();
    });
  });

  describe('container codes', () => {
    it('parses a container id', () => {
      expect(parseScan('ct:dinner-bowl')).toEqual({ kind: 'container', id: 'dinner-bowl' });
    });

    it('rejects an empty container id', () => {
      expect(parseScan('ct:')).toBeNull();
    });
  });

  describe('reset code', () => {
    it('parses the reset code', () => {
      expect(parseScan('rs:clear')).toEqual({ kind: 'reset' });
    });

    it('rejects an unknown reset payload', () => {
      expect(parseScan('rs:something-else')).toBeNull();
    });
  });

  describe('namespace isolation', () => {
    // The most important guarantee: a real product barcode must NOT be claimed
    // by this grammar, or the normal content/food pipeline never sees it.
    it('returns null for real UPC/EAN barcodes', () => {
      expect(parseScan('012000161155')).toBeNull();
      expect(parseScan('4006381333931')).toBeNull();
    });

    // Content barcodes share the colon grammar (see BarcodeCommandMap.mjs).
    it('returns null for content-barcode commands', () => {
      expect(parseScan('screen:living-room')).toBeNull();
      expect(parseScan('volume:5')).toBeNull();
    });
  });

  describe('junk input', () => {
    it('returns null for empty, non-string, and malformed input', () => {
      expect(parseScan('')).toBeNull();
      expect(parseScan(null)).toBeNull();
      expect(parseScan(undefined)).toBeNull();
      expect(parseScan(42)).toBeNull();
      expect(parseScan(':4')).toBeNull();
      expect(parseScan('dl')).toBeNull();
    });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseScan('  dl:4 ')).toEqual({ kind: 'density', level: 4 });
    expect(parseScan('\tct:mug\n')).toEqual({ kind: 'container', id: 'mug' });
  });
});

describe('encode helpers', () => {
  it('round-trips a density level through parseScan', () => {
    expect(parseScan(encodeDensity(7))).toEqual({ kind: 'density', level: 7 });
  });

  it('round-trips a container id through parseScan', () => {
    expect(parseScan(encodeContainer('mug'))).toEqual({ kind: 'container', id: 'mug' });
  });

  it('round-trips the reset code through parseScan', () => {
    expect(parseScan(RESET_CODE)).toEqual({ kind: 'reset' });
  });
});
