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
  '- Every row has exactly one value per column, in header order, with a tab between each pair of values. An empty value keeps its tab, including a tab before an empty last value.',
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
 * or shifted a cell returns `ok: false` so the caller can fall back to
 * today's behaviour (a re-ask on the JSON path).
 *
 * Rows are positional, so one slipped tab moves every later value into the
 * wrong column. The only safe rule is exact width: the table is the only one,
 * declares the tab delimiter, lists exactly the template's columns in order,
 * and every row has exactly one cell per column (an empty cell written with
 * its tab is an absent key). Raw row lines are counted against `[N]` and the
 * decoded rows, because the decoder silently skips some lines (a `#` row is a
 * comment to it; an unquoted `Soup: Miso` row reads as a key). Types then
 * catch what is left: numbers and booleans only where the template has them,
 * and never a bare number or boolean in a text column.
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
  try {
    value = decode(body, { strict: true });
  } catch {
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
  if (table.fields === null || table.fields.length !== shape.columns.length
    || table.fields.some((field, i) => field !== shape.columns[i])) {
    return { ok: false, reason: 'column-mismatch' };
  }
  const rows = value[shape.arrayKey];
  if (table.declared !== table.lines.length || rows.length !== table.lines.length) {
    return { ok: false, reason: 'row-count-mismatch' };
  }
  for (const line of table.lines) {
    const { cells, strayQuote } = splitRow(line);
    if (strayQuote) return { ok: false, reason: 'stray-quote' };
    if (cells > shape.columns.length) return { ok: false, reason: 'extra-cells' };
    if (cells < shape.columns.length) return { ok: false, reason: 'short-row' };
  }
  const columns = new Set(shape.columns);
  if (!rows.every((row) => row && typeof row === 'object' && !Array.isArray(row)
    && Object.keys(row).every((key) => columns.has(key)))) {
    return { ok: false, reason: 'shape-mismatch' };
  }

  const typeOk = (column, v) => {
    if (v === '' || v === null || v === undefined) return true;
    if (shape.numberColumns?.includes(column)) return typeof v === 'number';
    if (shape.booleanColumns?.includes(column)) return typeof v === 'boolean';
    // A text column: a quoted "7" decodes as a string; a bare 7 is a slip.
    if (shape.stringColumns?.includes(column)) return typeof v === 'string';
    return true;
  };
  if (rows.some((row) => shape.columns.some((c) => !typeOk(c, row[c])))) {
    return { ok: false, reason: 'type-mismatch' };
  }

  return { ok: true, value: { ...value, [shape.arrayKey]: rows.map((row) => cleanRow(row, shape)) } };
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Any TOON array header line: key, `[N<delimiter?>]`, optional `{fields}`, colon. Group 2 is the delimiter. */
const TABLE_HEADER = /^\s*("(?:[^"\\]|\\.)*"|[^\s:"[\]{}]+)\[\d+([^\]]*)\](?:\{[^}]*\})?:/;

const unquote = (field) => (/^".*"$/.test(field) ? field.slice(1, -1).replace(/\\(.)/g, '$1') : field);

/**
 * The table's declared row count, its header fields (null when the header
 * has none), and its raw row lines: the indented, non-blank lines after it.
 */
function rawTable(body, arrayKey) {
  const lines = body.split('\n').map((line) => line.replace(/\r$/, ''));
  const header = new RegExp(`^${escapeRegExp(arrayKey)}\\[(\\d+)\\t\\](?:\\{([^}]*)\\})?:\\s*$`);
  const at = lines.findIndex((line) => header.test(line));
  if (at === -1) return null;
  const [, count, fieldList] = header.exec(lines[at]);
  const rows = [];
  for (const line of lines.slice(at + 1)) {
    if (!line.trim()) continue;
    if (!/^[ \t]/.test(line)) break;
    // Strip the indentation only (spaces, or tabs in a lax tab-indented
    // reply), never a tab that delimits an empty first cell.
    rows.push(line.replace(/^(?: +|\t+)/, '').replace(/ +$/, ''));
  }
  return {
    declared: Number(count),
    fields: fieldList === undefined ? null : fieldList.split('\t').map((f) => unquote(f.trim())),
    lines: rows,
  };
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

/** Empty or missing cell → absent key. Types were already checked. */
function cleanRow(row, shape) {
  const out = {};
  for (const column of shape.columns) {
    const v = row[column];
    if (v === '' || v === undefined) continue;
    out[column] = v;
  }
  return out;
}
