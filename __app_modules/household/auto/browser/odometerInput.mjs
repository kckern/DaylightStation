/** Blank is optional; supplied odometer values must be finite and non-negative. */
export function isValidOptionalOdometerInput(value) {
  return value === '' || (typeof value === 'string' && Number.isFinite(Number(value)) && Number(value) >= 0);
}
