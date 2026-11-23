/** Blank is optional; supplied number inputs must be finite and non-negative. */
export function isValidOptionalNonnegativeNumberInput(value) {
  return value === '' || (typeof value === 'string' && Number.isFinite(Number(value)) && Number(value) >= 0);
}
