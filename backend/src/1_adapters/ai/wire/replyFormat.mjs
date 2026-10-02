import { decode } from '@toon-format/toon';

/**
 * Fixed primer appended after a rewritten reply template. Identical bytes on
 * every call so provider prompt caching of the stable prefix is unaffected.
 */
export const TOON_REPLY_RULES = [
  'Reply in TOON, not JSON, using exactly the layout above:',
  '- Scalar fields are `key: value` lines.',
  '- The table header is `name[N<TAB>]{col1<TAB>col2…}:` where N is the number of rows you write and <TAB> is a tab character.',
  '- Then N rows, each indented two spaces, values separated by tab characters in header column order.',
  '- Every row has a tab between every pair of columns, including before trailing empty cells.',
  '- Leave a cell empty to omit that field.',
  '- Wrap a value in double quotes if it contains a tab, newline, colon or double quote (escape it as \\"), starts with # or -, begins or ends with a space, or is text that looks like a number or like true, false or null. Never quote a real number.',
  '- No code fences and no text before or after.',
].join('\n');

const cell = (v) => (v === null ? 'null' : String(v));

/** The TOON layout the model should copy, built from the caller's JSON template. */
export function buildReplySkeleton(template, shape) {
  const lines = [];
  for (const [key, value] of Object.entries(template)) {
    if (key !== shape.arrayKey) { lines.push(`${key}: ${cell(value)}`); continue; }
    lines.push(`${key}[N\t]{${shape.columns.join('\t')}}:`);
    lines.push(`  ${shape.columns.map((column) => cell(value[0][column])).join('\t')}`);
  }
  return lines.join('\n');
}

/** "Respond in JSON format:" → "Respond in TOON format:". */
export function rewriteCueLine(line) {
  return line.replace(/\bJSON\b/i, 'TOON');
}

