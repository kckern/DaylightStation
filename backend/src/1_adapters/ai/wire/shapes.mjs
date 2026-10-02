/**
 * Which structured values TOON pays for. TOON's win is a uniform array of flat
 * objects written once as a table header plus rows; everything else stays JSON.
 */
export const isPrimitive = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isRow = (v) => isPlainObject(v) && Object.keys(v).length > 0 && Object.values(v).every(isPrimitive);
const keySet = (row) => Object.keys(row).sort().join('\u0000');

/** An array of flat objects sharing one key set, with at least `minRows` rows. */
export function isTable(value, minRows) {
  return Array.isArray(value) && value.length >= minRows && value.every(isRow)
    && value.every((row) => keySet(row) === keySet(value[0]));
}

/** Input data worth re-encoding: a 2+-row table, or an object of primitives and 2+-row tables. */
export function isEncodableData(value) {
  if (isTable(value, 2)) return true;
  if (!isPlainObject(value)) return false;
  const values = Object.values(value);
  return values.some((v) => isTable(v, 2)) && values.every((v) => isPrimitive(v) || isTable(v, 2));
}

/**
 * The shape of a reply template.
 * - `{ kind: 'table', … }` — exactly one array of flat example rows plus scalar siblings: TOON-eligible.
 * - `{ kind: 'flat' }` — no array at all: TOON gains nothing, leave it.
 * - `null` — anything else: ambiguous, leave the whole call alone.
 */
export function templateShape(value) {
  if (!isPlainObject(value)) return null;
  const entries = Object.entries(value);
  const arrays = entries.filter(([, v]) => Array.isArray(v));
  if (arrays.length === 0) return { kind: 'flat' };
  if (arrays.length !== 1) return null;
  const [arrayKey, rows] = arrays[0];
  if (!isTable(rows, 1)) return null;
  if (!entries.every(([key, v]) => key === arrayKey || isPrimitive(v))) return null;
  const columns = Object.keys(rows[0]);
  return {
    kind: 'table',
    arrayKey,
    columns,
    scalarKeys: entries.filter(([key]) => key !== arrayKey).map(([key]) => key),
    scalarTypes: Object.fromEntries(entries.filter(([key]) => key !== arrayKey)
      .map(([key, v]) => [key, v === null ? 'null' : typeof v])),
    stringColumns: columns.filter((column) => typeof rows[0][column] === 'string'),
    numberColumns: columns.filter((column) => typeof rows[0][column] === 'number'),
    booleanColumns: columns.filter((column) => typeof rows[0][column] === 'boolean'),
  };
}
