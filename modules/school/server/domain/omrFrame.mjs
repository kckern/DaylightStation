/** The 50-question form has seven ID columns and 25 paired answer columns. */
export const OMR_COLUMN_COUNT = 32;

export function omrFrameError(marks) {
  const actual = Array.isArray(marks) ? marks.length : 0;
  return actual === OMR_COLUMN_COUNT ? null : {
    code: 'OMR_COLUMN_COUNT', expected: OMR_COLUMN_COUNT, actual,
  };
}
