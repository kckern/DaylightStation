// Base64url translation owned by the stream transport adapter.
export function encodeStreamUrl(url) {
  return Buffer.from(url, 'utf8').toString('base64url');
}

export function decodeStreamUrl(token) {
  if (/^https?:\/\//i.test(token)) return token;
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    return /^https?:\/\//i.test(decoded) ? decoded : token;
  } catch {
    return token;
  }
}
