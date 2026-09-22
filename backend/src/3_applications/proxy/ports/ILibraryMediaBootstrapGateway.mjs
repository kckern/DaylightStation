const SPINE_FIELDS = ['title', 'subtitle', 'author', 'narrator', 'duration', 'parts'];
const PART_FIELDS = ['key', 'index', 'title', 'duration', 'contentLength', 'mimeType', 'upstreamUrl', 'headers'];
const exactFields = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const text = value => typeof value === 'string' && value.length <= 4096;
const optionalText = value => value === null || text(value);
const positive = value => value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0);

export function validBootstrapInput(input) {
  return exactFields(input, ['webUrl', 'message', 'operationId'])
    && text(input.webUrl) && input.webUrl.length > 0
    && typeof input.message === 'string' && input.message.length > 0 && input.message.length <= 32768
    && typeof input.operationId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(input.operationId);
}

/** Application-owned structural port result; contains ephemeral capabilities for adapters only. */
export function normalizeBootstrapSpine(value) {
  const invalid = () => { throw Object.assign(new Error('Invalid bootstrap result'), { code: 'BOOTSTRAP_INVALID_RESPONSE' }); };
  if (!exactFields(value, SPINE_FIELDS) || !text(value.title) || !value.title
    || !['subtitle', 'author', 'narrator'].every(field => optionalText(value[field])) || !positive(value.duration)
    || !Array.isArray(value.parts) || !value.parts.length || value.parts.length > 1000) invalid();
  const keys = new Set();
  const parts = value.parts.map((part, index) => {
    if (!exactFields(part, PART_FIELDS) || typeof part.key !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part.key)
      || part.key.length > 256 || keys.has(part.key) || part.index !== index || !text(part.title)
      || !positive(part.duration) || !positive(part.contentLength)
      || (part.contentLength !== null && !Number.isSafeInteger(part.contentLength))
      || part.mimeType !== 'audio/mpeg' || !text(part.upstreamUrl) || !part.upstreamUrl
      || !exactFields(part.headers, [])) invalid();
    keys.add(part.key);
    return Object.freeze({ key: part.key, index, title: part.title, duration: part.duration,
      contentLength: part.contentLength, mimeType: part.mimeType, upstreamUrl: part.upstreamUrl, headers: Object.freeze({}) });
  });
  return Object.freeze({ title: value.title, subtitle: value.subtitle, author: value.author, narrator: value.narrator,
    duration: value.duration, parts: Object.freeze(parts) });
}

/**
 * bootstrapGateway.bootstrapLoan({ webUrl, message, operationId }, { signal })
 * returns the strict normalized spine above or throws a BOOTSTRAP_* category.
 * No HTTP vocabulary, provider session state, or concrete gateway crosses this port.
 */
export class ILibraryMediaBootstrapGateway {
  async bootstrapLoan(_input, _options = {}) {
    throw new Error('ILibraryMediaBootstrapGateway.bootstrapLoan must be implemented');
  }
}