/** Sentences that only exist to force JSON output; field-meaning notes are never in this list. */
const FORMAT_SENTENCES = [
  /Begin (?:the |your )?response with ['"`]?[{[]['"`]?(?: character)?\s*(?:[-–—,]\s*)?/gi,
  /(?:output|return|respond with) only valid JSON(?:,?\s*no markdown)?\.?/gi,
  /Respond with valid JSON only\.?(?:\s*No additional text or markdown\.)?/gi,
];

export function stripFormatSentences(text) {
  return FORMAT_SENTENCES.reduce((out, pattern) => out.replace(pattern, ''), text);
}

/**
 * Decode a TOON reply against the template's shape. Never throws: a reply
 * that is JSON, unparseable, not the requested shape, or that could have lost
 * a row returns `ok: false` so the caller can fall back to today's behaviour.
 *
 * Rows are never dropped. The decoder silently skips some lines (a row
 * starting with `#` is a comment to it; an unquoted `Soup: Miso` row reads as
 * a key), so the raw row lines are counted and must match both the declared
 * `[N]` and the decoded rows. A row short of columns is kept with the missing
 * cells absent, unless it is the LAST row of a lax decode: that is what a cut
 * reply looks like, so it fails; any other short row may only omit trailing
 * text columns (`short-row`). The table must be the only one and declare
 * the tab delimiter (`name[N<TAB>]`), row keys must be template columns, and
 * numeric template columns must decode to numbers (or null/empty): together
 * these turn a column shift into a failure instead of a corrupted log.
 *
 * @returns {{ok: true, value: Object} | {ok: false, reason: string}}
 */
export function decodeReply(text, shape) {
  if (typeof text !== 'string') return { ok: false, reason: 'not-text' };

  // Trim ends without removing tabs (which delimit empty final cells)
  const trimEnds = (s) => s.replace(/^\s+/, '').replace(/[^\S\t]+$/, '');
  const body = trimEnds(trimEnds(text).replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, ''));

  if (/^[{[]/.test(body)) return { ok: false, reason: 'json-reply' };

  // The header the decoder reads decides the delimiter. A comma header
  // (`items[2]{a,b}:`) splits `Chicken Breast, Grilled` into two cells and
  // shifts every later column, so only the tab form is accepted.
  const headers = body.split('\n').filter((line) => TABLE_HEADER.test(line));
  if (headers.length > 1) return { ok: false, reason: 'multiple-tables' };
  if (headers.length === 1 && TABLE_HEADER.exec(headers[0])[2] !== '\t') return { ok: false, reason: 'wrong-delimiter' };

  let value;
  let lax = false;
  try {
    value = decode(body, { strict: true });
  } catch {
    lax = true;
    try { value = decode(body, { strict: false }); } catch { return { ok: false, reason: 'toon-parse' }; }
  }

  const allowed = new Set([...shape.scalarKeys, shape.arrayKey]);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Array.isArray(value[shape.arrayKey])
    || Object.keys(value).some((key) => !allowed.has(key))) {
    return { ok: false, reason: 'shape-mismatch' };
  }

  const table = rawTable(body, shape.arrayKey);
  if (!table) return { ok: false, reason: 'shape-mismatch' };
  const rows = value[shape.arrayKey];
  if (table.declared !== table.lines.length || rows.length !== table.lines.length) {
    return { ok: false, reason: 'row-count-mismatch' };
  }
  for (const line of table.lines) {
    const { cells, strayQuote } = splitRow(line);
    if (strayQuote) return { ok: false, reason: 'stray-quote' };
    if (cells > shape.columns.length) return { ok: false, reason: 'extra-cells' };
  }
  const columns = new Set(shape.columns);
  if (!rows.every((row) => row && typeof row === 'object' && !Array.isArray(row)
    && Object.keys(row).every((key) => columns.has(key)))) {
    return { ok: false, reason: 'shape-mismatch' };
  }
  const isShort = (row) => !shape.columns.every((c) => Object.hasOwn(row, c));
  if (lax && rows.length > 0 && isShort(rows.at(-1))) return { ok: false, reason: 'truncated' };
  // A shifted row puts text in a numeric column: number, null or empty only.
  const numberColumns = shape.numberColumns ?? [];
  if (rows.some((row) => numberColumns.some((c) => Object.hasOwn(row, c)
    && !(typeof row[c] === 'number' || row[c] === null || row[c] === '')))) {
    return { ok: false, reason: 'type-mismatch' };
  }
  // A short row is where a missing middle cell hides: there, a bare number or
  // boolean in a text column (`unit: 50`) is a shift, not a quirky name.
  const stringColumns = shape.stringColumns ?? [];
  if (rows.some((row) => shape.columns.some((c) => !Object.hasOwn(row, c))
    && stringColumns.some((c) => typeof row[c] === 'number' || typeof row[c] === 'boolean'))) {
    return { ok: false, reason: 'type-mismatch' };
  }
  // A short row may only omit trailing TEXT columns (an empty `dish` written
  // without its tab). A missing numeric suffix means a cell went missing
  // earlier and the nutrients shifted left. A short row that still ends in an
  // empty cell wrote its trailing tab, so it, too, lost a cell somewhere.
  if (rows.some((row) => isShort(row) && !shortRowIsTrailingText(row, shape))) {
    return { ok: false, reason: 'short-row' };
  }

  return { ok: true, value: { ...value, [shape.arrayKey]: rows.map((row) => cleanRow(row, shape)) } };
}

function shortRowIsTrailingText(row, shape) {
  const firstMissing = shape.columns.findIndex((c) => !Object.hasOwn(row, c));
  const suffix = shape.columns.slice(firstMissing);
  if (suffix.some((c) => Object.hasOwn(row, c) || !shape.stringColumns.includes(c))) return false;
  return firstMissing === 0 || row[shape.columns[firstMissing - 1]] !== '';
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Any TOON array header line: key, `[N<delimiter?>]`, optional `{fields}`, colon. Group 2 is the delimiter. */
const TABLE_HEADER = /^\s*("(?:[^"\\]|\\.)*"|[^\s:"[\]{}]+)\[\d+([^\]]*)\](?:\{[^}]*\})?:/;

/** The table's declared row count and its raw row lines: the indented, non-blank lines after its header. */
function rawTable(body, arrayKey) {
  const lines = body.split('\n').map((line) => line.replace(/\r$/, ''));
  const header = new RegExp(`^${escapeRegExp(arrayKey)}\\[(\\d+)\\t\\](?:\\{[^}]*\\})?:\\s*$`);
  const at = lines.findIndex((line) => header.test(line));
  if (at === -1) return null;
  const declared = Number(header.exec(lines[at])[1]);
  const rows = [];
  for (const line of lines.slice(at + 1)) {
    if (!line.trim()) continue;
    if (!/^[ \t]/.test(line)) break;
    rows.push(line.replace(/^[ \t]*/, '').replace(/ +$/, ''));
  }
  return { declared, lines: rows };
}

/**
 * Count a raw row's tab-separated cells the way the decoder reads quotes. A
 * quote anywhere but the start of a cell is "stray": the decoder would open a
 * quoted string there and swallow the following tabs (`12" Sub<TAB>g…`).
 */
function splitRow(line) {
  let cells = 1;
  let inQuote = false;
  let atStart = true;
  let strayQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '\t') { cells += 1; atStart = true; continue; }
    if (ch === '"') {
      if (atStart) inQuote = true;
      else strayQuote = true;
    }
    atStart = false;
  }
  return { cells, strayQuote };
}

/** Empty or missing cell → absent key; a string column never comes back as a number/boolean. */
function cleanRow(row, shape) {
  const out = {};
  for (const column of shape.columns) {
    const v = row[column];
    if (v === '' || v === undefined) continue;
    const coerce = shape.stringColumns.includes(column) && (typeof v === 'number' || typeof v === 'boolean');
    out[column] = coerce ? String(v) : v;
  }
  return out;
}
