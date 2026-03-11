/**
 * Truncation-aware JSON repair for AI responses.
 *
 * When maxTokens cuts off mid-JSON, this attempts to salvage
 * complete items from the truncated response. Returns null
 * if the response is unsalvageable.
 *
 * @param {string} raw - The raw JSON string (already regex-extracted)
 * @returns {Object|null} Parsed object, or null if repair failed
 */
export function repairTruncatedJson(raw) {
  // First, try parsing as-is
  try {
    return JSON.parse(raw);
  } catch {
    // Fall through to repair
  }

  // Strategy: find the last complete object in the items array,
  // then truncate everything after it and close the structure.
  //
  // We scan for `}, {` or `}]` boundaries that mark complete items.
  // This is more robust than regex since the AI output has nested objects.

  // Find where "items" array starts
  const itemsStart = raw.indexOf('"items"');
  if (itemsStart === -1) return null;

  const arrayStart = raw.indexOf('[', itemsStart);
  if (arrayStart === -1) return null;

  // Walk through the array finding complete objects
  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastCompleteItemEnd = -1;

  for (let i = arrayStart + 1; i < raw.length; i++) {
    const ch = raw[i];

    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        // Found end of a complete item object
        lastCompleteItemEnd = i;
      }
    }
  }

  if (lastCompleteItemEnd === -1) return null;

  // Reconstruct: everything up to last complete item + close array + close root object
  const repaired = raw.substring(0, lastCompleteItemEnd + 1) + ']}';

  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}
