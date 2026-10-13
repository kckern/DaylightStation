/**
 * JSON spans embedded in prompt prose — the reply templates and input data
 * that callers paste into message text. Offsets are into the original text
 * (end exclusive) so a caller can splice replacements in place.
 * @param {string} text
 * @returns {Array<{start: number, end: number, value: any}>}
 */
export function findJsonBlocks(text) {
  const blocks = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') { i += 1; continue; }
    const end = matchBracket(text, i);
    if (end !== -1) {
      try {
        blocks.push({ start: i, end: end + 1, value: JSON.parse(text.slice(i, end + 1)) });
        i = end + 1;
        continue;
      } catch { /* balanced but not JSON — keep scanning inside it */ }
    }
    i += 1;
  }
  return blocks;
}

/** Index of the bracket closing the one at `start`, honouring JSON strings; -1 if none. */
function matchBracket(text, start) {
  const stack = [];
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}
