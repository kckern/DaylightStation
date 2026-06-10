const CONTENT_ID_RE = /^([a-z][a-z0-9-]*):(.+)$/i;

export function parseContentId(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  const match = trimmed.match(CONTENT_ID_RE);
  if (!match) return null;
  const [, source, localId] = match;
  if (!source || !localId) return null;
  return { source, localId };
}

export default parseContentId;
