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
  '- Leave a cell empty to omit that field.',
  '- Quote a value only if it contains a tab or newline, or begins or ends with a space.',
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
 * that is JSON, unparseable, or not the requested shape returns `ok: false`
 * so the caller can fall back to today's behaviour.
 */
export function decodeReply(text, shape) {
  if (typeof text !== 'string') return { ok: false, reason: 'not-text' };

  // Trim ends without removing tabs (which delimit empty final cells)
  const trimEnds = (s) => s.replace(/^\s+/, '').replace(/[^\S\t]+$/, '');
  const body = trimEnds(trimEnds(text).replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, ''));

  if (/^[{[]/.test(body)) return { ok: false, reason: 'json-reply' };

  let value;
  let truncated = false;
  try {
    value = decode(body, { strict: true });
  } catch {
    truncated = true;
    try { value = decode(body, { strict: false }); } catch { return { ok: false, reason: 'toon-parse' }; }
  }

  const allowed = new Set([...shape.scalarKeys, shape.arrayKey]);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Array.isArray(value[shape.arrayKey])
    || Object.keys(value).some((key) => !allowed.has(key))) {
    return { ok: false, reason: 'shape-mismatch' };
  }

  const rows = value[shape.arrayKey];
  const complete = rows.filter((row) => row && typeof row === 'object' && shape.columns.every((c) => Object.hasOwn(row, c)));
  const droppedRows = rows.length - complete.length;
  if (droppedRows > 0 && complete.length === 0) return { ok: false, reason: 'truncated-empty' };

  return {
    ok: true,
    value: { ...value, [shape.arrayKey]: complete.map((row) => cleanRow(row, shape)) },
    droppedRows,
    truncated,
  };
}

/** Empty cell → absent key; a string column never comes back as a number/boolean. */
function cleanRow(row, shape) {
  const out = {};
  for (const column of shape.columns) {
    const v = row[column];
    if (v === '') continue;
    const coerce = shape.stringColumns.includes(column) && (typeof v === 'number' || typeof v === 'boolean');
    out[column] = coerce ? String(v) : v;
  }
  return out;
}
