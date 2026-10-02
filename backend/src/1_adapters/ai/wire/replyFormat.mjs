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
  '- Wrap a value in double quotes if it contains a tab, newline, colon or double quote (escape it as \\"), starts with # or -, or begins or ends with a space.',
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
 * reply looks like, so it fails.
 *
 * @returns {{ok: true, value: Object} | {ok: false, reason: string}}
 */
export function decodeReply(text, shape) {
  if (typeof text !== 'string') return { ok: false, reason: 'not-text' };

  // Trim ends without removing tabs (which delimit empty final cells)
  const trimEnds = (s) => s.replace(/^\s+/, '').replace(/[^\S\t]+$/, '');
  const body = trimEnds(trimEnds(text).replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, ''));

  if (/^[{[]/.test(body)) return { ok: false, reason: 'json-reply' };

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
  if (!rows.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
    return { ok: false, reason: 'shape-mismatch' };
  }
  const isShort = (row) => !shape.columns.every((c) => Object.hasOwn(row, c));
  if (lax && rows.length > 0 && isShort(rows.at(-1))) return { ok: false, reason: 'truncated' };

  return { ok: true, value: { ...value, [shape.arrayKey]: rows.map((row) => cleanRow(row, shape)) } };
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The table's declared row count and its raw row lines: the indented, non-blank lines after its header. */
function rawTable(body, arrayKey) {
  const lines = body.split('\n').map((line) => line.replace(/\r$/, ''));
  const header = new RegExp(`^${escapeRegExp(arrayKey)}\\[(\\d+)[^\\]]*\\](?:\\{[^}]*\\})?:\\s*$`);
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
