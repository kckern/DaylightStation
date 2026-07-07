// Locale note: assertions assume the default en-US ICU in Node/CI.
import { formatAsCurrency, formatCompactCurrency, PALETTE } from './format.mjs';

describe('formatAsCurrency', () => {
  test('whole dollars with thousands separators', () => {
    expect(formatAsCurrency(1234.56)).toBe('$1,235');
    expect(formatAsCurrency(0)).toBe('$0');
  });
  test('negative values keep the sign outside the $', () => {
    expect(formatAsCurrency(-1234)).toBe('-$1,234');
  });
  test('K abbreviation with one decimal', () => {
    expect(formatAsCurrency(1234, 'K')).toBe('$1.2K');
    expect(formatAsCurrency(-50, 'K')).toBe('-$0.1K');
  });
  test('null/undefined/NaN/Infinity render as $Ø', () => {
    expect(formatAsCurrency(null)).toBe('$Ø');
    expect(formatAsCurrency(undefined)).toBe('$Ø');
    expect(formatAsCurrency(NaN)).toBe('$Ø');
    expect(formatAsCurrency(Infinity)).toBe('$Ø');
  });
});

describe('formatCompactCurrency', () => {
  test('under $1000 shows whole dollars', () => {
    expect(formatCompactCurrency(450)).toBe('$450');
  });
  test('$1000+ shows whole K', () => {
    expect(formatCompactCurrency(5000)).toBe('$5K');
    expect(formatCompactCurrency(-5000)).toBe('-$5K');
  });
  test('non-finite renders as $Ø', () => {
    expect(formatCompactCurrency(null)).toBe('$Ø');
  });
});

describe('PALETTE', () => {
  test('exposes the shared chart hexes', () => {
    expect(PALETTE.over).toBe('#c1121f');
    expect(PALETTE.interest).toBe('#ff9800');
    expect(PALETTE.projectionOver).toBe('#780000');
  });
});
