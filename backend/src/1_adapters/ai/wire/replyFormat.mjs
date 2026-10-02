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
  const body = text.trim().replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, '').trim();
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

  // Separate complete rows from incomplete ones
  const complete = [];
  const incomplete = [];

  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      incomplete.push(row);
      continue;
    }
    if (shape.columns.every((c) => Object.hasOwn(row, c))) {
      complete.push(row);
    } else {
      incomplete.push(row);
    }
  }

  // In lax mode, try to salvage rows missing only trailing columns
  // Only salvage if missing exactly 1-2 columns (more likely an empty trailing cell)
  if (truncated && incomplete.length > 0) {
    const salvaged = incomplete.filter((row) => {
      if (!row || typeof row !== 'object') return false;
      const presentCols = shape.columns.filter((c) => Object.hasOwn(row, c));
      if (presentCols.length === 0) return false;
      const missingCount = shape.columns.length - presentCols.length;
      // Only salvage if missing exactly 1 trailing column (not multiple)
      if (missingCount !== 1) return false;
      // And all missing columns must be trailing
      const lastPresentIndex = shape.columns.lastIndexOf(presentCols[presentCols.length - 1]);
      return shape.columns.slice(lastPresentIndex + 1).every((c) => !Object.hasOwn(row, c));
    });
    complete.push(...salvaged);
  }

  const droppedRows = rows.length - complete.length;
  if (droppedRows > 0 && complete.length === 0) return { ok: false, reason: 'truncated-empty' };

  // Fill in any missing trailing columns as empty strings for output
  const filledComplete = complete.map((row) => {
    const result = {};
    for (const col of shape.columns) {
      result[col] = Object.hasOwn(row, col) ? row[col] : '';
    }
    return result;
  });

  return {
    ok: true,
    value: { ...value, [shape.arrayKey]: filledComplete.map((row) => cleanRow(row, shape)) },
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
