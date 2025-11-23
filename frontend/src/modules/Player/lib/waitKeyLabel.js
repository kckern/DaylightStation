const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const normalizeInput = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
};

export function getLogWaitKey(value, length = 10) {
  const input = normalizeInput(value);
  if (!input) {
    return ''.padStart(Math.max(1, length), '0').slice(0, length);
  }

  let hash = FNV_OFFSET >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
    hash >>>= 0;
  }

  const hex = hash.toString(16).padStart(length, '0');
  return hex.slice(0, length);
}

export default getLogWaitKey;
