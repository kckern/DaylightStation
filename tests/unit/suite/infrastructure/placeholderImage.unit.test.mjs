// tests/unit/infrastructure/placeholderImage.unit.test.mjs
import { generatePlaceholderImage } from '#backend/src/0_system/utils/placeholderImage.mjs';

describe('placeholderImage', () => {
  describe('generatePlaceholderImage', () => {
    test('returns a Buffer', () => {
      const result = generatePlaceholderImage('test/path');
      expect(Buffer.isBuffer(result)).toBe(true);
    });

    test('returns a valid PNG buffer (has PNG signature)', () => {
      const result = generatePlaceholderImage('test/path');
      // PNG signature: 89 50 4E 47 0D 0A 1A 0A
      const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      expect(result.subarray(0, 8).equals(pngSignature)).toBe(true);
    });

    test('generates non-trivial image data', () => {
      const result = generatePlaceholderImage('test/path');
      // A 500x500 PNG should be at least a few KB
      expect(result.length).toBeGreaterThan(1000);
    });

    test('handles empty string with fallback', () => {
      const result = generatePlaceholderImage('');
      expect(Buffer.isBuffer(result)).toBe(true);
      // Should still produce a valid PNG
      const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      expect(result.subarray(0, 8).equals(pngSignature)).toBe(true);
    });

    test('handles null with fallback', () => {
      const result = generatePlaceholderImage(null);
      expect(Buffer.isBuffer(result)).toBe(true);
      const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      expect(result.subarray(0, 8).equals(pngSignature)).toBe(true);
    });

    test('handles undefined with fallback', () => {
      const result = generatePlaceholderImage(undefined);
      expect(Buffer.isBuffer(result)).toBe(true);
      const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      expect(result.subarray(0, 8).equals(pngSignature)).toBe(true);
    });

    test('generates consistent output for same input', () => {
      const result1 = generatePlaceholderImage('test/path');
      const result2 = generatePlaceholderImage('test/path');
      expect(result1.equals(result2)).toBe(true);
    });

    test('generates different output for different inputs', () => {
      const result1 = generatePlaceholderImage('path/one');
      const result2 = generatePlaceholderImage('path/two');
      expect(result1.equals(result2)).toBe(false);
    });

    test('handles long text without error', () => {
      const longText = 'very/long/path/that/needs/to/be/scaled/down/to/fit/properly';
      const result = generatePlaceholderImage(longText);
      expect(Buffer.isBuffer(result)).toBe(true);
      const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      expect(result.subarray(0, 8).equals(pngSignature)).toBe(true);
    });
  });
});
