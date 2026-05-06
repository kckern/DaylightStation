/**
 * Deep-clone a value via JSON. On failure (circular refs, BigInt, functions),
 * returns a string fallback "[safeClone failed: ...]" so transcript writers
 * never crash on weird tool results.
 */
export function safeClone(value) {
  if (value === null || value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    return `[safeClone failed: ${err.message}]`;
  }
}

export default safeClone;
