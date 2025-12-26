export function encodeCallback(action, params = {}) {
  const payload = { a: action, ...params };
  return JSON.stringify(payload);
}

export function decodeCallback(data) {
  try {
    if (typeof data === 'string' && data.startsWith('{')) {
      return JSON.parse(data);
    }
    return { legacy: true, raw: data };
  } catch (err) {
    return { legacy: true, raw: data, error: err.message };
  }
}

export default {
  encodeCallback,
  decodeCallback,
};
